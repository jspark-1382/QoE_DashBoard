"""Source-backed alternative QoE candidate generation.

This script builds candidate *alternatives* to the published strict DBSCAN. It
never modifies original calls or the strict candidates. HDBSCAN, ST-DBSCAN and
KDE identify low-MOS spatial clusters/peaks. Scan and empirical Bayes operate
on location-approved calls ONLY; they cannot estimate network-wide risks due
to strongly differential normal-vs-poor location eligibility.

Outputs are keyed to the exact published scope and source revision.
"""
from __future__ import annotations
import hashlib
import json
import math
import os
from datetime import date as Date
from pathlib import Path
import numpy as np
from scipy.stats import beta as beta_dist
from sklearn.cluster import HDBSCAN
from sklearn.metrics.pairwise import haversine_distances

ROOT=Path(__file__).resolve().parents[1]
PUBLIC=Path(os.environ.get('QOE_PUBLIC_DIR', ROOT/'public'))
SOURCE=PUBLIC/"quality-improvement"
OUTPUT=PUBLIC/"quality-models"
OVERVIEWS=PUBLIC/"analyst-overview"/"MDT"
R=6371008.8
MODELS=("hdbscan","st_dbscan","adaptive_kde","spatial_scan","bayesian")
MIN_CUSTOMERS=3
MIN_DAYS=2

def dump(path, value):
 path.parent.mkdir(parents=True,exist_ok=True)
 path.write_text(json.dumps(value,ensure_ascii=False,separators=(",",":"),allow_nan=False),encoding="utf8")

def matrix_dist(points):
 if not points:return np.zeros((0,0),dtype=float)
 coords=np.radians(np.asarray([(p["lat"],p["lon"]) for p in points],dtype=float))
 return haversine_distances(coords)*R

def haversine_to(center,points):
 if not points:return np.zeros(0)
 a=np.radians(np.asarray([[center["lat"],center["lon"]]],dtype=float))
 b=np.radians(np.asarray([(p["lat"],p["lon"]) for p in points],dtype=float))
 return (haversine_distances(a,b)*R)[0]

def minmax_medoid(members):
 distances=matrix_dist(members)
 maxima=distances.max(axis=1)
 # deterministic when equal: first sorted call-id observation.
 return members[int(np.argmin(maxima))],float(maxima.min()),float(distances.max())

def datesplit(summary):
 return summary["discoveryDates"],summary["validationDates"]

def accepted_call_positions(revision):
 out={}
 for day in range(26,31):
  d=f"2026-10-{day}"
  e=json.loads((SOURCE/revision/"evidence"/(d+".json")).read_text(encoding="utf8"))
  overview=json.loads((OVERVIEWS/(d+".json")).read_text(encoding="utf8"))
  approved={r["callId"]:r for r in e["records"] if r.get("status")=="accepted"
            and r.get("mdtLinkStatus")=="unique" and not r.get("reasons")
            and r.get("kind") in ("gnss","reviewed-radio")
            and isinstance(r.get("lat"),(int,float)) and isinstance(r.get("lon"),(int,float))}
  all_scored={"poor":0,"normal":0}
  located={"poor":0,"normal":0}
  points=[]
  for call in overview["calls"]:
   mos=call.get("mos")
   if not isinstance(mos,(float,int)) or isinstance(mos,bool) or not 1<=mos<=5:continue
   label="poor" if mos<3 else "normal"
   all_scored[label]+=1
   identity=call["id"] if call["id"].startswith(d+":") else d+":"+call["id"]
   observation=approved.get(identity)
   if observation is None:continue
   located[label]+=1
   points.append({"callId":identity,"customerId":call["customerId"],"date":d,
       "mos":round(float(mos),4),"lat":float(observation["lat"]),"lon":float(observation["lon"]),
       "kind":observation["kind"],"startSecond":int(call.get("startSecond") or 0),
       "observedAt":observation.get("observedAt")})
  out[d]={"points":sorted(points,key=lambda p:p["callId"]),"allScored":all_scored,"located":located}
 return out

