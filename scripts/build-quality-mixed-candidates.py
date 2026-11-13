"""Publish *exploratory*, GPS+MDT RSRP-centroid DBSCAN candidates.

DO NOT replace audited strict evidence or historical candidate JSON.
Use the same original DBSCAN implementation and input-source checks as the
existing full-period pipeline; inferred handset coordinates are provisional.

Usage:
  python scripts/build-quality-mixed-candidates.py --dry-run
  python scripts/build-quality-mixed-candidates.py
"""
from __future__ import annotations

import argparse
import json
import math
import os
from datetime import date, timedelta
from pathlib import Path

from voice_improvement_1 import _candidates
import importlib.util

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('quality_full_period_builder', ROOT / 'scripts' / 'build-quality-full-period.py')
assert spec is not None and spec.loader is not None
strict_builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(strict_builder)
approved_by_day = strict_builder.approved_by_day
POLICY = strict_builder.POLICY
REVISION = strict_builder.REVISION
REVISION_INDEX = strict_builder.REVISION_INDEX
days_between = strict_builder.days_between
PUBLIC=Path(os.environ.get('QOE_PUBLIC_DIR', ROOT/'public'))
OVER = PUBLIC / "analyst-overview" / "MDT"
ROUGH = PUBLIC / "three-site-rough"
FULL_INDEX = PUBLIC / "quality-improvement-full" / "index.json"
HOLD_INDEX = PUBLIC / "quality-improvement" / "index.json"
NAME = "gps-mdt-rough-unvalidated-v1"
POLICY_VERSION = "THREE_SITE_RSRP_CENTROID"
RANGE = (600, 5000)

def read(path):
    return json.loads(path.read_text(encoding="utf-8"))

def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False), encoding="utf-8")

def valid_rough(point, call, boundaries, old):
    if point.get("callId") != call["id"] or point.get("areaId") not in boundaries:
        return False
    if old and (old.get("evidence") == "gnss" or old.get("positionQuality") == "trilateration-reviewable"):
        return False
    if (point.get("evidence"), point.get("positionQuality"), point.get("estimationMethod"), point.get("representativeBasis")) != (
        "estimated", "three-site-rough", POLICY_VERSION, "cdr-end-nearest"
    ):
        return False
    lat, lon = point.get("lat"), point.get("lon")
    if not all(isinstance(x, (int, float)) and math.isfinite(x) for x in [lat, lon]):
        return False
    if not (33 <= lat <= 39.8 and 124 <= lon <= 132):
        return False
    n, radius, seconds, sites = point.get("usedSiteCount"), point.get("roughSearchRadiusM"), point.get("secondsBeforeEnd"), point.get("usedStations")
    if type(n) is not int or n < 3 or not isinstance(sites, list) or len(sites) != n:
        return False
    if not isinstance(radius, (int,float)) or not math.isfinite(radius) or not RANGE[0] <= radius <= RANGE[1]:
        return False
    if not isinstance(seconds, (int,float)) or not math.isfinite(seconds) or not -1 <= seconds <= 180:
        return False
    if any(not isinstance(s.get("ruId"),str) or not s.get("ruId") or not s.get("cellId")
           or not all(isinstance(s.get(k),(float,int)) and math.isfinite(s.get(k)) for k in ("lat","lon","rsrpDbm"))
           for s in sites):
        return False
    # Geographic distinctness of observed sites is necessary for the rough coordinate.
    coords = {(round(s["lat"],7), round(s["lon"],7)) for s in sites}
    return len(coords) >= 3

