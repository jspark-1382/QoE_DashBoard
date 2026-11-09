"""Isolated rule-based voice investigation analysis; source artifacts are read-only."""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
import hashlib
import json
import math

import numpy as np
from sklearn.cluster import DBSCAN
from sklearn.metrics.pairwise import haversine_distances

R = 6371008.8


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False)


def scope_dates(scope):
    first, last = date.fromisoformat(scope['dateStart']), date.fromisoformat(scope['dateEnd'])
    if last < first:
        raise ValueError('invalid date range')
    return [(first + timedelta(days=i)).isoformat() for i in range((last-first).days+1)]


def _distance(a, b):
    return haversine_distances(np.radians(a), np.radians(b)) * R


def _candidates(points, discovery_dates, validation_dates, policy):
    train = sorted((p for p in points if p['date'] in discovery_dates), key=lambda p: p['callId'])
    test = sorted((p for p in points if p['date'] in validation_dates), key=lambda p: p['callId'])
    if not train:
        return [], []
    xy = np.radians([[p['lat'], p['lon']] for p in train])
    labels = DBSCAN(eps=policy['epsM']/R, min_samples=policy['minSamples'], metric='haversine', algorithm='ball_tree').fit_predict(xy)
    groups = defaultdict(list)
    for p, label in zip(train, labels):
        if label >= 0:
            groups[int(label)].append(p)
    result = []
    for members in groups.values():
        customers = sorted({p['customerId'] for p in members})
        observed_dates = sorted({p['date'] for p in members})
        if len(customers) < policy['minPoorCustomers'] or len(observed_dates) < policy['minPoorDates']:
            continue
        member_ids = [p['callId'] for p in members]
        coords = [[p['lat'], p['lon']] for p in members]
        distances = _distance(coords, coords)
        center_index = int(np.argmin(np.max(distances, axis=1)))
        center = members[center_index]
        center_max = float(distances[center_index].max())
        pair_max = float(distances.max())
        nearby_test = []
        if test:
            near = _distance([[p['lat'], p['lon']] for p in test], coords).min(axis=1)
            nearby_test = [p for p, dist in zip(test, near) if dist <= policy['epsM']+1e-7]
        novel = sorted({p['customerId'] for p in nearby_test} - set(customers))
        existing = sorted({p['customerId'] for p in nearby_test} & set(customers))
        nearby = [dict(p, role='discovery-member') for p in members]
        nearby += [dict(p, role='validation-existing' if p['customerId'] in customers else 'validation-new') for p in nearby_test]
        candidate_id = 'spatial-' + hashlib.sha256(canonical(member_ids).encode()).hexdigest()[:16]
        result.append(dict(
            id=candidate_id, kind='spatial', memberCallIds=member_ids, customerIds=customers,
            poorCustomerCount=len(customers), poorCallCount=len(members), poorDateCount=len(observed_dates),
            poorDates=observed_dates, gnssCallCount=sum(p['kind']=='gnss' for p in members),
            gnssCount=sum(p['kind']=='gnss' for p in members),
            medoid=dict(lat=center['lat'], lon=center['lon'], callId=center['callId']),
            maxCenterDistanceM=center_max, maxPairDistanceM=pair_max,
            displayRadiusM=math.ceil(max(100, center_max+20)/10)*10,
            rangeReviewRequired=pair_max > policy['maxDiameterMultiplier']*policy['epsM'],
            investigationRank=None, rank=None, nearbyCandidateIds=[],
            validationNewCustomerIds=novel, validationExistingCustomerIds=existing,
            validationStatus=('not-applicable' if not validation_dates else 'reobserved' if len(novel)>=policy['minNewCustomers'] else 'insufficient-new-customers'),
            validation=dict(newCustomerIds=novel, existingCustomerIds=existing,
                            newCustomerCount=len(novel), existingCustomerCount=len(existing),
                            callIds=[p['callId'] for p in nearby_test],
                            newCallCount=sum(p['customerId'] in novel for p in nearby_test),
                            status=('not-applicable' if not validation_dates else
                                    'reobserved' if len(novel)>=policy['minNewCustomers'] else 'insufficient-new-customers')),
            nearbyPoints=nearby))
    result.sort(key=lambda c: (-c['poorCustomerCount'], -c['poorDateCount'], -c['poorCallCount'], -c['gnssCallCount'], c['id']))
    rank = 0
    for c in result:
        if not c['rangeReviewRequired']:
            rank += 1
            c['investigationRank'] = rank
            c['rank'] = rank
        for other in result:
            if other is not c and _distance([[c['medoid']['lat'], c['medoid']['lon']]], [[other['medoid']['lat'], other['medoid']['lon']]]).item() <= 500:
                c['nearbyCandidateIds'].append(other['id'])
        c['nearbyCandidateIds'].sort()
    return result, sorted(p['callId'] for p, label in zip(train, labels) if label == -1)


