"""Attach native administrative-dong boundaries to a 2026-10-30 voice overview.

Reads the local BND_ADM_DONG_PG SHP/DBF/PRJ without modifying them.
SHP is KGD2002 Central Belt 2010 (GRS80 TM, lon0=127, lat0=38,
k0=1, false E=200000m/N=600000m); source coordinates are NEVER WGS84.
Original GNSS/reviewed radio coordinates take priority over registered BYE site
references. MDT-assisted and first-row choices retain their selection basis.
Output polygons are simplified in metres before transformation to WGS84.

Requires the existing project shapely installation and scripts/mdt_gnss.py.
"""
from __future__ import annotations

import argparse
import cmath
import json
import math
import os
import struct
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

from shapely.geometry import Point, Polygon, MultiPolygon, GeometryCollection
from shapely.prepared import prep

import mdt_gnss as tm
from lte_station_catalog import identifier, resolve_lte_master
from bye_station_catalog import (
    bye_site_candidates, load_bye_catalog, normalize_end_rat, resolve_bye_site,
    resolve_manifest_nr_catalog, select_bye_site, verify_bye_inventory_provenance,
)
from inventory_provenance import verify_inventory_provenance

# The existing converter contains validated GRS80 Krueger-series coefficients.
# This boundary dataset has a different, explicitly verified central-belt CRS.
ELLIPSOID_A = tm._A
LON_ORIGIN = 127.0
X_ORIGIN = 200000.0
Y_ORIGIN = 600000.0
BORDER_MARGIN_METERS = 1300.0
SIMPLIFY_METERS = 6.0
# Use the most recent valid sample near the CDR call-end reference (BYE proxy).
# A 1-second after-end tolerance covers small source clock/rounding differences.
# Older points are NOT labeled "call end", regardless of whether the call is poor.
# The last GNSS observation may be used up to 180s before CDR end,
# but it MUST remain labelled as last known (never measured at BYE).
MAX_END_POSITION_AGE_SECONDS = 180.0
AFTER_END_TOLERANCE_SECONDS = 1.0
GNSS_ASSUMED_SPEED_KMH = 120.0
GNSS_BASE_OFFSET_M = 250.0
GNSS_RECENT_DIRECT_SECONDS = 60.0

def forward_5186(lat: float, lon: float) -> tuple[float, float]:
    phi, delta = math.radians(lat), math.radians(lon - LON_ORIGIN)
    tau = math.tan(phi)
    sigma = math.sinh(tm._E * math.atanh(tm._E * math.sin(phi)))
    tau_p = tau * math.hypot(1, sigma) - sigma * math.hypot(1, tau)
    xi = math.atan2(tau_p, math.cos(delta))
    eta = math.asinh(math.sin(delta) / math.hypot(tau_p, math.cos(delta)))
    value = complex(xi, eta)
    result = value + sum(alpha * cmath.sin(2 * n * value)
                         for n, alpha in enumerate(tm._ALPHA, 1))
    return X_ORIGIN + ELLIPSOID_A * result.imag, Y_ORIGIN + ELLIPSOID_A * (result.real - tm._XI0)

def inverse_5186(x: float, y: float) -> tuple[float, float]:
    rectified = complex((y - Y_ORIGIN) / ELLIPSOID_A + tm._XI0, (x - X_ORIGIN) / ELLIPSOID_A)
    conformal = rectified + sum(beta * cmath.sin(2 * n * rectified)
                                for n, beta in enumerate(tm._INVERSE, 1))
    xi, eta = conformal.real, conformal.imag
    chi = math.atan2(math.sin(xi), math.hypot(math.sinh(eta), math.cos(xi)))
    phi = chi + math.fsum(c * math.sin(2 * n * chi) for n, c in enumerate(tm._GEODETIC, 1))
    latitude = math.degrees(phi)
    longitude = LON_ORIGIN + math.degrees(math.atan2(math.sinh(eta), math.cos(xi)))
    return latitude, longitude

def check_prj(path: Path):
    wkt = path.read_text(encoding='utf-8-sig')
    expected = ('KGD2002_Central_Belt_2010', 'Transverse_Mercator',
                'False_Easting",200000', 'False_Northing",600000',
                'Central_Meridian",127', 'Scale_Factor",1.0',
                'Latitude_Of_Origin",38')
    if not all(key in wkt for key in expected):
        raise ValueError('경계 SHP .prj가 KGD2002 중부원점(2010)과 일치하지 않습니다.')
    # Check inverse/forward independently at the latitude/longitude of origin.
    e, n = forward_5186(38, 127)
    assert abs(e - X_ORIGIN) < 1e-6 and abs(n - Y_ORIGIN) < 1e-6, (e, n)
    for lat, lon in [(37.48, 127.05), (35.21, 126.86), (38.0, 127.0)]:
        x, y = forward_5186(lat, lon)
        out_lat, out_lon = inverse_5186(x, y)
        assert abs(out_lat-lat) < 2e-8 and abs(out_lon-lon) < 2e-8, (lat,lon,out_lat,out_lon)

