"""Build read-only full-window DBSCAN candidates from the already audited
SIP/RTCP + approved location evidence. Existing holdout products are untouched.

The production location gates, haversine DBSCAN, medoid and range calculations
are imported from scripts/voice_improvement_1.py rather than reimplemented.
"""
from __future__ import annotations
import json
from pathlib import Path
from datetime import date,timedelta
from voice_improvement_1 import _candidates

ROOT=Path(__file__).resolve().parents[1]
PUBLISHED=ROOT/"public"/"quality-improvement"
OUT=ROOT/"public"/"quality-improvement-full"
OVERVIEW=ROOT/"public"/"analyst-overview"/"MDT"
REVISION_INDEX=json.loads((PUBLISHED/"index.json").read_text(encoding="utf8"))
REVISION=REVISION_INDEX["sourceRevision"]
POLICY={"epsM":100,"minSamples":2,"minPoorCustomers":3,"minPoorDates":2,
        "minNewCustomers":2,"maxDiameterMultiplier":2,"locationPolicy":"strict-3-site-v1"}
def write(path,data):
 path.parent.mkdir(parents=True,exist_ok=True)
 path.write_text(json.dumps(data,ensure_ascii=False,separators=(",",":"),allow_nan=False),encoding="utf8")
def days_between(start,end):
 a,b=date.fromisoformat(start),date.fromisoformat(end)
 return [(a+timedelta(days=i)).isoformat() for i in range((b-a).days+1)]
def approved_by_day():
 combined={}
 for d in REVISION_INDEX["availableDates"]:
  evidence=json.loads((PUBLISHED/REVISION/"evidence"/(d+".json")).read_text(encoding="utf8"))
  assert evidence["revision"]==REVISION and evidence["policy"]==POLICY["locationPolicy"]
  approved={r["callId"]:r for r in evidence["records"] if r.get("status")=="accepted"
            and r.get("mdtLinkStatus")=="unique" and not r.get("reasons")
            and r.get("kind") in ("gnss","reviewed-radio") and isinstance(r.get("lat"),(int,float)) and isinstance(r.get("lon"),(int,float))}
  original=json.loads((OVERVIEW/(d+".json")).read_text(encoding="utf8"))
  calls={};points={}
  for call in original["calls"]:
   id_=call["id"] if call["id"].startswith(d+":") else d+":"+call["id"]
   r=approved.get(id_)
   if r is None:continue
   mos=call.get("mos")
   if not isinstance(mos,(int,float)) or isinstance(mos,bool) or not 1<=mos<3:continue
   point={"callId":id_,"rawCallId":call.get("rawCallId"),
          "customerId":call["customerId"],"date":d,"mos":float(mos),
          "lat":float(r["lat"]),"lon":float(r["lon"]),"kind":r["kind"],
          "observedAt":r.get("observedAt"),"ageSec":r.get("ageSec")}
   points[id_]=point
   calls[id_]={"date":d,"callId":id_,"rawCallId":call.get("rawCallId"),
        "customerId":call["customerId"],"startedAt":call.get("startTimestamp"),
        "endedAt":None,"mos":mos,"sipReason":call.get("sipCause"),
        "mdtLinkStatus":"unique","sourceRevision":REVISION,
        "sourceFile":"voice-1030.json","overviewSourceFile":d+".json",
        "start":call.get("start"),"end":call.get("end"),
        "endCellId":call.get("endCellId"),"contractId":call.get("contractId")}
  combined[d]=(points,calls,approved)
  print(json.dumps({"date":d,"approvedPoor":len(points)}),flush=True)
 return combined
def publish():
 byday=approved_by_day()
 entries=[]
 for entry in REVISION_INDEX["entries"]:
  scope=entry["scope"]
  dates=days_between(scope["dateStart"],scope["dateEnd"])
  assert set(dates)<=set(byday)
  points=[];callmap={};approval={}
  from_s=int(scope["from"][:2])*3600+int(scope["from"][3:5])*60
  to_s=int(scope["to"][:2])*3600+int(scope["to"][3:5])*60+59
  for d in dates:
   daypoints,calls,accepted=byday[d]
   # CDR startSecond from the published overview; all current scopes are full
   # day but do not silently accept another time range.
   if from_s!=0 or to_s!=86399:
    overview=json.loads((OVERVIEW/(d+".json")).read_text(encoding="utf8"))
    valid={d+":"+c["id"] for c in overview["calls"] if from_s<=c["startSecond"]<=to_s}
   else:valid=None
   for id_,p in daypoints.items():
    if valid is not None and id_ not in valid:continue
    points.append(p);callmap[id_]=calls[id_];approval[id_]=accepted[id_]
  points.sort(key=lambda p:p["callId"])
  candidates,noise=_candidates(points,dates,[],POLICY)
  key="full-"+entry["scopeKey"]
  directory=REVISION+"/"+key
  affected={callmap[id_]["customerId"] for c in candidates for id_ in c["memberCallIds"]}
  cards=[]
  for i,c in enumerate(candidates):
   cid=c["id"]
   ids=c["memberCallIds"]
   details={"schemaVersion":"quality-candidate-detail-v1","scope":scope,"scopeKey":key,
     "candidate":c,"calls":[callmap[identity] for identity in ids],
     "decisions":[{"callId":identity,**approval[identity]} for identity in ids]}
   assert all(p["role"]=="discovery-member" for p in c["nearbyPoints"])
   assert len(set(c["customerIds"]))>=POLICY["minPoorCustomers"] and len(c["poorDates"])>=POLICY["minPoorDates"]
   assert c["validationStatus"]=="not-applicable"
   write(OUT/directory/(cid+".json"),details)
   cards.append({"id":cid,"label":"전체 기간 후보 "+str(i+1),
     "poorCustomerCount":c["poorCustomerCount"],"poorCallCount":c["poorCallCount"],
     "poorDateCount":c["poorDateCount"],"medoid":c["medoid"],
     "displayRadiusM":c["displayRadiusM"],"rangeReviewRequired":c["rangeReviewRequired"],
     "rank":c["rank"],"validationStatus":"not-applicable",
     "validationNewCustomers":0,"detailPath":directory+"/"+cid+".json"})
  summary={"schemaVersion":"quality-candidate-summary-v1","scope":scope,"scopeKey":key,
    "discoveryDates":dates,"validationDates":[],"distinctAffectedCustomers":len(affected),
    "observationPath":directory+"/observations.json",
    "auditReference":"docs/quality-full-period-model-evaluation-20261108.md",
    "candidates":cards}
  write(OUT/directory/"summary.json",summary)
  write(OUT/directory/"observations.json",{"schemaVersion":"quality-observations-v1","scope":scope,"points":points})
  entries.append({"scope":scope,"scopeKey":key,"path":directory+"/summary.json"})
  print(json.dumps({"scope":scope["dateStart"]+".."+scope["dateEnd"],
         "mode":"all","approvedPoor":len(points),"candidates":len(cards),"uniqueCustomers":len(affected)}),flush=True)
 index={"schemaVersion":"quality-improvement-index-v1","sourceRevision":REVISION,
    "analysisMode":"all","availableDates":REVISION_INDEX["availableDates"],
    "entries":entries,"evidence":[]}
 write(OUT/"index.json",index)
if __name__=="__main__":
 publish()