def count_coverage(dates,byday):
 return {"poorScored":sum(byday[d]["allScored"]["poor"] for d in dates),
         "normalScored":sum(byday[d]["allScored"]["normal"] for d in dates),
         "poorLocated":sum(byday[d]["located"]["poor"] for d in dates),
         "normalLocated":sum(byday[d]["located"]["normal"] for d in dates)}

def valid_members(group):
 return len(group)>=2 and len({p["customerId"] for p in group})>=MIN_CUSTOMERS and len({p["date"] for p in group})>=MIN_DAYS

def make_candidate(method,group,validation,ranking_score,analysis_radius=None,metric=None):
 group=sorted(group,key=lambda p:p["callId"])
 medoid,max_center,max_pair=minmax_medoid(group)
 radius=math.ceil(max(100,max_center+20)/10)*10 if analysis_radius is None else int(analysis_radius)
 discovery_customers={p["customerId"] for p in group}
 if validation:
  dists=np.min(np.asarray([haversine_to(p,validation) for p in group]),axis=0)
  nearby=[p for p,d in zip(validation,dists) if d<=100+1e-7]
 else:nearby=[]
 new_customers=sorted({p["customerId"] for p in nearby}-discovery_customers)
 h=hashlib.sha256((method+"|"+",".join(p["callId"] for p in group)).encode()).hexdigest()[:16]
 return {"id":method+"-"+h,"lat":medoid["lat"],"lon":medoid["lon"],"radiusM":radius,
  "poorCustomers":len(discovery_customers),"poorCalls":len(group),"days":len({p["date"] for p in group}),
  "gnssCalls":sum(p["kind"]=="gnss" for p in group),
  "validationNewCustomers":len(new_customers),"validationStatus":"not-applicable" if not validation else ("reobserved" if len(new_customers)>=2 else "insufficient-new-customers"),
  "maxCenterDistanceM":round(max_center,2),"maxPairDistanceM":round(max_pair,2),
  "rangeReviewRequired":max_pair>200,"rankingScore":round(float(ranking_score),6),
  "metric":metric or {},
  "members":group,"validationPoints":nearby}

def finalize(method, groups,validation):
 # The input is (member-list, score, analysis-radius, metric).
 candidates=[]
 seen=set()
 for group,score,radius,metric in sorted(groups,key=lambda c:-c[1]):
  if not valid_members(group):continue
  ids=frozenset(p["callId"] for p in group)
  if ids in seen:continue
  # Do not present same underlying calls as multiple independent candidates.
  if any(len(ids & prev)/max(1,len(ids | prev))>=0.6 for prev in seen):continue
  seen.add(ids)
  candidates.append(make_candidate(method,group,validation,score,radius,metric))
 candidates.sort(key=lambda c:(-c["poorCustomers"],-c["days"],-c["poorCalls"],-c["rankingScore"],c["id"]))
 rank=0
 for c in candidates:
  if not c["rangeReviewRequired"]:
   rank+=1;c["rank"]=rank
  else:c["rank"]=None
 return candidates[:20]

def hdbscan_model(train,min_cluster_size=3,min_samples=2):
 if len(train)<3:return []
 coords=np.radians(np.asarray([(p["lat"],p["lon"]) for p in train]))
 labels=HDBSCAN(min_cluster_size=min_cluster_size,min_samples=min_samples,metric="haversine",algorithm="ball_tree",copy=False).fit_predict(coords)
 return [( [p for p,label in zip(train,labels) if label==k],float(sum(labels==k)),None,{"minClusterSize":min_cluster_size,"minSamples":min_samples})
  for k in sorted(set(labels)) if k>=0]