def source_by_date(strict):
    combined = {}
    all_counts = {"gnss":0, "rough":0, "overlapPrevented":0}
    reviewed_radio = 0
    for d in REVISION_INDEX["availableDates"]:
        overview = read(OVER/(d+".json"))
        rough = read(ROUGH/(d+".json"))
        assert overview["sourceRevision"] == REVISION
        assert rough["schemaVersion"]=="coarse-three-site-v1" and rough["sourceRevision"]==REVISION
        assert rough["date"]==d and rough["method"]==POLICY_VERSION and rough["notA90PercentAccuracyRegion"] is True
        calls={call["id"]:call for call in overview["calls"]}
        boundaries={area["id"] for area in overview.get("administrativeDongs",[])}
        locations={p["callId"]:p for p in overview.get("callLocations",[])}
        approved, cdrs, approvals = strict[d]
        results=dict(approved)
        all_counts["gnss"] += sum(p["kind"]=="gnss" for p in approved.values())
        reviewed_radio += sum(p['kind']=='reviewed-radio' for p in approved.values())
        for point in rough["points"]:
            call = calls.get(point.get("callId"))
            if call is None or not valid_rough(point,call,boundaries,locations.get(point["callId"])):
                continue
            if not isinstance(call.get("mos"),(int,float)) or isinstance(call["mos"],bool) or not 1 <= call["mos"] < 3:
                continue
            call_id = d + ":" + call["id"] if not call["id"].startswith(d+":") else call["id"]
            if call_id in results:
                all_counts["overlapPrevented"]+=1
                continue
            results[call_id]=dict(
                callId=call_id,rawCallId=call.get("rawCallId"),customerId=call["customerId"],
                date=d,mos=float(call["mos"]),lat=point["lat"],lon=point["lon"],kind="rough",
                observedAt=point.get("observedAt"),ageSec=point.get("secondsBeforeEnd"),
                roughSearchRadiusM=point["roughSearchRadiusM"],usedSiteCount=point["usedSiteCount"],
                positionStatus="unvalidated",estimationMethod=POLICY_VERSION
            )
            cdrs[call_id]=dict(
                date=d,callId=call_id,rawCallId=call.get("rawCallId"),
                customerId=call["customerId"],startedAt=call.get("startTimestamp"),
                endedAt=None,mos=call["mos"],sipReason=call.get("sipCause"),
                mdtLinkStatus="unique",sourceRevision=REVISION,
                sourceFile="three-site-rough/"+d+".json",
                overviewSourceFile=d+".json",start=call.get("start"),end=call.get("end"),
                endCellId=call.get("endCellId"),contractId=call.get("contractId")
            )
            # Provisional is NOT an audited, accepted location decision.
            approvals[call_id]={
                "status":"provisional", "kind":"rough", "lat":point["lat"],"lon":point["lon"],
                "observedAt":point.get("observedAt"),"ageSec":point.get("secondsBeforeEnd"),
                "review":None,"reasons":["position-accuracy-unvalidated"],
                "referenceBasis":"THREE_SITE_RSRP_CENTROID",
                "roughSearchRadiusM":point["roughSearchRadiusM"],
                "usedSiteCount":point["usedSiteCount"],
                "lineage":{"date":d,"sourceRevision":REVISION,
                           "sourceFile":"three-site-rough/"+d+".json",
                           "rawCallId":call.get("rawCallId")}
            }
            all_counts["rough"]+=1
        combined[d]=(results,cdrs,approvals,calls)
    if reviewed_radio:
        all_counts['reviewedRadio'] = reviewed_radio
    assert sum(len(day[0]) for day in combined.values()) == all_counts['gnss'] + all_counts['rough'] + reviewed_radio
    return combined,all_counts