def read_dbf(path: Path) -> list[dict[str, str]]:
    with path.open('rb') as f:
        header = f.read(32)
        count, header_len, record_len = struct.unpack('<IHH', header[4:12])
        fields = []
        while f.tell() < header_len - 1:
            field = f.read(32)
            fields.append((field[:11].split(b'\0', 1)[0].decode('ascii'), field[16]))
        if not {'ADM_CD','ADM_NM','BASE_DATE'} <= {n for n,_ in fields}:
            raise ValueError('SHP DBF 행정동 코드·명칭·기준일 필드가 없습니다.')
        f.seek(header_len)
        rows = []
        for _ in range(count):
            record = f.read(record_len)
            if len(record) != record_len:
                raise ValueError('DBF 레코드가 중간에 잘렸습니다.')
            offset = 1
            entry = {}
            for name, size in fields:
                entry[name] = record[offset:offset+size].decode('cp949', 'strict').strip()
                offset += size
            rows.append(entry)
        return rows

def ring_area(ring: list[tuple[float,float]]) -> float:
    return sum(a[0]*b[1] - b[0]*a[1] for a,b in zip(ring, ring[1:])) / 2

def construct_geometry(content: bytes):
    shape_type = struct.unpack_from('<i', content, 0)[0]
    if shape_type != 5:
        raise ValueError('행정동 SHP는 Polygon(5)이어야 합니다.')
    part_count, point_count = struct.unpack_from('<ii', content, 36)
    if part_count < 1 or point_count < 4 or part_count > point_count:
        raise ValueError('잘못된 Polygon part/point 개수')
    starts = struct.unpack_from('<'+str(part_count)+'i', content, 44)
    if any(n < 0 or n >= point_count for n in starts) or sorted(starts) != list(starts):
        raise ValueError('Polygon parts 인덱스 오류')
    offset = 44 + part_count * 4
    coords = struct.unpack_from('<'+str(2*point_count)+'d', content, offset)
    rings = []
    for part, start in enumerate(starts):
        stop = starts[part+1] if part+1 < len(starts) else point_count
        ring = [(coords[2*i], coords[2*i+1]) for i in range(start,stop)]
        if len(ring) < 4:
            continue
        if ring[0] != ring[-1]:
            ring.append(ring[0])
        rings.append((ring_area(ring), ring))
    if not rings:
        return None
    # ESRI Polygon rings: clockwise outer / counterclockwise holes.
    shells = [(ring, []) for area,ring in rings if area < 0]
    holes = [ring for area,ring in rings if area >= 0]
    if not shells:
        # Fallback for a non-conforming source: never silently drop geometry.
        shells = [(max(rings, key=lambda item: abs(item[0]))[1], [])]
        holes = [ring for _,ring in rings if ring is not shells[0][0]]
    shell_polygons = [Polygon(ring) for ring,_ in shells]
    for ring in holes:
        representative = Polygon(ring).representative_point()
        parents = [(i, p.area) for i,p in enumerate(shell_polygons) if p.covers(representative)]
        if parents:
            parent = min(parents,key=lambda candidate:candidate[1])[0]
            shells[parent][1].append(ring)
        else:
            shells.append((ring, []))
            shell_polygons.append(Polygon(ring))
    geometry = MultiPolygon([Polygon(ring, holes) for ring,holes in shells])
    if not geometry.is_valid:
        geometry = geometry.buffer(0)
    if geometry.is_empty:
        return None
    return geometry

def polygons_only(geom):
    if isinstance(geom, Polygon):
        return [geom]
    if isinstance(geom, MultiPolygon):
        return list(geom.geoms)
    if isinstance(geom, GeometryCollection):
        return [p for item in geom.geoms for p in polygons_only(item)]
    return []

def wgs84_coordinates(geom) -> list:
    result = []
    for polygon in polygons_only(geom):
        rings = [polygon.exterior, *polygon.interiors]
        paths = []
        for ring in rings:
            path = []
            for x,y in ring.coords:
                lat,lon = inverse_5186(x,y)
                path.append([round(lon,7),round(lat,7)])
            paths.append(path)
        result.append(paths)
    return result

def intersects_bounds(bounds_a, bounds_b):
    ax0,ay0,ax1,ay1 = bounds_a
    bx0,by0,bx1,by1 = bounds_b
    return ax0 <= bx1 and bx0 <= ax1 and ay0 <= by1 and by0 <= ay1

