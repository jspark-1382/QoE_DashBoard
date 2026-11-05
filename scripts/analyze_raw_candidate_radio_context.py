"""Original October MDT radio context; exact customer/day/END unique join.

CDR and MDT call start may be different physical events by several seconds.
We do NOT call it a clock offset. Match only if (1) same hashed customer/day,
(2) identical recorded end time, (3) start of MDT within 30s after CDR
start, (4) ONE distinct raw MDT lte_vc_div source call. Ambiguous=excluded.
Never join on cell/GNSS similarity. Raw names/phone/contract never exported.
"""
from __future__ import annotations
from collections import Counter,defaultdict
from pathlib import Path
from statistics import median
import json,math,os,sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
from mdt_pipeline import read_rows,anonymous_id,parse_timestamp,numeric,clean
ROOT=Path(__file__).resolve().parent.parent
DEST=ROOT/"outputs/spatiotemporal-research-v1/candidate_radio_context.json"
data=json.loads((ROOT/"public/improvement-candidates/2026-10-26_2026-10-30.json").read_text("utf8"))
targets=[]
overview_cache={}
for cand in data["candidates"]:
 for ref in cand["representativeCalls"]:
  if ref["date"] not in overview_cache:
   src=json.loads((ROOT/"public/analyst-overview/MDT"/(ref["date"]+".json")).read_text("utf8"))
   if src["sourceRevision"]!=data["sourceRevision"]:raise ValueError("CDR source revision changed")
   overview_cache[ref["date"]]={x["id"]:x for x in src["calls"]}
  call=overview_cache[ref["date"]].get(ref["callId"])
  if not call or call["customerId"]!=ref["customerId"]:raise ValueError("Original CDR ref not found")
  targets.append({"candidate":cand["id"],"date":ref["date"],
   "customer":ref["customerId"],"callId":ref["callId"],
   "mos":ref["mos"],"cdrStart":call.get("start"),"cdrEnd":call.get("end")})
ends=defaultdict(list)
for target in targets:
    if not target["cdrStart"] or not target["cdrEnd"]:continue
    key=(target["date"],target["customer"],target["cdrEnd"].replace(":",""))
    ends[key].append(target)
custs={t["customer"] for t in targets}
rawgroups=defaultdict(lambda:defaultdict(list))
audit=Counter()
src=next((ROOT/"data/MDT_New").glob("*VoLTE+MDT*.xlsx"))
for i,row in enumerate(read_rows(src),1):
 audit["rawMdtRows"]+=1
 contract=clean(row.get("svc_cont_id"))
 if not contract:continue
 customer=anonymous_id("mdt",contract)
 if customer not in custs:continue
 audit["candidateCustomerRawRows"]+=1
 date=clean(row.get("base_date"))
 if len(date)!=8 or not date.isdigit():continue
 iso=date[:4]+"-"+date[4:6]+"-"+date[6:]
 key=(iso,customer,clean(row.get("svc_ctgry_fns_hhmiss")))
 if key not in ends:continue
 sourcekey=(clean(row.get("lte_vc_div")),clean(row.get("svc_ctgry_st_hhmiss")))
 if not sourcekey[0] or not sourcekey[1]:continue
 audit["possibleEndMatchedRawRows"]+=1
 t=parse_timestamp(row.get("occ_dt"))
 rawgroups[key][sourcekey].append({
   "timestamp":t.isoformat() if t else None,
   "radioPhase":clean(row.get("mdt_div")),
   "rsrp":numeric(row.get("rsrp")),"rsrq":numeric(row.get("rsrq")),
   "sinr":numeric(row.get("nsinr")),
   "trigger":clean(row.get("trigr_ev")),
   "mdtCellId":clean(row.get("mdt_cell_id")),
   "rtcp_mos":numeric(row.get("rtcp_mos"))})
 if i%100000==0:print("ORIGINAL_ROWS_CHECKED",i,flush=True)
print("RAW_MDT_AUDITED",dict(audit),flush=True)
def second(hhmmss):
 if not isinstance(hhmmss,str):return None
 digits=hhmmss.replace(":","")
 if len(digits)!=6 or not digits.isdigit():return None
 h,m,s=int(digits[:2]),int(digits[2:4]),int(digits[4:])
 if h>=24 or m>=60 or s>=60:return None
 return h*3600+m*60+s
def stats(values):
 a=[v for v in values if v is not None and math.isfinite(v)]
 return {"n":len(a),"median":round(median(a),2) if a else None}
