"""Publish *coarse* 3-independent-site investigation areas for existing QoE UI.

This does NOT replace any original GNSS or CDR data. It creates small
per-date sidecars consumed only by the existing "3사이트 추정" filter.
The point is a signal-weighted *site centre*, NOT RSRP distance
trilateration, a surveyed handset location, or a 90% accuracy region.
"""
from __future__ import annotations
import collections
from datetime import datetime
import json
import math
import os
from pathlib import Path

from shapely.geometry import Point, shape
from shapely.prepared import prep

ROOT=Path(__file__).resolve().parent.parent
PUBLIC=ROOT/"public"
INVENTORY="수도권_LTE_261103.xlsx"
WINDOW_SECONDS=30
MAX_END_AGE_SECONDS=180
COLLOCATED_METERS=20
MAX_SITE_SPAN_M=4000
MAX_SEARCH_RADIUS_M=5000

def number(x):
    return isinstance(x,(int,float)) and not isinstance(x,bool) and math.isfinite(x)

def epoch(text):
    if not isinstance(text,str):return None
    try:
        dt=datetime.fromisoformat(text.replace("Z","+00:00"))
        return dt.timestamp() if dt.utcoffset() is not None else None
    except ValueError:return None

def distance_m(a,b):
    lat=(a[0]+b[0])/2
    return math.hypot((a[0]-b[0])*111195.08,
                      (a[1]-b[1])*111195.08*math.cos(math.radians(lat)))

def build_site_catalog(stations):
    pairs=collections.defaultdict(set)
    for s in stations:
        if s.get("inventorySource")!=INVENTORY or s.get("isVirtual"):
            continue
        ru,cell=str(s.get("baseStationId") or ""),str(s.get("cellId") or "")
        lat,lon=s.get("latitude"),s.get("longitude")
        if ru and cell and number(lat) and number(lon) and 33<=lat<=39.8 and 124<=lon<=132:
            pairs[(ru,cell)].add((round(lat,9),round(lon,9)))
    # In the CDR-linked partitions these rows originate from exact RU+Cell
    # lookups in the full LTE inventory, not a cell-only centroid.
    return {key:next(iter(coords)) for key,coords in pairs.items() if len(coords)==1}

def physical_sites(samples):
    """Collapse sectors co-located within 20m into one site."""
    picked=[]
    for row in sorted(samples,key=lambda row:(-row["rsrp"],-row["time"])):
        if any(distance_m(row["coord"],prior["coord"])<=COLLOCATED_METERS for prior in picked):
            continue
        picked.append(row)
    return picked

def centroid_candidate(samples,target_time):
    """All source radio samples are at or before target_time; no GNSS input."""
    recent=[s for s in samples if 0<=target_time-s["time"]<=WINDOW_SECONDS]
    sites=physical_sites(recent)
    if len(sites)<3:return None
    span=max(distance_m(a["coord"],b["coord"]) for a in sites for b in sites)
    if span>MAX_SITE_SPAN_M:return None
    strongest=max(p["rsrp"] for p in sites)
    # Signal strength is only a ranking weight, not RSRP-to-metres conversion.
    weights=[max(.10,math.exp((p["rsrp"]-strongest)/18)) for p in sites]
    total=sum(weights)
    lat=sum(p["coord"][0]*w for p,w in zip(sites,weights))/total
    lon=sum(p["coord"][1]*w for p,w in zip(sites,weights))/total
    # A conservative engineering *search area*, not a calibrated confidence bound.
    radius=max(700,400+1.6*max(distance_m((lat,lon),p["coord"]) for p in sites))
    if radius>MAX_SEARCH_RADIUS_M:return None
    return {
      "lat":round(lat,7),"lon":round(lon,7),
      "usedSiteCount":len(sites),
      "siteSpanM":round(span),
      "roughSearchRadiusM":round(radius),
      "usedStations":[{
         "lat":p["coord"][0],"lon":p["coord"][1],
         "ruId":p["ru"],"cellId":p["cell"],"rsrpDbm":p["rsrp"],
      } for p in sites],
    }

def locate_district(point,districts):
    lonlat=Point(point["lon"],point["lat"])
    for district_id,polygon in districts:
        if polygon.covers(lonlat):return district_id
    return None

def district_shapes(overview):
    result=[]
    for area in overview.get("administrativeDongs",[]):
        polygon=shape({"type":"MultiPolygon","coordinates":area["coordinates"]})
        if polygon.is_valid and not polygon.is_empty:
            result.append((area["id"],polygon))
    return result

