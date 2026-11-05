"""Build data-only, provenance-safe position evidence for GNSS-missing MDT rows.

Does NOT change source Excel, the existing public dataset, or any UI.
Does NOT fill GNSS lat/lon or assert a new UE position.
All row keys refer to existing derived CDR-linked partitions and sample offsets.

Usage:
  python scripts/enrich_missing_gnss_evidence.py
Result:
  outputs/gnss-gap-supplement/<sourceRevision>/summary.json
  outputs/gnss-gap-supplement/<sourceRevision>/YYYY-MM-DD.jsonl
"""
from __future__ import annotations

import collections
from datetime import datetime
import json
import math
import os
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parent.parent
PUBLIC=ROOT/"public"
sys.path.insert(0,str(ROOT/"scripts"))
from lte_station_catalog import load_unique_bye_cells

INVENTORY_FILE="수도권_LTE_261103.xlsx"
UNKNOWN_UE_LOCATION="NO_VALIDATED_UE_POSITION"
GNSS_MAX_AGE_SECONDS=180
ASSUMED_MAX_SPEED_KMH=120
ASSUMED_GNSS_OFFSET_M=250

def is_finite_number(value):
    return isinstance(value,(int,float)) and not isinstance(value,bool) and math.isfinite(value)

def valid_position(lat,lon):
    return is_finite_number(lat) and is_finite_number(lon) and 33<=lat<=39.8 and 124<=lon<=132

def aware_epoch(value):
    if not isinstance(value,str) or not value.strip():
        return None
    try:
        parsed=datetime.fromisoformat(value.strip().replace("Z","+00:00"))
    except ValueError:
        return None
    return parsed.timestamp() if parsed.utcoffset() is not None else None

def missing_reason(raw_row):
    m=raw_row[21] or {}
    x,y=m.get("gnssUtmkx"),m.get("gnssUtmky")
    if x==0 and y==0:
        return "ZERO_ZERO_SENTINEL"
    if x is None and y is None:
        return "BOTH_GNSS_FIELDS_MISSING"
    if x is None or y is None:
        return "PARTIAL_GNSS_COORDINATE"
    if not (is_finite_number(x) and is_finite_number(y)) or x<=0 or y<=0:
        return "INVALID_GNSS_COORDINATE"
    return "UNRESOLVED_CRS_OR_CONVERSION"

def strict_stations(stations):
    """Only unique RU+Cell coordinates from current LTE inventory; no cell-only match."""
    by_pair=collections.defaultdict(set)
    for site in stations:
        if site.get("inventorySource")!=INVENTORY_FILE:
            continue
        ru=str(site.get("baseStationId") or "").strip()
        cell=str(site.get("cellId") or "").strip()
        lat,lon=site.get("latitude"),site.get("longitude")
        if ru and cell and valid_position(lat,lon):
            by_pair[(ru,cell)].add((round(lat,9),round(lon,9)))
    return {key:next(iter(values)) for key,values in by_pair.items() if len(values)==1}

def prior_gnss_observation(gnss_rows,target_timestamp):
    """Only an earlier real observation in the SAME call, never next/future/fabricated."""
    if target_timestamp is None:
        return None
    eligible=[row for row in gnss_rows if row["epoch"]<=target_timestamp and
              0<=target_timestamp-row["epoch"]<=GNSS_MAX_AGE_SECONDS]
    if not eligible:return None
    latest=max(eligible,key=lambda row:row["epoch"])
    age=round(target_timestamp-latest["epoch"],3)
    return {
       "referenceType":"PRIOR_MEASURED_GNSS_NOT_TARGET_TIME_UE",
       "latitude":latest["latitude"],"longitude":latest["longitude"],
       "observedAt":latest["timestamp"],"ageSeconds":age,
       "scenarioRadiusM":round(ASSUMED_GNSS_OFFSET_M+
                               age*ASSUMED_MAX_SPEED_KMH/3.6,1),
       "scenarioIsCalibratedConfidenceRegion":False,
       "source":"same-call GNSS observation in derived MDT",
    }

def build_gnss_index(samples):
    by_call=collections.defaultdict(list)
    for row in samples:
        md=row[21] or {}
        if md.get("locationSource")!="gnss" or not valid_position(row[2],row[3]):
            continue
        if str(md.get("gnssCrs") or "").upper()!="EPSG:5179":
            continue
        epoch=aware_epoch(md.get("timestamp"))
        if epoch is None:continue
        by_call[str(row[19])].append({
          "epoch":epoch,"timestamp":md["timestamp"],
          "latitude":row[2],"longitude":row[3],
        })
    return by_call