def read_local_boundaries(shp: Path, records: list, bounds):
    found = []
    with shp.open('rb') as f:
        header = f.read(100)
        if struct.unpack_from('>i',header,0)[0] != 9994 or struct.unpack_from('<i',header,32)[0] != 5:
            raise ValueError('유효한 Polygon SHP 파일이 아닙니다.')
        index = 0
        while True:
            rec = f.read(8)
            if not rec:
                break
            if len(rec) != 8:
                raise ValueError('SHP 레코드 헤더가 잘렸습니다.')
            byte_len = struct.unpack('>i',rec[4:8])[0] * 2
            head = f.read(36)
            if len(head) != 36:
                raise ValueError('SHP 레코드가 잘렸습니다.')
            typ = struct.unpack_from('<i',head,0)[0]
            if typ not in (0,5):
                raise ValueError(f'예상하지 못한 SHP 타입: {typ}')
            extent = struct.unpack_from('<4d',head,4)
            if typ == 5 and intersects_bounds(extent,bounds):
                record = head + f.read(byte_len-36)
                geom = construct_geometry(record)
                if geom is not None:
                    meta = records[index]
                    simplified = geom.simplify(SIMPLIFY_METERS, preserve_topology=True)
                    if simplified.is_empty:
                        simplified = geom
                    point = geom.representative_point()
                    lat,lon = inverse_5186(point.x, point.y)
                    found.append({
                        'id': 'adm:' + meta['ADM_CD'],
                        'label': meta['ADM_NM'],
                        'date': meta['BASE_DATE'],
                        'lat': lat, 'lon': lon,
                        'geometry': geom,
                        'bbox': geom.bounds,
                        'coordinates': wgs84_coordinates(simplified),
                    })
            else:
                f.seek(byte_len-36,1)
            index += 1
        if index != len(records):
            raise ValueError(f'SHP/DBF 레코드 수 불일치: {index} vs {len(records)}')
    return found

def reviewable_multilateration(model: dict) -> bool:
    """Conservative model-quality gate; NOT a proven UE accuracy bound."""
    if model.get('estimationMethod') != 'MULTILATERATION':
        return False
    sites=model.get('siteCount')
    geometry=model.get('geometry')
    uncertainty=model.get('estimatedAccuracyM')
    confidence=model.get('confidenceScore')
    residual=model.get('residualErrorM')
    return (
        isinstance(sites,(int,float)) and not isinstance(sites,bool) and sites>=3 and
        isinstance(geometry,(int,float)) and math.isfinite(geometry) and geometry>=0.02 and
        isinstance(uncertainty,(int,float)) and math.isfinite(uncertainty) and 0<=uncertainty<=3000 and
        isinstance(confidence,(int,float)) and math.isfinite(confidence) and confidence>=30 and
        isinstance(residual,(int,float)) and math.isfinite(residual) and 0<=residual<=800
    )


