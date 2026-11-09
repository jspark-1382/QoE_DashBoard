"""Precompute faithful, interactive *fictional* learning scenarios.

All candidate labels/scores come from the very same Python implementations
used for published model results. Model calculations run over a small
self-contained deterministic synthetic dataset and DO NOT change real maps.
The browser only selects among these verified pre-computed parameter states.
"""
from __future__ import annotations
import json
import hashlib
import math
from itertools import product
from pathlib import Path
import numpy as np
from scipy.stats import beta as beta_distribution
import importlib.util

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location("quality_model_impl",ROOT/"scripts"/"build-quality-model-alternatives.py")
engine=importlib.util.module_from_spec(spec);spec.loader.exec_module(engine)
OUT=ROOT/"public"/"quality-model-simulations"/"v1"
LAT=37.478;LON=127.046

def pt(ident,x,y,day=26,kind="gnss",mos=2.6,hr=13):
 lat=LAT+y/111320
 lon=LON+x/(111320*math.cos(math.radians(LAT)))
 return dict(id=ident,callId="simulation-"+ident,customerId="SIM-CUSTOMER-"+ident,
             lat=lat,lon=lon,x=float(x),y=float(y),date=f"2026-10-{day:02d}",
             startSecond=hr*3600,mos=mos,kind=kind)

