"""Reproducible, leakage-controlled spatiotemporal research on QoE_Metrics.

Reads existing source-revision-locked CDR-linked MDT partitions, independently
checks original workbook/audit provenance and original RTCP report granularity.
Writes only aggregate metrics and a small source-traceable evidence sample.
NO UI/data publication modified. No ground-truth accuracy invented.

Usage: python scripts/run_qoe_spatiotemporal_study.py
"""
from __future__ import annotations
import collections
import hashlib
import json
import math
import os
import statistics
import sys
from datetime import datetime,timezone
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parent))
from qoe_spatiotemporal_core import GnssFix, RtcpInterval, detect_impairment_intervals, infer_position, haversine_m
from gnss_holdout_diagnostic import point_from_row, collapse_duplicates
from build_three_site_rough import build_site_catalog,centroid_candidate,epoch,INVENTORY

ROOT=Path(__file__).resolve().parent.parent
PUBLIC=ROOT/"public"
OUT=ROOT/"outputs"/"spatiotemporal-research-v1"
REVISION="557c39d2c6a9a5b4c69b"

def numerical(x):
    return isinstance(x,(int,float)) and not isinstance(x,bool) and math.isfinite(x)
def pct(arr,p):
    if not arr:return None
    xs=sorted(arr);v=(len(xs)-1)*p;i=int(math.floor(v));j=int(math.ceil(v))
    return round(xs[i]+(xs[j]-xs[i])*(v-i),2)
def metrics(rows,name):
    arr=[x[name] for x in rows if x.get(name) is not None and math.isfinite(x[name])]
    return {"n":len(arr),"p50_m":pct(arr,.5),"p90_m":pct(arr,.9),"p95_m":pct(arr,.95),
            "mean_m":round(statistics.mean(arr),2) if arr else None,
            "within_50m_pct":round(100*sum(x<=50 for x in arr)/len(arr),2) if arr else None,
            "within_100m_pct":round(100*sum(x<=100 for x in arr)/len(arr),2) if arr else None}
def json_write(path,obj):
    path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_suffix(path.suffix+".tmp")
    tmp.write_text(json.dumps(obj,ensure_ascii=False,indent=2,allow_nan=False),encoding="utf8")
    os.replace(tmp,path)
def source_audit():
    audit=json.loads((ROOT/"outputs"/"radio-original-source-audit.json").read_text("utf8"))
    rows=json.loads((ROOT/"outputs"/"mdt-event-mos-audit.json").read_text("utf8"))
    original=ROOT/"data"/"MDT_New"
    source_hashes={}
    for source in audit["sources"].values():
        p=original/source["file"]
        if not p.is_file() or p.stat().st_size!=source["size_bytes"]:
            raise RuntimeError("Source workbook removed or size changed; refuse stale audit")
        hasher=hashlib.sha256()
        with p.open("rb") as handle:
            while block:=handle.read(4*1024*1024):
                hasher.update(block)
        source_hashes[source["file"]]=hasher.hexdigest()
    if rows["source_file"]!=audit["sources"]["mdt"]["file"] or rows["input_events"]!=audit["mdt"]["rows"]:
        raise RuntimeError("Event MOS audit no longer matches source workbook")
    assert rows["within_call_mos_range"]["n"]==0
    assert audit["mdt"]["rows"]==541811
    counts=rows["numeric_audit"]
    return {
       "sourceWorkbooks":[{"name":o["file"],"sizeBytes":o["size_bytes"],"sheet":o["sheet"],
                           "rowsIncludingHeader":o["rows_including_header"],
                           "sha256":source_hashes[o["file"]]}
                           for o in audit["sources"].values()],
       "mdtEventRows":rows["input_events"],
       "mdtRtcpMosRows":counts.get("rtcp_mos_in_1_to_5"),
       "groupsWithVaryingRtcpMos":rows["stats"].get("groups_with_multiple_mos_values",0),
       "rtcpIntervalReportsAvailable":False,
       "octoberRtcpPacketCaptureAvailable":False,
       "rtcpMOSOnsetDetection":"NOT_IDENTIFIABLE_FROM_AVAILABLE_ORIGINALS",
       "rtcpDegradationPrecisionRecall":None,
       "clockAnchorCalibration":"NOT_IDENTIFIABLE_NO_INDEPENDENT_MATCHED_SAME_EVENT_CLOCKS",
       "clockOffsetSeconds":None,
       "clockAlignmentErrorP90Seconds":None,
       "rawJuly14RtcpWorkbookIsDifferentDate":True,
       "uncertaintyPropagationFromClock":"UNIDENTIFIABLE_WITHOUT_CLOCK_ANCHORS",
       "note":"MDT rtcp_mos is repeated call-level summary, NOT interval RTCP MOS; no onset time or error stats."
    }