def select_bye_points(rows: list[dict], audit: Counter | None = None):
    """One source coordinate per call: freshest near the CDR end.

    GNSS/measured has priority; otherwise only 3+ independent-site radio
    estimates passing review thresholds are accepted. A 2-site or weak
    solution must be resolved via a separately labeled BYE Cell site, never
    published as a precise UE position.
    """
    audit = audit if audit is not None else Counter()
    fresh = defaultdict(list)
    seen_calls = set()
    for index, row in enumerate(rows):
        audit['normalizedSamples'] += 1
        if not isinstance(row,dict):
            raise ValueError('좌표 후보의 자료형 오류')
        cid, lat, lon = row.get('callId'), row.get('lat'), row.get('lon')
        kind = row.get('source')
        if kind not in ('gnss','measured','radio','interpolated'):
            audit['unverifiedLocationSamples'] += 1
            continue
        if (not isinstance(cid,str) or not cid or
            not isinstance(lat,(int,float)) or isinstance(lat,bool) or
            not isinstance(lon,(int,float)) or isinstance(lon,bool) or
            not math.isfinite(lat) or not math.isfinite(lon) or
            not (33 <= lat <= 39.8 and 124 <= lon <= 132)):
            audit['invalidGeoSamples'] += 1
            continue
        seen_calls.add(cid)
        verified = kind in ('gnss','measured')
        audit['verifiedSamples' if verified else 'estimatedSamples'] += 1
        at, end = row.get('observedMs'), row.get('cdrEndMs')
        if (not isinstance(at,(int,float)) or isinstance(at,bool) or
            not isinstance(end,(int,float)) or isinstance(end,bool) or
            not math.isfinite(at) or not math.isfinite(end) or
            at <= 0 or end <= 0):
            audit['missingEndOrSampleTime'] += 1
            continue
        lag = (end-at)/1000
        if lag < -AFTER_END_TOLERANCE_SECONDS:
            audit['observationsAfterEndExcluded'] += 1
            continue
        if lag > MAX_END_POSITION_AGE_SECONDS:
            audit['staleAtEndSamples'] += 1
            continue
        x,y = forward_5186(lat,lon)
        model = {k:row.get(k) for k in (
            'estimationMethod','siteCount','geometry','residualErrorM',
            'estimatedAccuracyM','confidenceScore','estimatorWindowSec'
        )}
        fresh[cid].append((cid,x,y,kind,lat,lon,at,end,lag,row.get('sampleIndex',index),model))
        audit['freshEligibleSamples'] += 1
    selected = []
    for cid, rows in fresh.items():
        observed = [row for row in rows if row[3] in ('gnss','measured')]
        if observed:
            audit['estimatedSamplesExcludedByGnss'] += len(rows)-len(observed)
            candidates = observed
        else:
            # An unvalidated 3-site solution or any 2-site barycenter is not
            # sufficient when a unique CDR BYE serving-cell site can instead
            # be exposed clearly as station-based evidence.
            candidates = [row for row in rows if reviewable_multilateration(row[10])]
            if not candidates:
                audit['noReviewableMultilaterationCalls'] += 1
                continue
        item = max(candidates,key=lambda row:(row[6],row[9]))
        audit['chosenGnssCalls' if item[3] in ('gnss','measured') else 'chosenReviewableMultilaterationCalls'] += 1
        # Retain timestamps and lag for explicit user-visible provenance.
        observed_at=datetime.fromtimestamp(item[6]/1000, timezone.utc).isoformat(timespec='milliseconds')
        end_at=datetime.fromtimestamp(item[7]/1000, timezone.utc).isoformat(timespec='milliseconds')
        selected.append((*item[:6], observed_at,end_at,round(item[8],3),item[10]))
    audit['positionCandidateCalls'] = len(seen_calls)
    audit['callsWithStaleOrNoEndPosition'] = len(seen_calls)-len(selected)
    audit['selectedEndLocations'] = len(selected)
    return selected,audit


def get_original_points(manifest: dict, public_dir: Path, date: str):
    """Fallback only for direct CLI use without normalized radio estimates."""
    stats=Counter()
    if manifest.get('meta', {}).get('qoeBasis') != 'rtcp-mos-v5':
        raise ValueError('원본 MOS(v5)용 행정동 매핑에만 사용할 수 있습니다.')
    fields=manifest['meta']['sampleFields']
    indexes={field:fields.index(field) for field in ('lat','lon','callId','mdt')}
    rows=[]
    for entry in manifest['days']:
        if entry['date']!=date:
            continue
        detail=json.loads((public_dir / entry['dataPath']).read_text(encoding='utf-8'))
        if detail['customerId']!=entry['customerId'] or detail['date']!=date:
            raise ValueError('상세 파티션 고객/일자 식별값 불일치')
        ends={c['id']: c.get('endTimestamp') for c in detail.get('calls',[])}
        for sample in detail.get('samples',[]):
            stats['rawSamples'] += 1
            lat,lon=sample[indexes['lat']],sample[indexes['lon']]
            md=sample[indexes['mdt']]
            source=md.get('locationSource') if isinstance(md,dict) else None
            if source not in ('gnss','measured'):
                continue
            cid=sample[indexes['callId']]
            stamp=md.get('timestamp')
            end=ends.get(cid)
            try:
                at=datetime.fromisoformat(stamp.replace('Z','+00:00')).timestamp()*1000
                end_at=datetime.fromisoformat(end.replace('Z','+00:00')).timestamp()*1000
            except (ValueError,TypeError,AttributeError):
                at=end_at=None
            rows.append({'callId':entry['customerId']+':'+str(cid),
                'lat':lat,'lon':lon,'source':source,
                'observedMs':at,'cdrEndMs':end_at})
    return select_bye_points(rows,stats)


def get_normalized_points(path: Path):
    return select_bye_points(json.loads(path.read_text(encoding='utf-8')))