POOR=[
 ("A",0,0,26,"gnss",12),("B",27,10,27,"gnss",12),("C",46,-12,26,"reviewed-radio",14),
 ("D",82,12,27,"gnss",15),("E",112,26,26,"reviewed-radio",12),("F",148,6,27,"gnss",15),
 ("G",395,7,26,"gnss",10),("H",418,-12,27,"gnss",12),("I",450,17,26,"reviewed-radio",11),
 ("J",488,8,27,"gnss",14),("K",515,-5,26,"gnss",11)
]
NORMAL=[
 ("N1",-35,65,26),("N2",15,100,27),("N3",145,95,26),("N4",225,60,27),
 ("N5",275,38,27),("N6",342,-60,26),("N7",390,90,27),("N8",450,95,26),
 ("N9",515,95,27),("N10",600,12,26),("N11",710,40,27),("N12",-120,15,26),
 ("N13",320,125,26),("N14",680,-70,27),
]
CASES={
 "focused":{"name":"기본: 두 지역에 모인 저MOS","note":"밀도가 다른 두 위치의 저MOS와 정상/주의 통화를 함께 관찰합니다. 지도의 점은 가상 통화이며 실제 주소가 아닙니다.","spread":1.0,"dateShift":False,"moreNormal":False},
 "scattered":{"name":"분산·시간차: 군집이 끊길까?","note":"일부 점 사이를 늘리고 관측 간 날짜를 멀리 해, 공간·시간 조건이 군집을 갈라놓는지 확인합니다.","spread":1.55,"dateShift":True,"moreNormal":False},
 "controls":{"name":"정상 표본 증가: 위험도 변화","note":"저MOS 점은 유지하면서 위치 승인 정상/주의 관측이 더 많아졌다고 가정합니다. 모집단 편향 문제가 없어지는 것은 아닙니다.","spread":1.0,"dateShift":False,"moreNormal":True},
}
def scenario(case):
 d=CASES[case]
 train=[];normal=[]
 for ident,x,y,day,kind,hour in POOR:
  x*=d["spread"];y*=d["spread"]
  if d["dateShift"]:
   day=26 if ident in "ABCDE" else (29 if ident in "FGHIJK" else day)
  train.append(pt(ident,x,y,day,kind,2.7,hour))
 for ident,x,y,day in NORMAL:
  normal.append(pt(ident,x*d["spread"],y*d["spread"],day,"gnss",4.15,14))
 if d["moreNormal"]:
  for i in range(18):
   x=20+(i%6)*25
   y=-90+(i//6)*30
   normal.append(pt("X"+str(i+1),x,y,26+i%2,"gnss",4.2,12))
 validation=[pt("V1",25*d["spread"],5*d["spread"],30,"gnss",2.6,13),
             pt("V2",42*d["spread"],-8*d["spread"],30,"reviewed-radio",2.5,14),
             pt("V3",700*d["spread"],-70,30,"gnss",2.6,11)]
 train.sort(key=lambda p:p["callId"])
 normal.sort(key=lambda p:p["callId"])
 return train,normal,validation

def ground_reference(train,params):
 d=engine.matrix_dist(train)
 return d

def compute(model,train,normal,valid,params):
 if model=="hdbscan":return engine.hdbscan_model(train,params["min_cluster_size"],params["min_samples"])
 if model=="st_dbscan":return engine.st_dbscan_model(train,params["eps_m"],params["eps_hours"])
 if model=="adaptive_kde":return engine.adaptive_kde_model(train,params["bandwidth_scale"],params["support_m"])
 if model=="spatial_scan":return engine.spatial_scan_model(train,normal,(params["radius_m"],),99)
 if model=="bayesian":return engine.bayes_model(train,normal,params["bandwidth_m"],params["prior_strength"],.7)
 raise ValueError(model)

CONTROLS={
"hdbscan":{"min_cluster_size":[3,4,5],"min_samples":[2,3]},
"st_dbscan":{"eps_m":[70,100,150],"eps_hours":[24,48,72]},
"adaptive_kde":{"bandwidth_scale":[.6,1.,1.4],"support_m":[120,180,240]},
"spatial_scan":{"radius_m":[100,200,400]},
"bayesian":{"bandwidth_m":[100,200,300],"prior_strength":[5,20,50]},
}
DEFAULTS={
 "hdbscan":{"min_cluster_size":3,"min_samples":2},
 "st_dbscan":{"eps_m":100,"eps_hours":48},
 "adaptive_kde":{"bandwidth_scale":1.0,"support_m":180},
 "spatial_scan":{"radius_m":200},
 "bayesian":{"bandwidth_m":200,"prior_strength":20}
}
LABELS={
 "hdbscan":{"min_cluster_size":"최소 군집 크기","min_samples":"핵심 밀도 판단 점 수"},
 "st_dbscan":{"eps_m":"공간 이웃 거리 (m)","eps_hours":"시간 이웃 범위 (시간)"},
 "adaptive_kde":{"bandwidth_scale":"커널 폭 배수","support_m":"피크 주변 후보 검색 거리 (m)"},
 "spatial_scan":{"radius_m":"검사할 원형 창 반경 (m)"},
 "bayesian":{"bandwidth_m":"공간 영향 폭 (m)","prior_strength":"사전분포 강도"},
}
def round_f(value):return round(float(value),5)
def brief(p):return {k:p[k] for k in ("id","x","y","date","customerId","kind","mos","startSecond")}
def nearest_details(model,train,normal,params,groups):
 d=engine.matrix_dist(train)
 details={"pairABDistanceM":round_f(d[0,1]),"trainCount":len(train),"normalCount":len(normal)}
 if model=="hdbscan":
  k=params["min_samples"]
  core=np.sort(d,axis=1)[:,k-1]
  mr=np.maximum(np.maximum(core[:,None],core[None,:]),d)
  unvisited={*range(len(train))}
  chosen=min(unvisited);unvisited.remove(chosen)
  edges=[]
  while unvisited:
   i,j=min(((i,j) for i in range(len(train)) if i not in unvisited for j in unvisited),key=lambda ij:(mr[ij],ij))
   unvisited.remove(j)
   edges.append({"a":train[i]["id"],"b":train[j]["id"],"metricM":round_f(mr[i,j])})
  details["coreDistancesM"]={p["id"]:round_f(core[i]) for i,p in enumerate(train)}
  details["mutualReachabilityABM"]=round_f(mr[0,1])
  details["mst"] =edges
 elif model=="st_dbscan":
  hrs=np.array([int(p["date"][-2:])*24+p["startSecond"]/3600 for p in train])
  edge=[]
  for i in range(len(train)):
   for j in range(i+1,len(train)):
    if d[i,j]<=params["eps_m"]+1e-7 and abs(hrs[i]-hrs[j])<=params["eps_hours"]:
     edge.append({"a":train[i]["id"],"b":train[j]["id"],"distanceM":round_f(d[i,j]),
                  "hours":round_f(abs(hrs[i]-hrs[j]))})
  details["edges"]=edge
  details["pairABHours"]=round_f(abs(hrs[0]-hrs[1]))
 elif model=="adaptive_kde":
  h=np.array([(70 if p["kind"]=="gnss" else 160)*params["bandwidth_scale"] for p in train])
  w=np.array([1/sum(q["customerId"]==p["customerId"] for q in train) for p in train])
  density=(np.exp(-.5*(d/h[np.newaxis,:])**2)*w[np.newaxis,:]/(2*math.pi*h[np.newaxis,:]**2)).sum(axis=1)
  details["densityById"]={p["id"]:round_f(density[i]*1e8) for i,p in enumerate(train)}
  details["kernelWidthByIdM"]={p["id"]:round_f(h[i]) for i,p in enumerate(train)}
  details["peakId"]=train[int(np.argmax(density))]["id"]
  details["peakDensity"]=round_f(max(density)*1e8)
 elif model=="spatial_scan":
  allpoints=train+normal
  sample=len(allpoints)
  details["approvedSubsetPoorRate"]=round_f(len(train)/sample)
  # Real selected scan center and actual members are supplied by the
  # engine's top window metric, not guessed from the candidate medoid.
  if groups:
   score=max(groups,key=lambda g:g[1])
   details["topWindowMetric"]=score[3]
 elif model=="bayesian":
  details["approvedSubsetPoorRate"]=round_f(len(train)/(len(train)+len(normal)))
  if groups:
   best=max(groups,key=lambda g:g[1])[3]
   a=best["posteriorAlpha"];b=best["posteriorBeta"]
   a0=best["priorAlpha"];b0=best["priorBeta"]
   grid=np.linspace(.01,.99,61)
   cur=beta_distribution.pdf(grid,a,b)
   prior=beta_distribution.pdf(grid,a0,b0)
   scale=max(cur.max(),prior.max())
   details["betaCurves"]={"probabilities":[round_f(v) for v in grid],
      "prior":[round_f(v/scale) for v in prior],
      "posterior":[round_f(v/scale) for v in cur]}
 return details

def beta_curves_for(metric):
 a,b=metric["posteriorAlpha"],metric["posteriorBeta"]
 a0,b0=metric["priorAlpha"],metric["priorBeta"]
 grid=np.linspace(.01,.99,61)
 posterior=beta_distribution.pdf(grid,a,b)
 prior=beta_distribution.pdf(grid,a0,b0)
 mx=max(float(max(posterior)),float(max(prior)),1e-10)
 return {"probabilities":[round_f(v) for v in grid],
         "prior":[round_f(v/mx) for v in prior],
         "posterior":[round_f(v/mx) for v in posterior]}

def records(model,scenario_name,params):
 train,normal,validation=scenario(scenario_name)
 groups=compute(model,train,normal,validation,params)
 output=engine.finalize(model,groups,validation)
 details=nearest_details(model,train,normal,params,groups)
 compact=[]
 for c in output:
  metric=c["metric"]
  lat=metric.get("peakLat",metric.get("windowCenterLat",metric.get("posteriorCenterLat",c["lat"])))
  lon=metric.get("peakLon",metric.get("windowCenterLon",metric.get("posteriorCenterLon",c["lon"])))
  actual=next((p for p in train+normal if p["lat"]==lat and p["lon"]==lon),None)
  compact.append({
   "analysisCenterX":actual["x"] if actual else next(p["x"] for p in train if p["lat"]==c["lat"] and p["lon"]==c["lon"]),
   "analysisCenterY":actual["y"] if actual else next(p["y"] for p in train if p["lat"]==c["lat"] and p["lon"]==c["lon"]),
   "id":c["id"],
   "memberIds":[next(p["id"] for p in train if p["callId"]==m["callId"]) for m in c["members"]],
   "validationIds":[next(p["id"] for p in validation if p["callId"]==v["callId"]) for v in c["validationPoints"]],
   "customerCount":c["poorCustomers"],"callCount":c["poorCalls"],"dayCount":c["days"],
   "newCustomers":c["validationNewCustomers"],"centerX":next(p["x"] for p in train if p["lat"]==c["lat"] and p["lon"]==c["lon"]),
   "centerY":next(p["y"] for p in train if p["lat"]==c["lat"] and p["lon"]==c["lon"]),
   "radiusM":c["radiusM"],"maxCenterM":c["maxCenterDistanceM"],"maxPairM":c["maxPairDistanceM"],
   "rangeReview":c["rangeReviewRequired"],"score":c["rankingScore"],"metrics":c["metric"],
   "betaCurves":beta_curves_for(metric) if model=="bayesian" else None
  })
 return {"params":params,"case":scenario_name,"points":[brief(p) for p in train],
         "normalPoints":[brief(p) for p in normal],"validationPoints":[brief(p) for p in validation],
         "candidates":compact,"details":details}

def key_for(params):return "|".join(f"{k}:{v}" for k,v in sorted(params.items()))
def generate():
 manifest={"version":1,"generator":"scripts/build-quality-model-simulations.py",
           "models":list(CONTROLS),"cases":{k:{"name":v["name"],"note":v["note"]} for k,v in CASES.items()},
           "controls":CONTROLS,"defaults":DEFAULTS,"labels":LABELS,
           "description":"Exact deterministic Python-model calculations on SYNTHETIC examples; never the network-wide production score."}
 engine.OUTPUT.mkdir(parents=True,exist_ok=True)
 for model,opts in CONTROLS.items():
  paramskeys=list(opts)
  states={}
  for case in CASES:
   for values in product(*(opts[k] for k in paramskeys)):
    params=dict(zip(paramskeys,values))
    signature=case+"|"+key_for(params)
    states[signature]=records(model,case,params)
  filepath=OUT/(model+".json")
  payload={"schemaVersion":"quality-educational-model-sim-v1","model":model,"states":states}
  engine.dump(filepath,payload)
  digest=hashlib.sha256(filepath.read_bytes()).hexdigest()
  manifest[model]={"states":len(states),"sha256":digest,"bytes":filepath.stat().st_size}
  print(json.dumps({"model":model,"states":len(states),"bytes":filepath.stat().st_size,
                    "defaultCandidates":len(states["focused|"+key_for(DEFAULTS[model])]["candidates"])}),flush=True)
 engine.dump(OUT/"index.json",manifest)

if __name__=="__main__":generate()
