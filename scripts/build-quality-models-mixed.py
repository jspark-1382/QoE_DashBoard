"""Recompute five existing alternative models with unified GPS and MDT RSRP positions.

This is a separately published, exploratory series. Strict outputs are unchanged.
The spatial-scan / Bayesian normal-location controls use the same provisional
MDT eligibility rules as poor-QoE cases (without claiming population accuracy).
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import math
import os
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
TAG="gps-mdt-rough-unvalidated-v1"
SRC_DIR=ROOT/"scripts"
PUB=Path(os.environ.get('QOE_PUBLIC_DIR', ROOT/'public'))

def import_script(name, filename):
    spec=importlib.util.spec_from_file_location(name,SRC_DIR/filename)
    assert spec and spec.loader
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

models=import_script("strict_alternative_model","build-quality-model-alternatives.py")
mixed=import_script("mixed_candidate_pipeline","build-quality-mixed-candidates.py")
REVISION=mixed.REVISION

def read(p):
    return json.loads(p.read_text(encoding="utf8"))

def by_date():
    original=models.accepted_call_positions(REVISION)
    totals=dict(gnssPoor=0,roughPoor=0,gnssNormal=0,roughNormal=0,overlapPrevented=0,
                reviewedRadioPoor=0,reviewedRadioNormal=0)
    for d in mixed.REVISION_INDEX["availableDates"]:
        overview=read(mixed.OVER/(d+".json"))
        part=read(mixed.ROUGH/(d+".json"))
        assert overview["sourceRevision"]==REVISION and part["sourceRevision"]==REVISION
        assert part["method"]=="THREE_SITE_RSRP_CENTROID" and part["date"]==d and part["notA90PercentAccuracyRegion"] is True
        call_by_id={x["id"]:x for x in overview["calls"]}
        areas={a["id"] for a in overview.get("administrativeDongs",[])}
        locations={x["callId"]:x for x in overview.get("callLocations",[])}
        existing={p["callId"]:p for p in original[d]["points"]}
        for p in part["points"]:
            call=call_by_id.get(p.get("callId"))
            if call is None or not mixed.valid_rough(p,call,areas,locations.get(call["id"])):
                continue
            mos=call.get("mos")
            if not isinstance(mos,(int,float)) or isinstance(mos,bool) or not math.isfinite(mos) or not 1<=mos<=5:
                continue
            call_id=d+":"+call["id"] if not call["id"].startswith(d+":") else call["id"]
            if call_id in existing:
                totals["overlapPrevented"]+=1
                continue
            existing[call_id]={
                "callId":call_id,"customerId":call["customerId"],"date":d,
                "mos":round(float(mos),4),"lat":float(p["lat"]),"lon":float(p["lon"]),
                "kind":"rough","startSecond":int(call.get("startSecond") or 0),
                "observedAt":p.get("observedAt"),"roughSearchRadiusM":p.get("roughSearchRadiusM"),
                "usedSiteCount":p.get("usedSiteCount"),"positionStatus":"unvalidated",
                "estimationMethod":"THREE_SITE_RSRP_CENTROID"
            }
            band="poor" if mos<3 else "normal"
            original[d]["located"][band]+=1
        original[d]["points"]=sorted(existing.values(),key=lambda x:x["callId"])
        totals["gnssPoor"]+=sum(p["kind"]=="gnss" and p["mos"]<3 for p in existing.values())
        totals["roughPoor"]+=sum(p["kind"]=="rough" and p["mos"]<3 for p in existing.values())
        totals["gnssNormal"]+=sum(p["kind"]=="gnss" and p["mos"]>=3 for p in existing.values())
        totals["roughNormal"]+=sum(p["kind"]=="rough" and p["mos"]>=3 for p in existing.values())
        totals['reviewedRadioPoor']+=sum(p['kind']=='reviewed-radio' and p['mos']<3 for p in existing.values())
        totals['reviewedRadioNormal']+=sum(p['kind']=='reviewed-radio' and p['mos']>=3 for p in existing.values())
    assert sum(day['located']['poor'] for day in original.values()) == totals['gnssPoor'] + totals['roughPoor'] + totals['reviewedRadioPoor'],totals
    assert all(len(day["points"])==len({p["callId"] for p in day["points"]}) for day in original.values())
    return original,totals

def publish(mode,byday,preview=False):
    assert mode in ("all","evaluation")
    src=PUB/("quality-improvement-mixed-full" if mode=="all" else "quality-improvement-mixed-evaluation")
    dest=PUB/("quality-models-mixed-full" if mode=="all" else "quality-models-mixed-evaluation")
    source=read(src/"index.json")
    assert source["locationMode"]==TAG and source["sourceRevision"]==REVISION
    index={"schemaVersion":"quality-model-index-v1","sourceRevision":REVISION,
           "analysisMode":mode,"locationMode":TAG,"locationUnvalidated":True,"entries":[]}
    out=[]
    for item in source["entries"]:
        summary=read(src/item["path"])
        scope=summary["scope"]
        dates=mixed.days_between(scope["dateStart"],scope["dateEnd"])
        discovery=summary["discoveryDates"]
        validation=summary["validationDates"]
        from_s=int(scope["from"][:2])*3600+int(scope["from"][3:])*60
        to_s=int(scope["to"][:2])*3600+int(scope["to"][3:])*60+59
        points=sorted((p for d in dates for p in byday[d]["points"] if from_s<=p["startSecond"]<=to_s),key=lambda p:p["callId"])
        train=[p for p in points if p["date"] in discovery and p["mos"]<3]
        valid=[p for p in points if p["date"] in validation and p["mos"]<3]
        normal=[p for p in points if p["date"] in discovery and p["mos"]>=3]
        # Exact same set of low-QoE model inputs as the existing mixed DBSCAN.
        approved_points=read(src/summary["observationPath"])["points"]
        assert {p["callId"] for p in train+valid}=={p["callId"] for p in approved_points},scope
        assert len(train+valid)==len(approved_points)
        outcomes={}
        for name in models.MODELS:
            entry=models.model_entry(name,train,normal,valid)
            for candidate in entry["candidates"]:
                members=candidate["members"]
                kinds={p["callId"]:p["kind"] for p in members}
                candidate["roughCalls"]=sum(k=="rough" for k in kinds.values())
                candidate['reviewedRadioCalls']=sum(p['kind']=='reviewed-radio' for p in members)
                assert candidate["roughCalls"]+candidate["gnssCalls"]+candidate['reviewedRadioCalls']==candidate["poorCalls"]
                center=min(members,key=lambda p:models.haversine_to(p,[{"lat":candidate["lat"],"lon":candidate["lon"]}])[0])
                candidate["medoidKind"]=center["kind"]
                candidate["locationMode"]=TAG
                candidate["locationUnvalidated"]=True
            entry["parameters"]["locationInputs"]="GPS + MDT THREE_SITE_RSRP_CENTROID (unvalidated)"
            if name=="adaptive_kde":
                # 160m is an assumed smoothing bandwidth, not measured MDT accuracy.
                entry["parameters"]["roughBandwidthAssumedM"]=160
            if name in ("spatial_scan","bayesian"):
                entry["parameters"]["normalLocationPolicy"]=TAG
                entry["parameters"]["population"]="GPS+MDT-located-only (unvalidated selection)"
            entry["discoveryLocatedPoorCalls"]=entry.pop("discoveryApprovedPoorCalls")
            entry["discoveryLocatedNormalCalls"]=entry.pop("discoveryApprovedNormalCalls")
            outcomes[name]=entry
        cover=models.count_coverage(dates,byday)
        record={
            "schemaVersion":"quality-alternative-models-v1","analysisMode":mode,
            "scope":scope,"scopeKey":summary["scopeKey"],"sourceRevision":REVISION,
            "locationMode":TAG,"locationUnvalidated":True,
            "discoveryDates":discovery,"validationDates":validation,
            "coverage":cover,
            "inputCounts":{
                "gpsPoor":sum(p["kind"]=="gnss" and p["mos"]<3 for p in train),
                "roughPoor":sum(p["kind"]=="rough" and p["mos"]<3 for p in train),
                "gpsNormal":sum(p["kind"]=="gnss" and p["mos"]>=3 for p in normal),
                "roughNormal":sum(p["kind"]=="rough" and p["mos"]>=3 for p in normal),
                **({'reviewedRadioPoor':sum(p['kind']=='reviewed-radio' for p in train),
                    'reviewedRadioNormal':sum(p['kind']=='reviewed-radio' for p in normal)}
                   if any(p['kind']=='reviewed-radio' for p in train+normal) else {})
            },
            "selectionBiasWarning":"GPS·MDT 근사 좌표의 확보 여부가 QoE 등급·지역·기지국 구성과 연관될 수 있습니다. MDT 좌표 정확도도 검증되지 않았으므로 Spatial Scan/Bayesian의 표본 내 비율·p값·사후확률은 통신망 전체의 확정 위험도로 사용하면 안 됩니다.",
            "models":outcomes
        }
        name=f"{REVISION}/{summary['scopeKey']}.json"
        if not preview:
            models.dump(dest/name,record)
        index["entries"].append({
            "scope":scope,"scopeKey":summary["scopeKey"],"path":name,
            "candidateCounts":{k:len(v["candidates"]) for k,v in outcomes.items()}
        })
        row={
            "mode":mode,"scope":scope["dateStart"]+".."+scope["dateEnd"],
            "trainGps":record["inputCounts"]["gpsPoor"],"trainRough":record["inputCounts"]["roughPoor"],
            "normalGps":record["inputCounts"]["gpsNormal"],"normalRough":record["inputCounts"]["roughNormal"],
            "candidateCounts":{k:len(v["candidates"]) for k,v in outcomes.items()},
            "withRough":{k:sum(c["roughCalls"]>0 for c in v["candidates"]) for k,v in outcomes.items()}
        }
        out.append(row)
        print(json.dumps(row,ensure_ascii=False),flush=True)
    if not preview:
        models.dump(dest/"index.json",index)
    return out

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--analysis-mode",choices=("all","evaluation"),required=True)
    parser.add_argument("--dry-run",action="store_true")
    args=parser.parse_args()
    parts,totals=by_date()
    print(json.dumps({"allInputSourceCounts":totals},ensure_ascii=False),flush=True)
    publish(args.analysis_mode,parts,args.dry_run)

if __name__=="__main__":
    main()