def known_fixes(rows):
    return [GnssFix(p["t"],p["pos"][0],p["pos"][1],None,True) for p in rows]

def make_predictions(points,target_index,kind,radios,callid,detail,day):
    truth=points[target_index]
    if target_index>0:
        prev=points[target_index-1]
    else:return None
    gap=truth["t"]-prev["t"]
    if not (5<=gap<=180):return None
    if kind=="middle" and (target_index==len(points)-1 or points[target_index+1]["t"]-truth["t"]<5):
        return None
    # Target (and all duplicated rows at that timestamp) removed from model inputs.
    fixes=known_fixes([p for i,p in enumerate(points) if i!=target_index and p["t"]!=truth["t"]])
    preds={}
    for method in ("last_gnss","constant_velocity","time_interpolation"):
        pred=infer_position(fixes,truth["t"],method)
        if pred.lat is not None:
            preds["error_"+method]=haversine_m((pred.lat,pred.lon),truth["pos"])
            preds["basis_"+method]=pred.basis_times_s
            if any(t>=truth["t"] for t in pred.basis_times_s) and method!="time_interpolation":
                raise RuntimeError("Future information leaked into causal algorithm")
    rows=[r for r in radios.get(callid,[]) if r["time"]<truth["t"]]
    approx=centroid_candidate(rows,truth["t"])
    if approx:
        preds["error_radio_site_centroid"]=haversine_m((approx["lat"],approx["lon"]),truth["pos"])
        preds["radio_independent_sites"]=approx["usedSiteCount"]
    movement=haversine_m(prev["pos"],truth["pos"])
    bracket_m=(haversine_m(prev["pos"],points[target_index+1]["pos"])
               if kind=="middle" and target_index+1<len(points) else None)
    return {"date":day,"customer":detail["customerId"],"call":callid,"cell":truth["cell"],
            "referenceCategory":kind,"ageSeconds":round(gap,3),"movementMeters":round(movement,4),
            "sameGnssCoordinate":movement<0.5,
            "bracketMotionMeters":round(bracket_m,4) if bracket_m is not None else None,
            "targetIsSurveyGroundTruth":False,"targetTimeEpoch":truth["t"],
            "sourcePartition":detail.get("_auditPartition"),
            "targetRadioCell":truth["cell"],
            **preds}