def get_bye_mdt_events(manifest: dict, public_dir: Path, date: str, calls: list[dict]):
    """Read confirmed same-call MDT, grouped by customer/day, for RU selection."""
    if not calls or not manifest.get('days'):
        return {}
    fields=manifest.get('meta',{}).get('sampleFields',[])
    if not all(field in fields for field in ('callId','rat','mdt')):
        raise ValueError('BYE MDT source sample fields are incomplete')
    indexes={field:fields.index(field) for field in ('callId','rat','mdt')}
    entries={(entry['customerId'],entry['date']):entry for entry in manifest['days']}
    grouped=defaultdict(list)
    for call in calls:
        if call.get('customerId') and call.get('rawCallId'):
            grouped[call['customerId']].append(call)
    result={}
    root=public_dir.resolve()

    def timestamp(value):
        try:
            stamp=datetime.fromisoformat(value.replace('Z','+00:00'))
            # Naive source timestamps share the same local clock. Apply the
            # same timezone for stable subtraction across build machines.
            return stamp if stamp.tzinfo else stamp.replace(tzinfo=timezone.utc)
        except (ValueError,TypeError,AttributeError):
            return None

    for customer,selected in grouped.items():
        entry=entries.get((customer,date))
        if entry is None:
            raise ValueError('BYE MDT customer/day partition is missing')
        path=(public_dir/entry['dataPath']).resolve()
        if not path.is_relative_to(root):
            raise ValueError('BYE MDT partition path escapes public directory')
        detail=json.loads(path.read_text(encoding='utf-8'))
        if detail.get('customerId')!=customer or detail.get('date')!=date:
            raise ValueError('BYE MDT customer/date partition identity mismatch')
        originals={call['id']:call for call in detail.get('calls',[])}
        wanted={}
        for call in selected:
            original=originals.get(call['rawCallId'])
            if original is None:
                raise ValueError('BYE MDT original call identity is missing')
            if original.get('matchStatus')!='MATCHED':
                continue
            if (identifier(original.get('endCellId'))!=identifier(call.get('endCellId')) or
                    normalize_end_rat(original.get('endRat'))!=normalize_end_rat(call.get('endRat'))):
                raise ValueError('BYE MDT original call Cell/RAT identity mismatch')
            end=timestamp(original.get('endTimestamp'))
            if end is not None:
                wanted[call['rawCallId']]=(call,end)
        for sample in detail.get('samples',[]):
            if not isinstance(sample,list) or len(sample)<=max(indexes.values()):
                raise ValueError('BYE MDT source sample shape is invalid')
            item=wanted.get(sample[indexes['callId']])
            if item is None:
                continue
            call,end=item
            md=sample[indexes['mdt']]
            if not isinstance(md,dict):
                continue
            radio=normalize_end_rat(sample[indexes['rat']])
            call_radio=normalize_end_rat(call.get('endRat'))
            if (not radio or call_radio and radio!=call_radio or
                    identifier(md.get('cellId'))!=identifier(call.get('endCellId'))):
                continue
            observed=timestamp(md.get('timestamp'))
            if observed is None:
                continue
            lag=(end-observed).total_seconds()
            if not -1 <= lag <= 30:
                continue
            result.setdefault(call['id'],[]).append({
                'ruId':identifier(md.get('baseStationId')),
                'cellId':identifier(md.get('cellId')),'technology':radio,
                'secondsBeforeEnd':lag,
            })
    return result


def _bye_selection_metadata(site):
    return {key:site[key] for key in (
        'byeSelectionMethod','byeCandidateCount','byeSelectionDeltaSeconds','byeSelectionMdtRu',
    ) if key in site}