def sample_evidence(row,sample_index,call,stations,gnss_index,bye_sites,date,partition):
    assert not (valid_position(row[2],row[3]) and
                (row[21] or {}).get("locationSource")=="gnss"),"do not enrich real GNSS fixes"
    md=row[21] or {}
    ru=str(md.get("baseStationId") or "").strip()
    cell=str(md.get("cellId") or "").strip()
    timestamp=md.get("timestamp")
    epoch=aware_epoch(timestamp)
    observation=prior_gnss_observation(gnss_index.get(str(row[19]),[]),epoch)
    exact_site=stations.get((ru,cell))
    site=None
    if exact_site:
        site={
            "referenceType":"MDT_CELL_SITE_NOT_HANDSET",
            "ruId":ru,"cellId":cell,
            "latitude":exact_site[0],"longitude":exact_site[1],
            "catalog":INVENTORY_FILE,
            "matchedBy":"EXACT_UNIQUE_RU_AND_CELL_ID",
            "observationTimestamp":timestamp,
        }
    end_cell=str(call.get("endCellId") or "").strip() if call else ""
    bye=bye_sites.get(end_cell)
    bye_ref=None
    if bye:
        bye_ref={
          "referenceType":"CDR_END_CELL_SITE_NOT_HANDSET",
          "cellId":end_cell,"ruId":bye["ruId"],
          "latitude":bye["lat"],"longitude":bye["lon"],
          "catalog":INVENTORY_FILE,"matchedBy":"CELL_ID_WITH_UNIQUE_RU",
          "referenceTimestamp":call.get("endTimestamp"),
          "notCurrentMdtObservation":True,
        }
    return {
      "date":date,"sourceDetailPath":partition,
      "callId":str(row[19]),"sampleIndex":sample_index,
      "observationTimestamp":timestamp,
      "missingGnssReason":missing_reason(row),
      "uePosition":None,
      "uePositionDetermination":UNKNOWN_UE_LOCATION,
      "priorGnssReference":observation,
      "mdtCellSiteReference":site,
      "cdrEndCellSiteReference":bye_ref,
      "calibratedPositionUncertaintyM":None,
      "isQualityImpairmentLocation":False,
      "rsrpDbm":row[10] if is_finite_number(row[10]) else None,
      "rsrqDb":row[11] if is_finite_number(row[11]) else None,
      "sinrDb":row[12] if is_finite_number(row[12]) else None,
    }

def collect_bye_sites(manifest):
    requested=set()
    for entry in manifest["days"]:
        if not entry.get("sampleCount"):continue
        detail=json.loads((PUBLIC/entry["dataPath"]).read_text("utf8"))
        for call in detail.get("calls",[]):
            if call.get("endCellId"):requested.add(str(call["endCellId"]).strip())
    return load_unique_bye_cells(ROOT/"data/BaseStation"/INVENTORY_FILE,requested)