def st_dbscan_model(train,eps_m=100,eps_hours=48):
 if len(train)<2:return []
 dist=matrix_dist(train)
 times=np.array([Date.fromisoformat(p["date"]).toordinal()*86400+p["startSecond"] for p in train])
 near=(dist<=eps_m+1e-7)&(np.abs(times[:,None]-times[None,:])<=eps_hours*3600)
 labels=np.full(len(train),-2,dtype=int)
 cluster=0
 for i in range(len(train)):
  if labels[i]!=-2:continue
  neighbours=np.flatnonzero(near[i]).tolist()
  if len(neighbours)<2:labels[i]=-1;continue
  queue=list(neighbours)
  queued=set(queue)
  labels[i]=cluster
  index=0
  while index<len(queue):
   j=queue[index];index+=1
   if labels[j]==-1:labels[j]=cluster
   if labels[j]!=-2:continue
   labels[j]=cluster
   extension=np.flatnonzero(near[j]).tolist()
   if len(extension)>=2:
    for k in extension:
     if k not in queued:queued.add(k);queue.append(k)
  cluster+=1
 return [([p for i,p in enumerate(train) if labels[i]==k],float(sum(labels==k)),None,{"epsM":eps_m,"epsHours":eps_hours})
  for k in range(cluster)]

def adaptive_kde_model(train,bandwidth_scale=1.0,support_m=180):
 if len(train)<3:return []
 d=matrix_dist(train)
 bandwidth=np.asarray([(70 if p["kind"]=="gnss" else 160)*bandwidth_scale for p in train],dtype=float)
 # The bandwidths are sensitivity assumptions, NOT measured location accuracy.
 weights=np.asarray([1/sum(q["customerId"]==p["customerId"] for q in train) for p in train])
 kernels=np.exp(-.5*(d/bandwidth[np.newaxis,:])**2)*weights[np.newaxis,:]/(2*math.pi*bandwidth[np.newaxis,:]**2)
 density=kernels.sum(axis=1)
 order=np.argsort(-density,kind="stable")
 groups=[]
 used=set()
 for i in order:
  if int(i) in used:continue
  # 180m is an exploratory KDE support neighbourhood, not a location confidence bound.
  ids=np.flatnonzero(d[i]<=support_m+1e-7).tolist()
  group=[train[j] for j in ids if j not in used]
  if not valid_members(group):continue
  selected={j for j in ids if j not in used}
  used|=selected
  groups.append((group,float(density[i]*1e8),support_m,
   {"relativeDensity":round(float(density[i]*1e8),5),"bandwidthGnssM":70*bandwidth_scale,"bandwidthRadioM":160*bandwidth_scale,"supportRadiusM":support_m,"peakLat":train[i]["lat"],"peakLon":train[i]["lon"]}))
 return groups

def spatial_scan_model(train,normal,radius_options=(100,200,400),permutations=99):
 allpoints=train+normal
 n=len(allpoints);np_=len(train)
 if np_<3 or len(normal)<5:return []
 d=matrix_dist(allpoints)
 windows=[]
 # Pre-register scan windows from ALL approved locations, not only poor-call
 # locations. Selecting test windows based on observed poor labels invalidates
 # a max-statistic permutation p-value even within the approved-only subset.
 for i in range(n):
  for radius in radius_options:
   membership=d[i]<=radius+1e-7
   total=int(membership.sum())
   if 5<=total<n:
    windows.append((i,radius,membership))
 if not windows:return []
 masks=np.stack([x[2] for x in windows]).astype(np.float64)
 total=masks.sum(axis=1)
 count=masks[:,:np_].sum(axis=1)
 global_p=np_/n
 inside_p=np.clip(count/total,1e-8,1-1e-8)
 outside_p=np.clip((np_-count)/(n-total),1e-8,1-1e-8)
 llr=np.where(inside_p>outside_p,
   count*np.log(inside_p/global_p)+(total-count)*np.log((1-inside_p)/(1-global_p))
   +(np_-count)*np.log(outside_p/global_p)
   +((n-np_)-(total-count))*np.log((1-outside_p)/(1-global_p)),0)
 # Conditional label permutations: these p-values apply ONLY to the location-
 # accepted case-control subset, not the network population. Max statistic
 # over tested windows accounts for searching multiple scan windows.
 rng=np.random.default_rng(20261107)
 maxima=[]
 for _ in range(permutations):
  case=rng.choice(n,size=np_,replace=False)
  scores=masks[:,case].sum(axis=1)
  pi=np.clip(scores/total,1e-8,1-1e-8)
  po=np.clip((np_-scores)/(n-total),1e-8,1-1e-8)
  s=np.where(pi>po,
   scores*np.log(pi/global_p)+(total-scores)*np.log((1-pi)/(1-global_p))
   +(np_-scores)*np.log(po/global_p)
   +((n-np_)-(total-scores))*np.log((1-po)/(1-global_p)),0)
  maxima.append(float(max(s)))
 max_null=np.array(maxima)
 groups=[]
 for k in np.argsort(-llr,kind="stable")[:60]:
  if llr[k]<=0:continue
  idx,radius,mask=windows[int(k)]
  members=[train[j] for j in range(np_) if bool(mask[j])]
  score=float(llr[k])
  p_cond=float((1+sum(max_null>=score))/(len(max_null)+1))
  groups.append((members,score,radius,
    {"scanLlr":round(score,4),"conditionalPermutationP":round(p_cond,4),
     "locatedNormalInWindow":int(total[k]-count[k]),
     "locatedPoorInWindow":int(count[k]),
     "locatedReferenceRate":round(global_p,4),
     "locatedWindowPoorRate":round(float(count[k]/total[k]),4),
     "windowRadiusM":radius,"windowCenterLat":allpoints[idx]["lat"],"windowCenterLon":allpoints[idx]["lon"]}))
 return groups