def evaluate():
    OUT.mkdir(parents=True,exist_ok=True)
    manifest=json.loads((PUBLIC/"voice-1030.json").read_text("utf8"))
    assert (manifest["meta"]["revision"]==REVISION and
           manifest["meta"]["gnssCrs"]=="EPSG:5179")
    audit=source_audit()
    audit["syntheticRtcpExample"]=detect_impairment_intervals([
       RtcpInterval(i,i+1,4.0 if i<4 else 2.4) for i in range(8)])
    calls=collections.Counter()
    cases=[]
    for entry in manifest["days"]:
        if not entry.get("gnssSampleCount"):continue
        path=PUBLIC/entry["dataPath"]
        detail=json.loads(path.read_text("utf8"))
        if detail["date"]!=entry["date"] or detail["customerId"]!=entry["customerId"]:
            raise ValueError("Source identity mismatch")
        detail["_auditPartition"]=entry["dataPath"]
        calls_by_id={c["id"]:c for c in detail["calls"]}
        fixes=collections.defaultdict(list)
        radios=collections.defaultdict(list)
        sites=build_site_catalog(detail.get("baseStations",[]))
        for row in detail["samples"]:
            callid=str(row[19])
            p=point_from_row(row)
            if p is not None:
                fixes[callid].append(p)
            md=row[21] or {}
            if (md.get("baseStationMatched") is True and
                md.get("masterInventorySource")==INVENTORY):
                pair=(str(md.get("baseStationId") or ""),str(md.get("cellId") or ""))
                xy=sites.get(pair)
                timestamp=epoch(md.get("timestamp"))
                if xy and numerical(row[10]) and -150<=row[10]<=-30 and timestamp is not None:
                    radios[callid].append({"time":timestamp,"coord":xy,
                      "rsrp":float(row[10]),"ru":pair[0],"cell":pair[1]})
        for callid,raw in fixes.items():
            calls["gnss_calls"]+=1
            calls["gnss_rows"]+=len(raw)
            call=calls_by_id.get(callid)
            if not call or call.get("matchStatus")!="MATCHED":
                calls["ambiguous_or_not_matched_call"]+=1
                continue
            points=collapse_duplicates(raw)
            if len(points)<2:
                calls["fewer_than_two_distinct_fix_samples"]+=1
                continue
            result=make_predictions(points,len(points)-1,"last",radios,callid,detail,entry["date"])
            if result:
                cases.append(result)
                calls["last_gnss_test_cases"]+=1
            else:calls["last_gnss_gap_not_5_to_180s"]+=1
            # One retrospective interior GNSS target whose earlier+later
            # fixes both exist. Target and future fixes never reach online
            # last/velocity predictors; future is only used for interpolation.
            interior=[i for i in range(1,len(points)-1) if
              5<=points[i]["t"]-points[i-1]["t"]<=180 and
              5<=points[i+1]["t"]-points[i]["t"]<=180 and
              points[i+1]["t"]-points[i-1]["t"]<=180]
            if interior:
                i=interior[len(interior)//2]
                case=make_predictions(points,i,"middle",radios,callid,detail,entry["date"])
                if case:
                    cases.append(case)
                    calls["interior_gnss_test_cases"]+=1
            if calls["gnss_calls"]%150==0:
                print("GNSS_CALLS_EVALUATED",calls["gnss_calls"],flush=True)
    print("SOURCE_PARTITIONS_SCANNED_DONE",dict(calls),flush=True)
    # Train only first three days. 29-30 test: explicitly exclude customers
    # AND observed serving cells from training. Do not optimize on test.
    development=[r for r in cases if r["date"]<="2026-10-28"]
    late=[r for r in cases if r["date"]>="2026-10-29"]
    dev_customers={r["customer"] for r in development}
    dev_cells={r["cell"] for r in development}
    strict=[r for r in late if r["customer"] not in dev_customers and
            r["cell"] not in dev_cells and r["cell"]]
    methods=["last_gnss","constant_velocity","time_interpolation","radio_site_centroid"]
    def method_results(rows):
        out={}
        for group in ("last","middle"):
            subset=[r for r in rows if r["referenceCategory"]==group]
            grouped={"all":subset,"moving_ge_5m":[r for r in subset if r["movementMeters"]>=5],
                     "stationary_lt_0_5m":[r for r in subset if r["sameGnssCoordinate"]]}
            out[group]={name:{method:metrics(v,"error_"+method) for method in methods} | {
               "caseCount":len(v),"distinctCustomers":len({r["customer"] for r in v}),
               "stationaryFractionPct":round(100*sum(r["sameGnssCoordinate"] for r in v)/len(v),2) if v else None}
               for name,v in grouped.items()}
        return out
    results={
        "allDiagnosticCases":method_results(cases),
        "development":method_results(development),
        "laterNotIndependent":method_results(late),
        "strictTestDisjointCustomerAndCell":method_results(strict),
    }
    calibrated={}
    for category in ("last","middle"):
        calibrated[category]={}
        for method in methods:
            field="error_"+method
            train_errors=[r[field] for r in development if r["referenceCategory"]==category and field in r]
            test_errors=[r[field] for r in strict if r["referenceCategory"]==category and field in r]
            quantile=pct(train_errors,.9) if len(train_errors)>=20 else None
            coverage=(round(100*sum(e<=quantile+1e-9 for e in test_errors)/len(test_errors),2)
                      if quantile is not None and len(test_errors)>=10 else None)
            calibrated[category][method]={
                "developmentN":len(train_errors),"strictTestN":len(test_errors),
                "developmentEmpiricalP90ErrorM":quantile,
                "strictTestCoverageOfDevelopmentP90Pct":coverage,
                "regionAppliesOnlyToWithheldGNSSReference":True,
                "certifiedHandsetAccuracy90Pct":False,
                "notIdentifiableReason":"No independent surveyed true location, GNSS metadata accuracy missing"
            }
    # Traceability: opaque existing hashed source IDs only; no IMSI/MSISDN
    # or unmasked customer keys from original workbooks.
    trace=[]
    for row in strict[:40]:
        trace.append({"date":row["date"],"partitionPath":row["sourcePartition"],
         "opaqueCallId":row["call"],"kind":row["referenceCategory"],
         "time":datetime.fromtimestamp(row["targetTimeEpoch"],tz=timezone.utc).isoformat(),
         "ageSeconds":row["ageSeconds"],"targetMovedM":row["movementMeters"],
         **{k:round(row[k],2) if row.get(k) is not None else None for k in [
             "error_last_gnss","error_constant_velocity","error_time_interpolation",
             "error_radio_site_centroid"]}})
    for r in cases:
        if r.get("error_last_gnss") is None:
            calls["no_causal_gnss"]+=1
    summary={
        "schemaVersion":"spatiotemporal-study-v1",
        "sourceRevision":REVISION,
        "sourceAudit":audit,
        "methodology":{
         "realTarget":"Withheld most recent or middle GNSS observation from SAME source and same call; NOT surveyed independent ground truth",
         "testSplit":"Train Oct26-28; later Oct29-30; strict test excludes any development customer AND cell",
         "noLeakage":"Target fix/time and its coordinates never available to prediction; causal methods only earlier GNSS and radio",
         "interpolation":"Retrospective bracketing with real future GNSS; unsuitable for real-time onset prediction",
         "gnssValidity":"Explicit published EPSG:5179, matched call only, dedup within 1s/3m, no invalid 0,0",
         "motionGate":"5..180s GNSS gap, speed <=33.3333 m/s; no sensor accuracy metadata",
         "radioGate":">=3 independent LTE RU/site coordinates within previous 30s; signal-strength weighted site centroid, NOT a handset position",
         "allZeroGNSSConcern":"Repeated stationary positions make pseudo-test errors zero; moving subset is reported separately",
         "clock":"No independently shared event clock anchors; UTC/KST formatting from pipeline is not clock synchronization verification",
         "rtcp":"Call-aggregate RTCP MOS cannot locate onset. July RTCP is separate field trial, cannot join October calls.",
         "statisticalRadius":"Train-quantile empirical coverage applies to withheld GNSS pseudo-truth only. Real location 90%/95% confidence unverified",
         "inferenceNoRtcpOnset":"NONE. Do not infer MOS impairment time from HO/RSRP alone."
        },
        "counts":dict(calls),
        "developmentCases":len(development),
        "laterCases":len(late),
        "strictHeldOutCustomerAndCellCases":len(strict),
        "methods":results,
        "empiricalHeldoutGnssQuantileStudy":calibrated,
        "groundTruth":{"surveyedLocationAvailable":False,"rtcpEpisodeLabelsAvailable":False,
            "trueLocationMedianP90P95":None,"temporalDetectionPrecision":None,
            "temporalDetectionRecall":None,"clockAlignmentError":None,
            "trueLocation90pctCoverage":None,
            "unverifiableImpairmentOnsetPct":100,
            "locationUnverifiablePct":100,
            "note":"Percentages scoped to EXACT impairment-onset localization in five-day CDR corpus, not all GNSS observations"},
        "missingDataForIndependentCertification":[
          "Time-resolved RTCP report interval (begin/end, loss, jitter, MOS or RTP per-second packet sequence)",
          "Independent SIP/MDT/RTCP/GNSS same-event timestamp anchors with clock provenance",
          "Surveyed UE GNSS/RTK ground-truth coordinates and device accuracy metadata",
          "Verified per-sample source CRS, velocity/IMU measurements, independent radio calibration",
          "Complete PM/HO logs temporally joined by sector and time, and independent negative controls"],
        "evidenceExamplesFile":"strict-heldout-evidence.json",
        "failureCategories":{
          "fiveDayImpairmentMoment":"ALL_NOT_IDENTIFIABLE_NO_INTERVAL_RTCP",
          "cellOnlyLocation":"TOWER_REFERENCE_NOT_HANDSET",
          "noFutureGNSS":"RETROSPECTIVE_INTERPOLATION_UNAVAILABLE",
          "missingGNSS":"NO_CONFIDENT_LOCATION",
          "clockOffset":"NOT_IDENTIFIABLE",
          "radioCause":"HYPOTHESIS_ONLY"
        }
    }
    json_write(OUT/"report.json",summary)
    json_write(OUT/"strict-heldout-evidence.json",trace)
    # Retain opaque identifiers for reproducible client/cell-disjoint re-checks,
    # never raw contract/phone/IMSI or actual withheld GNSS coordinates.
    json_write(OUT/"evaluation-cases.json",[
      {"date":r["date"],"opaqueCustomer":r["customer"],"opaqueCall":r["call"],
       "cell":r["cell"],"kind":r["referenceCategory"],
       "ageSeconds":r["ageSeconds"],"movementMeters":r["movementMeters"],
       "bracketMotionMeters":r.get("bracketMotionMeters"),
       **{k:round(r[k],4) if k in r else None for k in (
         "error_last_gnss","error_constant_velocity","error_time_interpolation",
         "error_radio_site_centroid")}}
      for r in cases])
    print(json.dumps({
       "sourceCdrRows":audit["sourceWorkbooks"][0]["rowsIncludingHeader"],
       "sourceMdtRows":audit["mdtEventRows"],
       "counts":dict(calls),
       "strictTestN":len(strict),
       "testResults":results["strictTestDisjointCustomerAndCell"],
       "empiricalCoverage":calibrated,
       "onset":"NOT_IDENTIFIABLE_NO_INTERVAL_RTCP",
       "output":str(OUT/"report.json")
    },ensure_ascii=False,indent=2))
if __name__=="__main__":evaluate()