rows=[]
for t in targets:
 key=(t["date"],t["customer"],t["cdrEnd"].replace(":",""))
 cdrstart=second(t["cdrStart"])
 candidates=[]
 for (source_key,start),eventrows in rawgroups.get(key,{}).items():
  start_sec=second(start)
  if start_sec is None or cdrstart is None:continue
  diff=start_sec-cdrstart
  # Same CDR and MDT event end; start may refer to different milestones.
  # Never use this difference to re-time the whole MDT series.
  if 0<=diff<=30:
   candidates.append((source_key,diff,eventrows))
 # Multiple source calls matching the same end or valid start window = no join.
 if len(candidates)==1:
  _,start_delta,events=candidates[0];status="UNIQUE_END_AND_START_BRACKET"
  audit["uniqueRawSourceCallMatch"]+=1
 elif len(candidates)>1:
  events=[];start_delta=None;status="AMBIGUOUS_SOURCE_CALLS"
  audit["ambiguousCallMatches"]+=1
 else:
  events=[];start_delta=None;status="NO_SOURCE_CALL_END_START_MATCH"
  audit["missingCallMatches"]+=1
 mos_values={round(e["rtcp_mos"],4) for e in events
             if e["rtcp_mos"] is not None and 1<=e["rtcp_mos"]<=5}
 if len(mos_values)>1:raise AssertionError("Unexpected per-call MOS variation in original")
 rsrp=stats([e["rsrp"] for e in events])
 rsrq=stats([e["rsrq"] for e in events])
 sinr=stats([e["sinr"] for e in events])
 counters={"rsrpAtMostMinus110":sum(e["rsrp"] is not None and e["rsrp"]<=-110 for e in events),
           "rsrqAtMostMinus15":sum(e["rsrq"] is not None and e["rsrq"]<=-15 for e in events),
           "sinrAtMostZero":sum(e["sinr"] is not None and e["sinr"]<=0 for e in events)}
 trigs=Counter(e["trigger"] for e in events if e["trigger"])
 phases=Counter(e["radioPhase"] for e in events if e["radioPhase"])
 timestamps=[e["timestamp"] for e in events if e["timestamp"]]
 hyp=[]
 if counters["rsrpAtMostMinus110"]:hyp.append("WEAK_RSRP_CALL_LEVEL_ASSOCIATION")
 if counters["rsrqAtMostMinus15"]:hyp.append("LOW_RSRQ_CALL_LEVEL_ASSOCIATION")
 if counters["sinrAtMostZero"]:hyp.append("LOW_SINR_CALL_LEVEL_ASSOCIATION")
 if trigs:hyp.append("MDT_TRIGGER_DESCRIPTIVE_ONLY")
 rows.append({"candidate":t["candidate"],"date":t["date"],"opaqueCallRef":t["callId"],
  "cdrMos":t["mos"],"originalMdtRows":len(events),
  "sourceCallJoinStatus":status,"mdtStartAfterCdrStartSec":start_delta,
  "rawEventStart":min(timestamps) if timestamps else None,
  "rawEventEnd":max(timestamps) if timestamps else None,
  "distinctRtcpMosInOriginal":len(mos_values),
  "perEventRtcpMosIdentifiable":False,
  "rsrp":rsrp,"rsrq":rsrq,"sinr":sinr,
  "thresholdSampleCounts":counters,
  "phases":dict(phases.most_common(8)),
  "triggers":dict(trigs.most_common(8)),
  "radioContextHypotheses":hyp,
  "rootCause":None,"rtcpImpairmentOnset":None,"clockOffset":None})
rows.sort(key=lambda r:(r["candidate"],r["date"],r["opaqueCallRef"]))
payload={"schemaVersion":"raw-matched-cdr-mdt-v2",
 "sourceRevision":data["sourceRevision"],
 "joinDefinition":"Exact anonymized customer/date+CDR-MDT call END second, MDT start 0..30 s later, exactly ONE raw MDT source call; NOT calibrated time correction",
 "summary":{"representativeCDRCalls":len(rows),"matchedCalls":audit["uniqueRawSourceCallMatch"],
            "ambiguousCalls":audit["ambiguousCallMatches"],"unmatchedCalls":audit["missingCallMatches"],
            "rawMdtRows":audit["rawMdtRows"],
            "matchedOriginalRows":sum(x["originalMdtRows"] for x in rows),
            "withWeakRsrp":sum("WEAK_RSRP_CALL_LEVEL_ASSOCIATION" in x["radioContextHypotheses"] for x in rows),
            "withLowRsrq":sum("LOW_RSRQ_CALL_LEVEL_ASSOCIATION" in x["radioContextHypotheses"] for x in rows),
            "withLowSinr":sum("LOW_SINR_CALL_LEVEL_ASSOCIATION" in x["radioContextHypotheses"] for x in rows),
            "withAnyTrigger":sum(bool(x["triggers"]) for x in rows),"confirmedRootCauses":0},
 "warning":"Call-level radio context only. No interval-RTCP onset, clock synchronization or independent control; no causality claim.",
 "calls":rows}
DEST.parent.mkdir(parents=True,exist_ok=True)
tmp=DEST.with_suffix(".json.tmp")
tmp.write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding="utf8")
os.replace(tmp,DEST)
print(json.dumps({"summary":payload["summary"],"byCandidate":{
  c["id"]:[{"rows":x["originalMdtRows"],"status":x["sourceCallJoinStatus"],
             "rsrp":x["rsrp"]["median"],"rsrq":x["rsrq"]["median"],"sinr":x["sinr"]["median"],
             "startDiff":x["mdtStartAfterCdrStartSec"],
             "hypotheses":x["radioContextHypotheses"]} for x in rows if x["candidate"]==c["id"]]
  for c in data["candidates"]},
 "output":str(DEST)},ensure_ascii=False,indent=2))