def bayes_model(train,normal,bandwidth_m=200,prior_strength=20,day_decay=.7):
 allpoints=train+normal
 n=len(allpoints);np_=len(train)
 if np_<3 or len(normal)<5:return []
 d=matrix_dist(allpoints)
 p0=np_/n
 # Empirical Bayes spatial/time-weighted binomial kernel. This is NOT a
 # fitted BYM2 spatial random-effect model or a population risk estimate.
 alpha0=max(.1,prior_strength*p0);beta0=max(.1,prior_strength*(1-p0))
 days=np.asarray([Date.fromisoformat(p["date"]).toordinal() for p in allpoints])
 group=[]
 for i in range(np_):
  distances=d[i]
  age=np.abs(days-days[i])
  weights=np.exp(-.5*(distances/bandwidth_m)**2)*(day_decay**age)
  weighted_poor=float(weights[:np_].sum())
  weighted_total=float(weights.sum())
  if weighted_total<6:continue
  posterior_a=alpha0+weighted_poor
  posterior_b=beta0+weighted_total-weighted_poor
  probability=float(beta_dist.sf(p0+.1,posterior_a,posterior_b))
  low,upper=beta_dist.ppf([.025,.975],posterior_a,posterior_b)
  ids=np.flatnonzero(distances[:np_]<=220+1e-7).tolist()
  members=[train[j] for j in ids]
  group.append((members,probability,220,
   {"priorStrength":prior_strength,"spatialBandwidthM":bandwidth_m,"dayWeightPerDay":day_decay,
    "locatedSubsetPriorPoorRate":round(p0,4),
    "posteriorMean":round(float(posterior_a/(posterior_a+posterior_b)),4),
    "credibleLow":round(float(low),4),"credibleHigh":round(float(upper),4),
    "probabilityAboveLocatedBaselinePlus10pp":round(probability,4),
    "effectiveLocatedSample":round(weighted_total,2),"priorAlpha":round(alpha0,6),"priorBeta":round(beta0,6),"posteriorAlpha":round(posterior_a,6),"posteriorBeta":round(posterior_b,6),"weightedPoor":round(weighted_poor,5),"posteriorCenterLat":train[i]["lat"],"posteriorCenterLon":train[i]["lon"]}))
 return group