def generate(mode, source_index, by_day, dry_run):
    output=PUBLIC/("quality-improvement-mixed-full" if mode=="all" else "quality-improvement-mixed-evaluation")
    entries=[]
    stats=[]
    for entry in source_index["entries"]:
        scope=entry["scope"]
        assert scope["sourceRevision"]==REVISION and scope["policy"]=="strict-3-site-v1"
        dates=days_between(scope["dateStart"],scope["dateEnd"])
        if mode=="evaluation" and len(dates)<3:
            continue
        discover,validate=(dates,[]) if mode=="all" else (dates[:-1],dates[-1:])
        beg=int(scope["from"][:2])*3600+int(scope["from"][3:5])*60
        end=int(scope["to"][:2])*3600+int(scope["to"][3:5])*60+59
        points=[]
        cdrs={}
        decisions={}
        for d in dates:
            part,calls,approval,raw_calls=by_day[d]
            for call_id,p in part.items():
                # Full original CDR startSecond / time filtering applies to both GNSS and rough points.
                raw_id=call_id[len(d)+1:]
                raw=raw_calls.get(raw_id)
                if raw is None or not beg <= raw["startSecond"] <= end:
                    continue
                points.append(p)
                cdrs[call_id]=calls[call_id]
                decisions[call_id]=approval[call_id]
        points.sort(key=lambda p:p["callId"])
        assert len(points)==len(cdrs)==len(decisions)==len({p["callId"] for p in points})
        candidates,noise=_candidates(points, discover,validate,POLICY)
        lookup={p["callId"]:p for p in points}
        for candidate in candidates:
            medoid=lookup[candidate["medoid"]["callId"]]
            candidate["medoid"]["kind"]=medoid["kind"]
            candidate["roughCallCount"]=sum(lookup[id_]["kind"]=="rough" for id_ in candidate["memberCallIds"])
            candidate["positionMode"]=NAME
            candidate["investigationRequired"]=True
        prefix="mixed-full-" if mode=="all" else "mixed-eval-"
        scope_key=prefix+entry["scopeKey"]
        directory=REVISION+"/"+scope_key
        for c in candidates:
            cid=c["id"]
            member_ids=set(c["memberCallIds"])
            ids={p["callId"] for p in c["nearbyPoints"]}
            assert member_ids<=ids
            candidate_calls=sorted(ids)
            detail={
                "schemaVersion":"quality-candidate-detail-v1",
                "scope":scope,"scopeKey":scope_key,"locationMode":NAME,
                "candidate":c,"calls":[cdrs[id_] for id_ in candidate_calls],
                "decisions":[{"callId":id_,**decisions[id_]} for id_ in candidate_calls]
            }
            if not dry_run:
                write(output/directory/(cid+".json"),detail)
        affected={lookup[id_]["customerId"] for c in candidates for id_ in c["memberCallIds"]}
        cards=[]
        for i,c in enumerate(candidates):
            cards.append(dict(
                id=c["id"],label=("전체 기간 후보 " if mode=="all" else "검증 후보 ")+str(i+1),
                poorCustomerCount=c["poorCustomerCount"],poorCallCount=c["poorCallCount"],
                poorDateCount=c["poorDateCount"],gnssCallCount=c["gnssCallCount"],
                roughCallCount=c["roughCallCount"],medoid=c["medoid"],
                displayRadiusM=c["displayRadiusM"],rangeReviewRequired=c["rangeReviewRequired"],
                rank=c["rank"],validationStatus=c["validationStatus"],
                validationNewCustomers=len(c["validationNewCustomerIds"]),
                detailPath=directory+"/"+c["id"]+".json"
            ))
        summary={
            "schemaVersion":"quality-candidate-summary-v1","scope":scope,"scopeKey":scope_key,
            "locationMode":NAME,"locationUnvalidated":True,
            "discoveryDates":discover,"validationDates":validate,
            "distinctAffectedCustomers":len(affected),
            "auditReference":"docs/quality-gps-mdt-rough-exploratory-20261110.md",
            "observationPath":directory+"/observations.json",
            "inputCounts":{"gnss":sum(p["kind"]=="gnss" for p in points),
                           "rough":sum(p["kind"]=="rough" for p in points),
                           **({'reviewedRadio':sum(p['kind']=='reviewed-radio' for p in points)}
                              if any(p['kind']=='reviewed-radio' for p in points) else {})},
            "candidates":cards
        }
        if not dry_run:
            write(output/directory/"summary.json",summary)
            write(output/directory/"observations.json",{
                "schemaVersion":"quality-observations-v1","scope":scope,
                "locationMode":NAME,"points":points
            })
        entries.append({"scope":scope,"scopeKey":scope_key,"path":directory+"/summary.json"})
        stats.append({
            "scope":scope["dateStart"]+".."+scope["dateEnd"],"mode":mode,
            "inputPoints":len(points),"gnss":summary["inputCounts"]["gnss"],
            "rough":summary["inputCounts"]["rough"],"candidates":len(candidates),
            "withRough":sum(c["roughCallCount"]>0 for c in candidates),
            "roughMemberCalls":sum(c["roughCallCount"] for c in candidates),
            "affectedCustomers":len(affected)
        })
    if not dry_run:
        write(output/"index.json",{
            "schemaVersion":"quality-improvement-index-v1","sourceRevision":REVISION,
            "analysisMode":mode,"locationMode":NAME,"locationUnvalidated":True,
            "availableDates":REVISION_INDEX["availableDates"],"entries":entries,"evidence":[]
        })
    return stats

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--dry-run",action="store_true")
    args=parser.parse_args()
    strict=approved_by_day()
    day_data,counts=source_by_date(strict)
    full=generate("all",read(FULL_INDEX),day_data,args.dry_run)
    evaluation=generate("evaluation",read(HOLD_INDEX),day_data,args.dry_run)
    print(json.dumps({"mode":NAME,"data":counts,"full":full,"evaluation":evaluation},
                     ensure_ascii=False,indent=2),flush=True)

if __name__=="__main__":
    main()