def build():
    manifest=json.loads((PUBLIC/"voice-1030.json").read_text("utf8"))
    revision=manifest["meta"]["revision"]
    dates=manifest["meta"]["dates"]
    outdir=PUBLIC/"three-site-rough"
    outdir.mkdir(parents=True,exist_ok=True)
    day_boundaries={}
    existing={}
    for day in dates:
        overview=json.loads((PUBLIC/"analyst-overview"/"MDT"/(day+".json")).read_text("utf8"))
        if overview.get("sourceRevision")!=revision:raise RuntimeError("overview revision mismatch")
        day_boundaries[day]=district_shapes(overview)
        existing[day]={p["callId"]:p for p in overview.get("callLocations",[])}
    outputs={day:[] for day in dates}
    audits={day:collections.Counter() for day in dates}
    for entry in manifest["days"]:
        if not entry.get("sampleCount"):continue
        date=entry["date"]
        detail=json.loads((PUBLIC/entry["dataPath"]).read_text("utf8"))
        if detail["date"]!=date or detail["customerId"]!=entry["customerId"]:
            raise RuntimeError("partition identity mismatch")
        station_map=build_site_catalog(detail.get("baseStations",[]))
        seen_gnss=set()
        by_call=collections.defaultdict(list)
        for row in detail["samples"]:
            md=row[21] or {}
            call_id=str(row[19])
            if md.get("locationSource")=="gnss" and number(row[2]) and number(row[3]):
                seen_gnss.add(call_id)
            if md.get("baseStationMatched") is not True or md.get("masterInventorySource")!=INVENTORY:
                continue
            ru=str(md.get("baseStationId") or "")
            cell=str(md.get("cellId") or "")
            coords=station_map.get((ru,cell))
            val=row[10]
            t=epoch(md.get("timestamp"))
            if coords is None or not number(val) or t is None or not -150<=val<=-30:
                continue
            by_call[call_id].append({
                "time":t,"coord":coords,"rsrp":float(val),"ru":ru,"cell":cell,
                "timestamp":md["timestamp"],
            })
        for call in detail.get("calls",[]):
            audits[date]["cdrCallsInMdtPartitions"]+=1
            if call.get("matchStatus")!="MATCHED":
                audits[date]["ambiguousOrUnmatchedCalls"]+=1
                continue
            call_id=call["id"]
            if call_id in seen_gnss:
                audits[date]["callsWithGnssPreserved"]+=1
                continue
            records=sorted(by_call.get(call_id,[]),key=lambda x:x["time"])
            if not records:continue
            audits[date]["withoutGnssWithRsrp"]+=1
            end_time=epoch(call.get("endTimestamp"))
            if end_time is None:continue
            best=None
            # Use an actual MDT observation timestamp closest to the CDR END
            # that has three independent site coordinates in the prior 30s.
            for row in reversed(records):
                lag=end_time-row["time"]
                if lag < -1:continue
                if lag>MAX_END_AGE_SECONDS:break
                candidate=centroid_candidate(records,row["time"])
                if candidate is None:continue
                area=locate_district(candidate,day_boundaries[date])
                if not area:
                    audits[date]["candidateOutsideAdministrativeBoundary"]+=1
                    continue
                best={**candidate,
                    "callId":entry["customerId"]+":"+call_id,
                    "areaId":area,
                    "evidence":"estimated",
                    "start":call["start"],"mos":call.get("mos"),
                    "representativeBasis":"cdr-end-nearest",
                    "observedAt":row["timestamp"],
                    "cdrEndAt":call["endTimestamp"],
                    "secondsBeforeEnd":round(lag,3),
                    "positionQuality":"three-site-rough",
                    "estimationMethod":"THREE_SITE_RSRP_CENTROID",
                    "estimationWindowSec":WINDOW_SECONDS,
                    "modelUncertaintyM":None,
                    "modelConfidenceScore":None,
                    "referenceBasis":"coarse-site-barycenter",
                }
                original=existing[date].get(best["callId"])
                if original and original["evidence"]=="gnss":
                    raise RuntimeError("GNSS reference would be overridden")
                if original and original["evidence"]=="bye-cell":
                    best.update({
                      "byeCellId":original.get("byeCellId"),
                      "byeRuId":original.get("byeRuId"),
                      "byeInventory":original.get("byeInventory"),
                      "byeStationLat":original["lat"],
                      "byeStationLon":original["lon"],
                    })
                break
            if not best:continue
            outputs[date].append(best)
            audits[date]["coarse3SiteCallCandidates"]+=1
            if best["mos"] is not None and best["mos"]<3:
                audits[date]["poorMosCoarse3SiteCallCandidates"]+=1
    for day in dates:
        result={
          "schemaVersion":"coarse-three-site-v1",
          "sourceRevision":revision,
          "date":day,
          "method":"THREE_SITE_RSRP_CENTROID",
          "warning":"Weighted center of >=3 independent LTE site locations within preceding 30s. Approximate search area, NOT validated UE location or trilateration or MOS impairment onset.",
          "notA90PercentAccuracyRegion":True,
          "counts":dict(audits[day]),
          "points":outputs[day],
        }
        target=outdir/(day+".json")
        tmp=target.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(result,ensure_ascii=False,separators=(",",":")),encoding="utf8")
        os.replace(tmp,target)
    print(json.dumps({
      "sourceRevision":revision,
      "counts":{day:dict(audits[day]) for day in dates},
      "totalCandidates":sum(len(points) for points in outputs.values()),
      "poorCandidates":sum(c["poorMosCoarse3SiteCallCandidates"] for c in audits.values()),
      "outputDir":str(outdir),
    },ensure_ascii=False,indent=2))

if __name__=="__main__":build()
