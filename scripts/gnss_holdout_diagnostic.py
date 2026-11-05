"""Leakage-controlled GNSS holdout diagnostics using published raw-derived fixes.

This is a diagnostic, NOT a certified position-accuracy study:
- source EPSG:5179 is asserted by existing importer, GNSS device accuracy absent
- no ground-truth survey, no RTP interval truth, no learned model
- one last fix per matched call is withheld; only strictly earlier fixes used
- no customer IDs, contract IDs or coordinates are exported
"""
from __future__ import annotations
import collections
import json
import math
import statistics
import sys
from datetime import datetime
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/"scripts"))
from lte_station_catalog import load_unique_bye_cells

def great_circle_m(a,b):
    lat1,lon1=a; lat2,lon2=b
    p1,p2=math.radians(lat1),math.radians(lat2)
    dp=p2-p1; dl=math.radians(lon2-lon1)
    q=math.sin(dp/2)**2+math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2*6371008.8*math.asin(min(1,math.sqrt(q)))

def percentile(values,p):
    if not values:return None
    ordered=sorted(values); at=(len(ordered)-1)*p
    lo=int(math.floor(at)); hi=int(math.ceil(at))
    return round(ordered[lo]*(hi-at)+ordered[hi]*(at-lo),2) if lo!=hi else round(ordered[lo],2)

def point_from_row(row):
    if len(row)<22:return None
    md=row[21] or {}
    if md.get("locationSource")!="gnss" or md.get("gnssCrs")!="EPSG:5179":return None
    lat,lon=row[2],row[3]
    if not (isinstance(lat,(float,int)) and isinstance(lon,(float,int))):return None
    if not (33<=lat<=39 and 124<=lon<=132):return None
    try: ts=datetime.fromisoformat(md["timestamp"].replace("Z","+00:00")).timestamp()
    except (KeyError,TypeError,AttributeError,ValueError):return None
    return {"t":ts,"pos":(float(lat),float(lon)),"ru":str(md.get("baseStationId") or ""),
            "cell":str(md.get("cellId") or ""), "raw_xy":(md.get("gnssUtmkx"),md.get("gnssUtmky"))}

def collapse_duplicates(rows):
    ordered=sorted(rows,key=lambda x:x["t"])
    distinct=[]
    for p in ordered:
        # Multiple MDT cell samples may carry the same GNSS fix/time.
        if distinct and p["t"]-distinct[-1]["t"]<1 and great_circle_m(p["pos"],distinct[-1]["pos"])<3:
            continue
        distinct.append(p)
    return distinct

def velocity_prediction(older,recent,target,max_speed_mps=35):
    if not (older["t"] < recent["t"] < target["t"]):return None
    dt=recent["t"]-older["t"]
    gap=target["t"]-recent["t"]
    if not (3<=dt<=180 and 5<=gap<=180):return None
    speed=great_circle_m(older["pos"],recent["pos"])/dt
    if speed>max_speed_mps:return None
    origin=recent["pos"]
    lat_scale=111195.08
    lon_scale=lat_scale*math.cos(math.radians(origin[0]))
    if lon_scale<=0:return None
    dy=(recent["pos"][0]-older["pos"][0])*lat_scale/dt*gap
    dx=(recent["pos"][1]-older["pos"][1])*lon_scale/dt*gap
    return (origin[0]+dy/lat_scale,origin[1]+dx/lon_scale)

def metrics(records,field):
    errors=[item[field] for item in records if item.get(field) is not None]
    if not errors:return {"count":0,"p50_m":None,"p90_m":None,"within_100m_pct":None,"within_300m_pct":None,"within_1000m_pct":None}
    return {"count":len(errors),"p50_m":percentile(errors,.5),"p90_m":percentile(errors,.9),
            "within_100m_pct":round(100*sum(v<=100 for v in errors)/len(errors),2),
            "within_300m_pct":round(100*sum(v<=300 for v in errors)/len(errors),2),
            "within_1000m_pct":round(100*sum(v<=1000 for v in errors)/len(errors),2)}