def attach(overview: dict, manifest: dict, public_dir: Path, shp: Path,
           normalized_points: Path | None = None, bye_catalog: Path | None = None,
           nr_catalog: Path | None = None):
    verify_inventory_provenance(manifest,bye_catalog,'administrative-dong BYE sites')
    nr_catalog=resolve_manifest_nr_catalog(manifest,bye_catalog,nr_catalog)
    check_prj(shp.with_suffix('.prj'))
    records=read_dbf(shp.with_suffix('.dbf'))
    dates={r['BASE_DATE'] for r in records}
    if len(dates)!=1:
        raise ValueError('서로 다른 행정동 기준일이 혼합되어 있습니다: '+str(dates))
    points,audit=(get_normalized_points(normalized_points) if normalized_points
                  else get_original_points(manifest,public_dir,overview['date']))
    original_ids = {call['id'] for call in overview['calls']}
    for item in points:
        cid=item[0]
        if cid not in original_ids:
            raise ValueError('원본 GNSS/3사이트 통화 ID가 CDR과 일치하지 않습니다.')
    # Last GNSS (with age/movement envelope) -> reviewed radio ->
    # selected BYE base-station location. Never treat BYE tower as handset.
    # BYE coordinates belong to the SERVING BASE STATION, NOT the handset.
    bye_sites_by_call={}
    if bye_catalog is not None or nr_catalog is not None:
        catalog,bye_audit=load_bye_catalog(
            bye_catalog,nr_catalog,{identifier(c.get('endCellId')) for c in overview['calls']},
        )
        # A workbook replaced between the first provenance check and parsing
        # must never be relabelled as the declared source snapshot.
        verify_inventory_provenance(manifest,bye_catalog,'administrative-dong BYE sites')
        verify_bye_inventory_provenance(manifest,bye_catalog,nr_catalog)
        overview['byeInventorySources']=catalog['sources']
        mdt_calls=[call for call in overview['calls']
                   if bye_site_candidates(catalog,call.get('endCellId'),call.get('endRat'))
                   and resolve_bye_site(catalog,call.get('endCellId'),call.get('endRat')) is None]
        mdt_events=get_bye_mdt_events(manifest,public_dir,overview['date'],mdt_calls)
        bye_sites_by_call={
            call['id']:site for call in overview['calls']
            if (site:=select_bye_site(catalog,call.get('endCellId'),call.get('endRat'),
                                     mdt_events.get(call['id'],()))) is not None
        }
        overview['byeSelectionPolicy']={
            'version':'mdt-then-first-v1','mdtMaxAgeSeconds':30,
            'mdtAfterEndToleranceSeconds':1,'fallbackOrder':'inventory-row',
        }
        for site in bye_sites_by_call.values():
            audit['byeSelection_'+site['byeSelectionMethod']]+=1
        for key,value in bye_audit.items():
            audit['byeCatalog_'+key]=value
    selected={p[0] for p in points}
    calls_by_id={call['id']:call for call in overview['calls']}
    projected_coordinates={
        coordinate:forward_5186(*coordinate)
        for coordinate in {(site['lat'],site['lon']) for site in bye_sites_by_call.values()}
    }
    projected_sites={cid:(*projected_coordinates[(site['lat'],site['lon'])],site)
                     for cid,site in bye_sites_by_call.items()}
    audit['totalCdrCalls']=len(overview['calls'])
    audit['callsWithEndCell']=sum(bool(identifier(call.get('endCellId')))
                                 for call in overview['calls'])
    audit['primaryGnssOrReviewableTrilatCalls']=len(selected)
    for call in overview['calls']:
        cid=call['id']
        if cid in selected:continue
        cell_id=identifier(call.get('endCellId'))
        site=projected_sites.get(cid)
        if site is None:
            audit['noUniqueByeCellFallbackCalls']+=1
            continue
        x,y,details=site
        points.append((cid,x,y,'bye-cell',details['lat'],details['lon'],
                       None,None,None,{
                           'byeCellId':cell_id,
                           'byeRuId':details['ruId'],
                           'byeInventory':details['source'],
                           'byeTechnology':details['technology'],
                           'byeInventorySha256':details['sourceSha256'],
                           'byePci':details.get('pci'),
                           'byeInventoryPciStatus':details.get('inventoryPciStatus'),
                           'byeInventoryPciCandidates':details.get('inventoryPciCandidates',[]),
                           **_bye_selection_metadata(details),
                       }))
        audit['selectedByeCellSites']+=1
    if not points:
        raise ValueError('GNSS/3사이트/BYE Cell 어느 위치 근거도 없습니다.')
    bounds = (
        min(p[1] for p in points) - BORDER_MARGIN_METERS,
        min(p[2] for p in points) - BORDER_MARGIN_METERS,
        max(p[1] for p in points) + BORDER_MARGIN_METERS,
        max(p[2] for p in points) + BORDER_MARGIN_METERS,
    )
    candidates = read_local_boundaries(shp, records, bounds)
    if not candidates:
        raise ValueError('통화 위치가 SHP 행정동 경계 범위와 일치하지 않습니다.')
    if len(candidates)>500:
        raise ValueError(f'행정동 후보가 {len(candidates)}개로 너무 많습니다. 분석 데이터의 위치 범위를 점검하세요.')
    registered=[]
    for region in candidates:
        region['prepared']=prep(region['geometry'])
        registered.append(region)
    matches = defaultdict(set)
    location_bases = {}
    # Exactly one BYE-nearest coordinate was selected per call BEFORE the
    # spatial join. No midpoint, path crossing, or district centroid is used.
    representative_points = {}
    for cid,x,y,kind,lat,lon,observed_at,end_at,lag,model in points:
        point=Point(x,y)
        possible=[region for region in registered
                  if region['bbox'][0] <= x <= region['bbox'][2]
                  and region['bbox'][1] <= y <= region['bbox'][3]
                  and region['prepared'].covers(point)]
        if len(possible)==1:
            region_id=possible[0]['id']
            matches[cid].add(region_id)
            location_bases[cid]=(
                'gnss' if kind in ('gnss','measured') else
                'bye-cell' if kind=='bye-cell' else 'estimated'
            )
            if cid in representative_points:
                raise ValueError('단일 통화에 중복 종료 대표 좌표가 있습니다.')
            method=model.get('estimationMethod')
            sites=model.get('siteCount')
            geometry=model.get('geometry')
            uncertainty=model.get('estimatedAccuracyM')
            confidence=model.get('confidenceScore')
            residual=model.get('residualErrorM')
            ok_geometry=isinstance(geometry,(int,float)) and math.isfinite(geometry) and geometry>=0.02
            ok_uncertainty=isinstance(uncertainty,(int,float)) and math.isfinite(uncertainty) and uncertainty<=3000
            ok_confidence=isinstance(confidence,(int,float)) and math.isfinite(confidence) and confidence>=30
            ok_residual=isinstance(residual,(int,float)) and math.isfinite(residual) and residual<=800
            if kind=='bye-cell':
                quality='bye-cell-site'
            elif kind in ('gnss','measured'):
                quality='gnss-last-known' if lag is not None and lag>GNSS_RECENT_DIRECT_SECONDS else 'gnss-observed'
            elif method=='MULTILATERATION' and isinstance(sites,(int,float)) and sites>=3:
                quality='trilateration-reviewable' if all((ok_geometry,ok_uncertainty,ok_confidence,ok_residual)) else 'trilateration-weak'
            elif method=='WEIGHTED_2_SITE':
                quality='two-site-approximation'
            else:
                quality='other-approximation'
            audit['selectedQuality_'+quality]+=1
            bye_cell=identifier(calls_by_id.get(cid,{}).get('endCellId'))
            bye_support=bye_sites_by_call.get(cid) if kind!='bye-cell' else None
            # Supporting BYE coordinates are a SEPARATE SITE. The GNSS
            # representative point is never replaced by the BTS coordinate.
            additional_bye=({
                'byeCellId':bye_cell,
                'byeRuId':bye_support['ruId'],
                'byeInventory':bye_support['source'],
                'byeTechnology':bye_support['technology'],
                'byeInventorySha256':bye_support['sourceSha256'],
                'byePci':bye_support.get('pci'),
                'byeInventoryPciStatus':bye_support.get('inventoryPciStatus'),
                'byeInventoryPciCandidates':bye_support.get('inventoryPciCandidates',[]),
                'byeStationLat':bye_support['lat'],
                'byeStationLon':bye_support['lon'],
                **_bye_selection_metadata(bye_support),
            } if bye_support else {})
            gnss_age=max(0.,float(lag)) if kind in ('gnss','measured') and lag is not None else None
            gnss_metadata=({
                'gnssReferenceAgeSec':round(gnss_age,3),
                'possibleRadiusM':round(GNSS_BASE_OFFSET_M+GNSS_ASSUMED_SPEED_KMH/3.6*gnss_age),
                'referenceBasis':'last-known-gnss' if gnss_age>GNSS_RECENT_DIRECT_SECONDS else 'direct-gnss',
            } if gnss_age is not None else {})
            representative_points[cid]={
                'callId':cid,'areaId':region_id,
                'lat':lat,'lon':lon,'evidence':location_bases[cid],
                'representativeBasis':'bye-cell-site' if kind=='bye-cell' else 'cdr-end-nearest',
                'observedAt':observed_at,'cdrEndAt':end_at,
                'secondsBeforeEnd':lag,
                **({
                    'byeCellId':model['byeCellId'],
                    'byeRuId':model['byeRuId'],
                    'byeInventory':model['byeInventory'],
                    'byeTechnology':model['byeTechnology'],
                    'byeInventorySha256':model['byeInventorySha256'],
                    'byePci':model.get('byePci'),
                    'byeInventoryPciStatus':model.get('byeInventoryPciStatus'),
                    'byeInventoryPciCandidates':model.get('byeInventoryPciCandidates',[]),
                    **_bye_selection_metadata(model),
                } if kind=='bye-cell' else {}),
                **additional_bye,
                **gnss_metadata,
                'positionQuality':quality,
                'estimationMethod':method,
                'usedSiteCount':sites,
                'geometry':geometry,
                'residualErrorM':residual,
                'modelUncertaintyM':uncertainty,
                'modelConfidenceScore':confidence,
                'estimationWindowSec':model.get('estimatorWindowSec'),
            }
            category=(
                'assignedByeCellSites' if kind=='bye-cell' else
                'assignedGnssSamples' if kind in ('gnss','measured') else
                'assignedEstimatedSamples'
            )
            audit[category]+=1
            audit['assignedSamples']+=1
        elif len(possible)>1:
            audit['ambiguousBoundarySamples']+=1
        else:
            audit['outsideBoundarySamples']+=1
    if not audit['assignedSamples']:
        raise ValueError('행정동 공간 매칭 0건: SHP 좌표계·범위를 점검해야 합니다.')
    call_ids_by_region=defaultdict(list)
    kinds_by_region=defaultdict(Counter)
    for call in overview['calls']:
        ids = sorted(matches.get(call['id'], ()))
        call['gridIds'] = ids  # Existing filter contract; ids now refer to administrative dong.
        call['spatialEvidence'] = location_bases.get(call['id'], 'unavailable') if ids else 'unavailable'
        for region_id in ids:
            call_ids_by_region[region_id].append(call['id'])
            kinds_by_region[region_id][call['spatialEvidence']]+=1
    overview['cells'] = [
        {'id':region['id'],'lat':region['lat'],'lon':region['lon'],
         'label':region['label'],'callIds':call_ids_by_region[region['id']],
         'gnssCalls':kinds_by_region[region['id']]['gnss'],
         'estimatedCalls':kinds_by_region[region['id']]['estimated'],
         'byeCellCalls':kinds_by_region[region['id']]['bye-cell']}
        for region in registered if call_ids_by_region[region['id']]
    ]
    # One marker and one administrative dong per located call, independent of MOS.
    overview['callLocations'] = []
    for call in overview['calls']:
        position=representative_points.get(call['id'])
        if position is not None:
            overview['callLocations'].append({
                **position,
                'start':call['start'],
                'mos':call.get('mos'),
            })
    overview['representativeLocationBasis'] = 'cdr-end-nearest-or-bye-cell-site'
    overview['representativeMaxAgeSeconds'] = MAX_END_POSITION_AGE_SECONDS
    overview['representativeAfterEndToleranceSeconds'] = AFTER_END_TOLERANCE_SECONDS
    audit['visibleCallMarkers'] = len(overview['callLocations'])
    audit['distinctMarkerCallIds'] = len({marker['callId'] for marker in overview['callLocations']})
    overview['administrativeDongs'] = [
        {'id':region['id'],'lat':round(region['lat'],7),'lon':round(region['lon'],7),
         'label':region['label'], 'coordinates':region['coordinates']}
        for region in registered
    ]
    overview['spatialUnit'] = 'administrative-dong'
    overview['boundaryBaseDate'] = next(iter(dates))
    overview['boundarySource'] = shp.name
    audit['candidateAdministrativeDongs'] = len(registered)
    audit['observedAdministrativeDongs'] = len(overview['cells'])
    audit['locatedCalls'] = len(matches)
    audit['locatedGnssCalls'] = sum(location_bases.get(cid)=='gnss' for cid in matches)
    audit['locatedGnssLastKnownCalls']=sum(
        point['positionQuality']=='gnss-last-known'
        for point in representative_points.values()
    )
    audit['gnssLocationsWithUniqueByeSupport']=sum(
        point['evidence']=='gnss' and bool(point.get('byeRuId'))
        for point in representative_points.values()
    )
    audit['locatedEstimatedCalls'] = sum(location_bases.get(cid)=='estimated' for cid in matches)
    audit['locatedByeCellCalls'] = sum(location_bases.get(cid)=='bye-cell' for cid in matches)
    audit['unlocatedCalls'] = len(overview['calls']) - len(matches)
    overview['administrativeMappingAudit'] = dict(audit)
    return audit

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--overview', type=Path, required=True)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--public-dir', type=Path, default=Path(os.environ.get('QOE_PUBLIC_DIR','public')))
    parser.add_argument('--points', type=Path, default=None,
                        help='Normalized original GNSS and verified multi-cell radio estimates from the TypeScript pipeline')
    parser.add_argument('--shp', type=Path, default=Path('data/행정동경계/BND_ADM_DONG_PG.shp'))
    parser.add_argument('--bye-catalog', type=Path, default=None,
                        help='LTE inventory for uniquely matched CDR BYE sites (QOE_LTE_MASTER or newest workbook by default)')
    parser.add_argument('--nr-catalog', type=Path, default=None,
                        help='NR inventory declared in manifest byeStationInventories; Cell-only identities stay RAT-aware')
    args=parser.parse_args()
    overview=json.loads(args.overview.read_text(encoding='utf-8'))
    manifest=json.loads(args.manifest.read_text(encoding='utf-8'))
    if overview.get('source')!='MDT' or overview.get('sourceRevision')!=manifest.get('meta',{}).get('revision'):
        raise ValueError('소스 및 원본 버전이 일치하지 않습니다.')
    if not args.shp.is_file():
        raise FileNotFoundError(args.shp)
    audit=attach(overview, manifest, args.public_dir, args.shp, args.points, resolve_lte_master(args.bye_catalog),args.nr_catalog)
    # The caller writes a private temporary JSON and atomically publishes after success.
    args.overview.write_text(json.dumps(overview,ensure_ascii=False,separators=(',',':'),allow_nan=False),encoding='utf-8')
    print(json.dumps({'mapping':'administrative-dong','baseDate':overview['boundaryBaseDate'],**audit},ensure_ascii=False),flush=True)

if __name__=='__main__':
    main()