def run():
    manifest=json.loads((PUBLIC/"voice-1030.json").read_text("utf8"))
    revision=manifest["meta"]["revision"]
    output=ROOT/"outputs"/"gnss-gap-supplement"/revision
    output.mkdir(parents=True,exist_ok=True)
    sites,bye_catalog_audit=collect_bye_sites(manifest)
    totals=collections.Counter()
    per_day=collections.defaultdict(collections.Counter)
    reasons=collections.Counter()
    base_categories=collections.Counter()
    missing_event_types=collections.Counter()
    tmp_paths={}
    outs={}
    try:
        for day in manifest["meta"]["dates"]:
            path=output/(day+".jsonl")
            tmp=path.with_suffix(".jsonl.tmp")
            tmp_paths[day]=tmp
            outs[day]=tmp.open("w",encoding="utf8",newline="\n")
        for entry in manifest["days"]:
            if not entry.get("sampleCount"):continue
            date=entry["date"]
            detail=json.loads((PUBLIC/entry["dataPath"]).read_text("utf8"))
            if detail["date"]!=date or detail["customerId"]!=entry["customerId"]:
                raise ValueError("partition identity mismatch")
            station_index=strict_stations(detail.get("baseStations") or [])
            calls={str(c["id"]):c for c in detail.get("calls",[])}
            gnss_index=build_gnss_index(detail["samples"])
            totals["partitionsWithSamples"]+=1
            for index,row in enumerate(detail["samples"]):
                totals["sourceSampleRows"]+=1
                if (valid_position(row[2],row[3]) and
                    (row[21] or {}).get("locationSource")=="gnss"):
                    totals["originalGnssRowsKept"]+=1
                    continue
                evidence=sample_evidence(row,index,calls.get(str(row[19])),
                                         station_index,gnss_index,sites,
                                         date,entry["dataPath"])
                outs[date].write(json.dumps(evidence,ensure_ascii=False,
                                            allow_nan=False,separators=(",",":"))+"\n")
                totals["missingGnssRows"]+=1
                per_day[date]["missingGnssRows"]+=1
                reason=evidence["missingGnssReason"]
                reasons[reason]+=1
                if evidence["priorGnssReference"]:
                    totals["hasPriorGnssReferenceWithin180s"]+=1
                    per_day[date]["priorGnssReference"]+=1
                if evidence["mdtCellSiteReference"]:
                    totals["hasExactUniqueMdtCellSite"]+=1
                    per_day[date]["mdtCellSiteReference"]+=1
                if evidence["cdrEndCellSiteReference"]:
                    totals["hasUniqueCdrEndCellSite"]+=1
                    per_day[date]["cdrEndSiteReference"]+=1
                if not any(evidence[k] for k in
                           ("priorGnssReference","mdtCellSiteReference","cdrEndCellSiteReference")):
                    totals["noLocationReferences"]+=1
                    per_day[date]["noLocationReferences"]+=1
                if evidence["priorGnssReference"] and evidence["mdtCellSiteReference"]:
                    totals["priorGnssAndMdtCellSite"]+=1
                if evidence["rsrpDbm"] is not None:totals["hasRsrp"]+=1
                if evidence["sinrDb"] is not None:totals["hasSinr"]+=1
                missing_event_types[str((row[21] or {}).get("phase") or "unknown")]+=1
        for o in outs.values():o.close()
        if totals["sourceSampleRows"] != totals["originalGnssRowsKept"]+totals["missingGnssRows"]:
            raise AssertionError("not all rows accounted for")
        if totals["missingGnssRows"]!=sum(per_day[d]["missingGnssRows"] for d in per_day):
            raise AssertionError("day totals mismatch")
        for day in manifest["meta"]["dates"]:
            os.replace(tmp_paths[day],output/(day+".jsonl"))
    finally:
        for o in outs.values():
            if not o.closed:o.close()
        for tmp in tmp_paths.values():
            if tmp.exists():tmp.unlink()
    summary={
        "schemaVersion":"gnss-missing-evidence-v1",
        "sourceRevision":revision,
        "sourceManifest":"public/voice-1030.json",
        "sourceType":"derived CDR-linked MDT sample rows, not independent GNSS truth",
        "missingRowsAreNOTAssignedNewHandsetCoordinates":True,
        "fieldsAdded":"prior observed GNSS reference, strict RU+Cell tower, unique CDR end tower",
        "gnssMaxAgeSeconds":GNSS_MAX_AGE_SECONDS,
        "assumedSpeedKmh":ASSUMED_MAX_SPEED_KMH,
        "assumedAnchorOffsetM":ASSUMED_GNSS_OFFSET_M,
        "assumedParametersAreNotCalibratedAccuracy":True,
        "sourceGnssFieldsAndMOSUnmodified":True,
        "totals":dict(totals),
        "missingGnssReasons":dict(reasons),
        "missingEventTypeTop20":dict(missing_event_types.most_common(20)),
        "byDate":{day:dict(per_day[day]) for day in manifest["meta"]["dates"]},
        "cdrEndCellCatalogAudit":bye_catalog_audit,
        "joinedRecordKey":["sourceDetailPath","callId","sampleIndex"],
        "producedFiles":[day+".jsonl" for day in manifest["meta"]["dates"]],
        "limitations":[
          "Source GNSS horizontal accuracy and independent survey ground truth are unavailable",
          "A site latitude/longitude is NOT UE latitude/longitude",
          "Historical GNSS fix is at its own timestamp, not at missing observation timestamp",
          "No validated RSRP pathloss or multi-site location accuracy; UE position intentionally null",
          "CDR END timestamp is not verified RTP/RTCP degradation onset",
          "Missing MDT/Cdr join cannot be inferred from unrelated subscriber/other-call data"
        ],
    }
    result=output/"summary.json"
    temporary=output/"summary.json.tmp"
    temporary.write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding="utf8")
    os.replace(temporary,result)
    print(json.dumps({"folder":str(output),"summary":summary},ensure_ascii=False,indent=2))
    return summary

if __name__=="__main__":
    run()
