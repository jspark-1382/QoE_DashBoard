"""Diagnostics of the coarse 3-site search centre against withheld same-call GNSS.

This is NOT a field-grade validation. The target GNSS coordinate is never
provided to the estimator. Only timestamped RSRP and source-verified LTE site
coordinates at/before that time are used. One changed GNSS fix per call.
"""
from __future__ import annotations
import collections,json,math,statistics
from pathlib import Path

from build_three_site_rough import build_site_catalog,centroid_candidate,distance_m,epoch

ROOT=Path(__file__).resolve().parent.parent
manifest=json.loads((ROOT/"public/voice-1030.json").read_text("utf8"))
inventory_metadata=manifest['meta'].get('stationInventory')
INVENTORY=(inventory_metadata.get('file') if isinstance(inventory_metadata,dict) else None) or '수도권_LTE_261103.xlsx'
counter=collections.Counter()
records=[]

def percentile(values,p):
    seq=sorted(values)
    return round(seq[min(len(seq)-1,max(0,math.ceil(len(seq)*p)-1))],2) if seq else None

for entry in manifest["days"]:
    if not entry.get("sampleCount"):continue
    detail=json.loads((ROOT/"public"/entry["dataPath"]).read_text("utf8"))
    sites=build_site_catalog(detail.get("baseStations",[]),INVENTORY)
    radio=collections.defaultdict(list)
    fixes=collections.defaultdict(list)
    for row in detail["samples"]:
        md=row[21] or {}
        t=epoch(md.get("timestamp"))
        if t is None:continue
        callid=str(row[19])
        if md.get("locationSource")=="gnss" and isinstance(row[2],(int,float)) and isinstance(row[3],(int,float)):
            fixes[callid].append((t,(float(row[2]),float(row[3]))))
        key=(str(md.get("baseStationId") or ""),str(md.get("cellId") or ""))
        xy=sites.get(key)
        if (md.get("baseStationMatched") is True and
            md.get("masterInventorySource")==INVENTORY and xy and
            isinstance(row[10],(int,float)) and -150<=float(row[10])<=-30):
            radio[callid].append({
              "time":t,"coord":xy,"rsrp":float(row[10]),
              "ru":key[0],"cell":key[1],"timestamp":md["timestamp"],
            })
    for callid,points in fixes.items():
        points.sort()
        novel=[]
        for p in points:
            if not novel or distance_m(p[1],novel[-1][1])>=.5:
                novel.append(p)
        if len(novel)<2:continue
        target=novel[-1]
        age=target[0]-novel[-2][0]
        if not 1<=age<=180:continue
        prior=[row for row in radio.get(callid,[]) if row["time"]<=target[0]]
        result=centroid_candidate(prior,target[0])
        if result is None:continue
        error=distance_m((result["lat"],result["lon"]),target[1])
        last_error=distance_m(novel[-2][1],target[1])
        records.append((error,last_error,result["roughSearchRadiusM"]))
        counter[entry["date"]]+=1

errors=[item[0] for item in records]
last=[item[1] for item in records]
report={
  "validationType":"withheld-same-call-GNSS-diagnostic-only",
  "sourceRevision":manifest["meta"]["revision"],
  "target":"latest GNSS fix whose coordinates changed >=0.5m, one per call",
  "independentSurveyGradeTruth":False,
  "noTargetCoordinateInPrediction":True,
  "noFutureRadioObservationsInPrediction":True,
  "notA90PercentAccuracyRegion":True,
  "cases":len(records),
  "byDate":dict(counter),
  "threeSiteRsrpWeightedCentre":{"medianErrorM":round(statistics.median(errors),2) if errors else None,
    "p90ErrorM":percentile(errors,.9),
    "within500mPct":round(100*sum(x<=500 for x in errors)/len(errors),2) if errors else None},
  "lastEarlierGnssOnSameCases":{"medianErrorM":round(statistics.median(last),2) if last else None,
    "p90ErrorM":percentile(last,.9)},
  "assumedSearchZoneContainsGnssPct":round(
     100*sum(item[0]<=item[2] for item in records)/len(records),2) if records else None,
  "interpretation":"GNSS is much better when already available; use rough 3-site only for GNSS-absent calls and display engineering search radius without confidence guarantee."
}
out=ROOT/"outputs/three-site-rough-holdout.json"
out.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf8")
print(json.dumps(report,ensure_ascii=False,indent=2))