def _correspondence(before, after):
    rows = []
    for old in before:
        old_ids = set(old['memberCallIds'])
        matches = []
        for new in after:
            common = old_ids & set(new['memberCallIds'])
            if common:
                matches.append(new['id'])
                rows.append(dict(beforeId=old['id'], afterId=new['id'], commonCallCount=len(common),
                                 beforeOverlap=len(common)/len(old_ids), afterOverlap=len(common)/len(new['memberCallIds'])))
        if not matches:
            rows.append(dict(beforeId=old['id'], afterId=None, commonCallCount=0, beforeOverlap=0, afterOverlap=0))
    matched = {r['afterId'] for r in rows}
    rows += [dict(beforeId=None, afterId=c['id'], commonCallCount=0, beforeOverlap=0, afterOverlap=0) for c in after if c['id'] not in matched]
    return rows


def build_report(input_document: dict) -> dict:
    scope, policy = input_document['scope'], input_document['policy']
    if scope['sourceRevision'] != input_document['sourceRevision']:
        raise ValueError('source revision mismatch')
    dates = scope_dates(scope)
    if not set(dates) <= set(input_document['availableDates']):
        raise ValueError('missing date partition')
    mode = scope['mode']
    if mode not in ('holdout', 'screening') or (mode == 'holdout' and len(dates)<3):
        raise ValueError('holdout requires at least three contiguous dates')
    discovery, validation = (dates[:-1], dates[-1:]) if mode=='holdout' else (dates, [])
    calls = {}
    for c in input_document['calls']:
        if c['callId'] in calls:
            raise ValueError('duplicate call identity')
        if c['date'] not in dates:
            raise ValueError('call outside scope date')
        calls[c['callId']] = c
    decisions, points = {}, []
    for d in input_document['decisions']:
        if d['callId'] in decisions:
            raise ValueError('duplicate evidence decision')
        decisions[d['callId']] = d
        if d['callId'] not in calls:
            raise ValueError('orphan evidence decision')
        c = calls[d['callId']]
        if d['status'] != 'accepted':
            continue
        if d.get('kind') not in ('gnss','reviewed-radio'):
            raise ValueError('invalid accepted evidence kind')
        if not (isinstance(d.get('lat'),(int,float)) and math.isfinite(d['lat']) and abs(d['lat'])<=90 and isinstance(d.get('lon'),(int,float)) and math.isfinite(d['lon']) and abs(d['lon'])<=180):
            raise ValueError('invalid accepted coordinates')
        if c.get('mdtLinkStatus')!='unique':
            raise ValueError('accepted evidence without unique MDT link')
        mos = c.get('mos')
        if isinstance(mos,(int,float)) and not isinstance(mos,bool) and 1 <= mos < 3:
            points.append(dict(callId=c['callId'],rawCallId=c.get('rawCallId'),customerId=c['customerId'],date=c['date'],mos=mos,
                               lat=d['lat'],lon=d['lon'],kind=d['kind'],observedAt=d.get('observedAt'),ageSec=d.get('ageSec')))
    if set(decisions) != set(calls):
        raise ValueError('missing evidence decision')
    points.sort(key=lambda p:p['callId'])
    before, before_noise = _candidates([p for p in points if p['kind']=='gnss'], discovery, validation, policy)
    after, after_noise = _candidates(points, discovery, validation, policy)
    union_calls = {p['callId'] for c in after for p in c['nearbyPoints'] if p['role']!='discovery-member'}
    union_customers = {p['customerId'] for c in after for p in c['nearbyPoints'] if p['role']!='discovery-member'}
    sensitivity = []
    for eps in (50,100,200,300,500):
        candidates, noise = _candidates(points, discovery, validation, dict(policy,epsM=eps))
        sensitivity.append(dict(epsM=eps, candidateCount=len(candidates), reobservedCount=sum(c['validation']['status']=='reobserved' for c in candidates),
                                rangeReviewCount=sum(c['rangeReviewRequired'] for c in candidates),noiseCallCount=len(noise)))
    return dict(schemaVersion='voice-improvement-1-v1',source='MDT', sourceRevision=input_document['sourceRevision'],
                scope=scope,scopeKey=input_document['scopeKey'],policy=policy,
                provenance=input_document['provenance'],coverage=input_document['coverage'],
                inputHash=input_document.get('inputHash', ''),inputFiles=input_document.get('inputFiles', []),inventoryHash=input_document.get('inventoryHash', ''),
                availableDates=input_document['availableDates'],discoveryDates=discovery,validationDates=validation,
                calls=input_document['calls'],decisions=input_document['decisions'],
                baselineSpatialCandidates=before,improvedSpatialCandidates=after,
                correspondence=_correspondence(before,after),
                diagnostics=dict(baselineNoiseCallIds=before_noise,improvedNoiseCallIds=after_noise,
                                 observationPoints=points,sensitivity=sensitivity,
                                 validationUnion=dict(callIds=sorted(union_calls),customerIds=sorted(union_customers),callCount=len(union_calls),customerCount=len(union_customers)),
                                 outskirtsValidation='not-performed-real-data-unavailable',
                                 limitations=['DBSCAN eps is a neighbour distance, not the full candidate radius.',
                                              'New customers are candidate-specific; nearby candidates may share validation calls.',
                                              'Observation and model uncertainty do not establish impairment position or cause.']),
                publicationReference=input_document.get('publicationReference'),fieldEvidence=[],scanComparison=dict(eligible=False,reasons=['reference-unavailable']))