def evaluate():
    index=json.loads((ROOT/"public/voice-1030.json").read_text(encoding="utf8"))
    candidate=[]
    counts=collections.Counter()
    for entry in index["days"]:
        if not entry.get("gnssSampleCount",0):continue
        d=json.loads((ROOT/"public"/entry["dataPath"]).read_text(encoding="utf8"))
        calls={c["id"]:c for c in d["calls"]}
        groups=collections.defaultdict(list)
        for row in d["samples"]:
            fix=point_from_row(row)
            if fix is not None:groups[row[19]].append(fix)
        for callid,rows in groups.items():
            counts["gnss_calls"]+=1;counts["gnss_rows"]+=len(rows)
            call=calls.get(callid)
            if not call or call.get("matchStatus")!="MATCHED":
                counts["not_unique_join"]+=1;continue
            fixes=collapse_duplicates(rows)
            if len(fixes)<2:counts["less_than_two_distinct"]+=1;continue
            recent,target=fixes[-2:]
            age=target["t"]-recent["t"]
            if not (5<=age<=180):counts["age_outside_5_180"]+=1;continue
            # The last observed fix is the withheld target, not part of model inputs.
            record={"date":entry["date"],"customer":d.get("customerId"),
                    "target_cell":target["cell"], "call":callid, "age_s":round(age,3),
                    "error_hold_m":great_circle_m(recent["pos"],target["pos"]),
                    "end_cell":str(call.get("endCellId") or ""),
                    "target_position":target["pos"]}
            if len(fixes)>=3:
                predicted=velocity_prediction(fixes[-3],recent,target)
                if predicted is not None:
                    record["error_velocity_m"]=great_circle_m(predicted,target["pos"])
            # Only a scenario bound; NEVER call this a calibrated confidence interval.
            record["within_assumed_envelope"]=record["error_hold_m"]<=250+120/3.6*age
            candidate.append(record)
    requested={p["end_cell"] for p in candidate if p["end_cell"]}
    sites,site_audit=load_unique_bye_cells(ROOT/"data/BaseStation/수도권_LTE_261103.xlsx",requested)
    for p in candidate:
        tower=sites.get(p["end_cell"])
        if tower:
            p["error_bye_site_m"]=great_circle_m((tower["lat"],tower["lon"]),p["target_position"])
    dev=[p for p in candidate if p["date"]<="2026-10-28"]
    later=[p for p in candidate if p["date"]>="2026-10-29"]
    dev_customers={p["customer"] for p in dev}
    dev_cells={p["target_cell"] for p in dev}
    # Don't allow the same customer or cell in both development and test.
    strict=[p for p in later if p["customer"] not in dev_customers and p["target_cell"] not in dev_cells]
    paired=[p for p in strict if "error_velocity_m" in p]
    by_date={}
    for date in sorted({p["date"] for p in candidate}):
        by_date[date]=metrics([p for p in candidate if p["date"]==date],"error_hold_m")
    report={
      "evaluation_scope":"DIAGNOSTIC_HOLDOUT_NOT_FIELD_CERTIFIED",
      "provenance":"raw-derived publication public/voice-1030.json; original schema independently audited",
      "coordinate_crs":"EPSG:5179 as configured by importer; supplier accuracy metadata absent",
      "withheld_truth":"one final same-call converted GNSS fix; no test fix used by predictors",
      "exclusion":{"min_age_sec":5,"max_age_sec":180,"dedupe_time_sec":1,"dedupe_radius_m":3},
      "counts":dict(counts),"eligible_calls":len(candidate),
      "development_period":"2026-10-26..2026-10-28","development_count":len(dev),
      "test_period":"2026-10-29..2026-10-30","test_date_only_count":len(later),
      "customer_and_cell_disjoint_test_count":len(strict),
      "same_customer_as_development_excluded":sum(p["customer"] in dev_customers for p in later),
      "same_cell_as_development_excluded":sum(p["target_cell"] in dev_cells for p in later),
      "candidate_velocity_valid_on_strict_test":len(paired),
      "baselines":{
        "last_observed_gnss_all":metrics(candidate,"error_hold_m"),
        "bye_tower_reference_all":metrics(candidate,"error_bye_site_m"),
        "last_observed_gnss_strict_test":metrics(strict,"error_hold_m"),
        "bye_tower_reference_strict_test":metrics(strict,"error_bye_site_m"),
        "last_gnss_paired_test":metrics(paired,"error_hold_m"),
        "constant_velocity_paired_test":metrics(paired,"error_velocity_m"),
        "old_rsrp_multilateration":"NOT_TESTED: must rerun engine with target/future GNSS entirely masked",
        "gnss_mdt_fused":"NOT_TESTED: no independently proven fusion estimator available"
      },
      "scenario_envelope_coverage_pct":round(100*sum(p["within_assumed_envelope"] for p in candidate)/len(candidate),2) if candidate else None,
      "scenario_envelope_is_not_confidence_interval":True,
      "calibrated_90pct_region_coverage":None,
      "by_date_hold":by_date,"bye_site_match_audit":site_audit,
      "not_certified_reasons":[
         "GNSS measurement uncertainty and device/antenna reference missing",
         "MDT GNSS and cell data were generated by the existing extraction pipeline",
         "No separately surveyed field truth or RTP/RTCP impairment-window truth",
         "Only strict holdout diagnostic; no spatially independent training/validation calibration"
      ]
    }
    # Never export coordinates, customer/call IDs, raw site IDs.
    out=ROOT/"outputs"/"gnss-holdout-diagnostic.json"
    out.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf8")
    print(json.dumps({k:report[k] for k in ("eligible_calls","development_count","test_date_only_count","customer_and_cell_disjoint_test_count","candidate_velocity_valid_on_strict_test","baselines","scenario_envelope_coverage_pct")},ensure_ascii=False,indent=2))
    return report
if __name__=="__main__":evaluate()