def model_entry(name,train,normal,valid):
 if name=="hdbscan":
  groups=hdbscan_model(train);parameters={"minClusterSize":3,"minSamples":2,"distance":"Haversine"}
 elif name=="st_dbscan":
  groups=st_dbscan_model(train);parameters={"epsSpaceM":100,"epsTimeHours":48,"minSamples":2}
 elif name=="adaptive_kde":
  groups=adaptive_kde_model(train);parameters={"kernel":"Gaussian","gnssBandwidthM":70,"radioBandwidthM":160,"candidateSupportM":180}
 elif name=="spatial_scan":
  groups=spatial_scan_model(train,normal);parameters={"radiiM":[100,200,400],"permutations":99,"population":"approved-located-only"}
 else:
  groups=bayes_model(train,normal);parameters={"method":"time-decayed spatial empirical Beta-Binomial","bandwidthM":200,"priorStrength":20,"dayDecay":0.7}
 status="exploratory-located-only" if name in ("spatial_scan","bayesian") else "computed"
 return {"status":status,"parameters":parameters,
  "discoveryApprovedPoorCalls":len(train),"discoveryApprovedNormalCalls":len(normal),
  "candidates":finalize(name,groups,valid)}

def generate(analysis_mode="evaluation"):
 if analysis_mode not in ("all","evaluation"):raise ValueError("invalid mode")
 summary_root=PUBLIC/("quality-improvement-full" if analysis_mode=="all" else "quality-improvement")
 output_root=PUBLIC/("quality-models-full" if analysis_mode=="all" else "quality-models")
 index=json.loads((summary_root/"index.json").read_text(encoding="utf8"))
 revision=index["sourceRevision"]
 byday=accepted_call_positions(revision)
 outindex={"schemaVersion":"quality-model-index-v1","sourceRevision":revision,"entries":[]}
 for entry in index["entries"]:
  summary=json.loads((summary_root/entry["path"]).read_text(encoding="utf8"))
  scope=summary["scope"]
  dates=[f"2026-10-{d:02d}" for d in range(int(scope["dateStart"][-2:]),int(scope["dateEnd"][-2:])+1)]
  coverage=count_coverage(dates,byday)
  discovery,validation=datesplit(summary)
  normal=[];train=[];valid=[]
  from_second=int(scope["from"][:2])*3600+int(scope["from"][3:5])*60
  to_second=int(scope["to"][:2])*3600+int(scope["to"][3:5])*60+59
  for d in dates:
   for p in byday[d]["points"]:
    if not(from_second<=p["startSecond"]<=to_second):continue
    if p["mos"]<3:
     if d in discovery:train.append(p)
     elif d in validation:valid.append(p)
    elif d in discovery:normal.append(p)
  train.sort(key=lambda p:p["callId"])
  normal.sort(key=lambda p:p["callId"])
  valid.sort(key=lambda p:p["callId"])
  report={"schemaVersion":"quality-alternative-models-v1","analysisMode":analysis_mode,"scope":scope,"scopeKey":summary["scopeKey"],
    "sourceRevision":revision,"discoveryDates":discovery,"validationDates":validation,
    "coverage":coverage,"selectionBiasWarning":"위치 확보 저MOS와 정상 MOS 통화의 확보율이 크게 달라, Scan/Bayesian 값은 관측 가능 부분집합에 대한 탐색용 결과로만 해석해야 합니다.",
    "models":{m:model_entry(m,train,normal,valid) for m in MODELS}}
  path=f"{revision}/{summary['scopeKey']}.json"
  dump(output_root/path,report)
  outindex["entries"].append({"scopeKey":summary["scopeKey"],"scope":scope,"path":path,
     "candidateCounts":{m:len(report["models"][m]["candidates"]) for m in MODELS}})
  print(json.dumps({"scope":scope["dateStart"]+".."+scope["dateEnd"],
    "train":len(train),"normal":len(normal),"validation":len(valid),
    "candidates":{m:len(report["models"][m]["candidates"]) for m in MODELS}}),flush=True)
 outindex["analysisMode"]=analysis_mode
 dump(output_root/"index.json",outindex)

if __name__=="__main__":
 import argparse
 parser=argparse.ArgumentParser()
 parser.add_argument("--analysis-mode",choices=["all","evaluation"],default="evaluation")
 generate(parser.parse_args().analysis_mode)
