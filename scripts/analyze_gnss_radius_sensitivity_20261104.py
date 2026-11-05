"""GNSS investigation zone radius audit — train 26-29 Oct, hold out 30 Oct.

All candidate centers/radii are derived from train GNSS only, then evaluated
against customers unseen in that train cluster. Validation day is never used
to choose a center or tune a display radius.
"""
from __future__ import annotations
from collections import defaultdict,Counter
from pathlib import Path
from itertools import combinations
import json,math,statistics
import numpy as np
from sklearn.cluster import DBSCAN
from sklearn.metrics.pairwise import haversine_distances

ROOT=Path(__file__).resolve().parent.parent
EARTH=6371008.8
DATES=[f"2026-10-{day:02d}" for day in range(26,31)]
report=json.loads((ROOT/"public/improvement-candidates/2026-10-26_2026-10-30.json").read_text("utf8"))
assert report["sourceRevision"]=="557c39d2c6a9a5b4c69b"
candidate_list=[c for c in report["candidates"] if c["kind"]=="spatial"]
assert len(candidate_list)==3

all_gnss=[]
for date in DATES:
    source=json.loads((ROOT/"public/analyst-overview/MDT"/(date+".json")).read_text("utf8"))
    calls={c["id"]:c for c in source["calls"]}
    assert source["sourceRevision"]==report["sourceRevision"]
    for pos in source["callLocations"]:
        if pos.get("evidence")!="gnss":continue
        call=calls.get(pos["callId"])
        if not call or not isinstance(call.get("mos"),(float,int)) or not 1<=call["mos"]<=5:continue
        all_gnss.append({"date":date,"lat":float(pos["lat"]),"lon":float(pos["lon"]),
           "customer":call["customerId"],"call":call["id"],"poor":call["mos"]<3,
           "mos":call["mos"],"possibleRadiusM":pos.get("possibleRadiusM"),
           "gnssReferenceAgeSec":pos.get("gnssReferenceAgeSec"),"referenceBasis":pos.get("referenceBasis"),
           "representativeBasis":pos.get("representativeBasis"),
           "positionQuality":pos.get("positionQuality"),"secondsBeforeEnd":pos.get("secondsBeforeEnd"),
           "byeStationLat":pos.get("byeStationLat"),"byeStationLon":pos.get("byeStationLon")})

train=[x for x in all_gnss if x["poor"] and x["date"]<DATES[-1]]
test=[x for x in all_gnss if x["poor"] and x["date"]==DATES[-1]]
normal=[x for x in all_gnss if not x["poor"]]
train_rads=np.radians([[x["lat"],x["lon"]] for x in train])

def dist(a,b):
    return float(haversine_distances(np.radians([[a["lat"],a["lon"]]]),
                  np.radians([[b["lat"],b["lon"]]])).item()*EARTH)
def dist_list(p,items):
    return [dist(p,q) for q in items]

def xy(point,lat0,lon0):
    return np.array([(point["lon"]-lon0)*math.pi/180*EARTH*math.cos(math.radians(lat0)),
                     (point["lat"]-lat0)*math.pi/180*EARTH],float)
def latlon(xy0,lat0,lon0):
    return {"lat":lat0+float(xy0[1])/EARTH*180/math.pi,
       "lon":lon0+float(xy0[0])/(EARTH*math.cos(math.radians(lat0)))*180/math.pi}
def circumcenter(a,b,c):
    d=2*(a[0]*(b[1]-c[1])+b[0]*(c[1]-a[1])+c[0]*(a[1]-b[1]))
    if abs(d)<1e-9:return None
    a2=a@a;b2=b@b;c2=c@c
    return np.array([(a2*(b[1]-c[1])+b2*(c[1]-a[1])+c2*(a[1]-b[1]))/d,
                     (a2*(c[0]-b[0])+b2*(a[0]-c[0])+c2*(b[0]-a[0]))/d])
def min_disk(points):
    lat0=np.mean([x["lat"] for x in points]);lon0=np.mean([x["lon"] for x in points])
    pts=[xy(p,lat0,lon0) for p in points]
    best=(float("inf"),None)
    for point in pts:
        rad=max(float(np.linalg.norm(z-point)) for z in pts)
        if rad<best[0]:best=rad,point
    for i,j in combinations(range(len(pts)),2):
        center=(pts[i]+pts[j])/2
        rad=max(float(np.linalg.norm(z-center)) for z in pts)
        if rad<best[0]:best=rad,center
    for i,j,k in combinations(range(len(pts)),3):
        center=circumcenter(pts[i],pts[j],pts[k])
        if center is None:continue
        rad=max(float(np.linalg.norm(z-center)) for z in pts)
        if rad<best[0]:best=rad,center
    # Assertion: truly encloses all points; candidate center only from TRAIN
    assert max(float(np.linalg.norm(p-best[1])) for p in pts)<=best[0]+1e-5
    return latlon(best[1],lat0,lon0),best[0]

def clusters(eps):
    labels=DBSCAN(eps=eps/EARTH,min_samples=2,metric="haversine").fit_predict(train_rads)
    groups=defaultdict(list)
    for i,c in enumerate(labels):
        if c>=0:groups[int(c)].append(train[i])
    return list(groups.values())

base_groups=clusters(100)
out=[]
for candidate in candidate_list:
    ref=candidate["location"]
    valid=[]
    for group in base_groups:
        if any(dist(ref,x)<.2 for x in group):
            valid.append(group)
    assert len(valid)==1,(candidate["id"],len(valid))
    samples=valid[0]
    clients={x["customer"] for x in samples}
    holdout=[x for x in test if x["customer"] not in clients and min(dist(x,t) for t in samples)<=100]
    # IMPORTANT: Test data used to quantify coverage, never calculate center.
    medoid=next(x for x in samples if dist(x,ref)<.2)
    min_center,min_radius=min_disk(samples)
    radii=[35,50,60,75,90,100,120,150,170,200,250]
    # Train-derived choices; no holdout data
    choices={
      "display_current":{"center":ref,"radius":ref["radiusM"]},
      "medoid_full_training_0_margin":{"center":ref,"radius":max(dist_list(ref,samples))},
      "medoid_full_training_10m_margin":{"center":ref,"radius":max(20,max(dist_list(ref,samples))+10)},
      "minimum_enclosing_training_disk":{"center":min_center,"radius":min_radius},
      "minimum_enclosing_training_disk_plus_20m":{"center":min_center,"radius":min_radius+20},
    }
    choice_results={}
    for label,data in choices.items():
        center=data["center"];radius=float(data["radius"])
        covered=[x for x in holdout if dist(x,center)<=radius]
        near_norm=[x for x in normal if dist(x,center)<=radius]
        choice_results[label]={"center":[round(center["lat"],7),round(center["lon"],7)],
          "radiusM":round(radius,1),
          "trainingCovered":sum(dist(x,center)<=radius+0.25 for x in samples),
          "holdoutDistinctNewCustomers":len({x["customer"] for x in covered}),
          "holdoutCalls":len(covered),
          "holdoutDistancesM":sorted(round(dist(x,center),1) for x in holdout),
          "normalDistinctCustomers":len({x["customer"] for x in near_norm}),
          "normalCalls":len(near_norm)}
    sweeps=[]
    for radius in radii:
        tr=[x for x in samples if dist(x,ref)<=radius]
        te=[x for x in holdout if dist(x,ref)<=radius]
        norm=[x for x in normal if dist(x,ref)<=radius]
        sweeps.append({"radiusM":radius,"trainingCustomers":len({x["customer"] for x in tr}),
          "trainingCalls":len(tr),"trainingDays":len({x["date"] for x in tr}),
          "holdoutNewCustomers":len({x["customer"] for x in te}),"holdoutCalls":len(te),
          "normalCustomers":len({x["customer"] for x in norm}),"normalCalls":len(norm)})
    eps_sweep=[]
    for eps in [35,50,60,75,90,100,120,150,200]:
        matched=[]
        for g in clusters(eps):
            # Reconstruct by matching >= 2 source calls with ORIGINAL 100m cluster.
            common={x["call"] for x in g} & {x["call"] for x in samples}
            if len(common)<2:continue
            train_clients={x["customer"] for x in g}
            test_near=[x for x in test if x["customer"] not in train_clients and min(dist(x,t) for t in g)<=eps]
            matched.append({"trainCalls":len(g),"commonCalls":len(common),
             "trainCustomers":len(train_clients),"trainDates":len({x["date"] for x in g}),
             "heldoutNewCustomers":len({x["customer"] for x in test_near}),
             "center":min_disk(g)[0],"minEncloseRadius":round(min_disk(g)[1],1)})
        eps_sweep.append({"epsM":eps,"matched":matched})
    quality=[]
    for x in samples:
        quality.append({
          "date":x["date"],
          "lat":round(x["lat"],7),"lon":round(x["lon"],7),
          "fromCurrentCenterM":round(dist(x,ref),1),
          "fromMinimumDiskCenterM":round(dist(x,min_center),1),
          "secondsBeforeEnd":x["secondsBeforeEnd"],
          "possibleRadiusM":x["possibleRadiusM"],
          "positionQuality":x["positionQuality"],"referenceBasis":x["referenceBasis"],
          "gnssReferenceAgeSec":x["gnssReferenceAgeSec"],
          "distanceToByeStationM":round(dist(x,{"lat":x["byeStationLat"],"lon":x["byeStationLon"]}),1)
            if isinstance(x["byeStationLat"],(int,float)) and isinstance(x["byeStationLon"],(int,float)) else None})
    out.append({"id":candidate["id"],"label":candidate["label"],
      "currentRadiusM":ref["radiusM"],"trainCount":len(samples),
      "trainCustomers":len(clients),"holdoutCalls":len(holdout),
      "holdoutDistinctCustomers":len({x["customer"] for x in holdout}),
      "trainingPairwiseMaxM":round(max(dist(samples[i],samples[j]) for i,j in combinations(range(len(samples)),2)),1),
      "trainingMaxDistFromOriginalCenterM":round(max(dist_list(ref,samples)),1),
      "choices":choice_results,"sweep":sweeps,"epsSweep":eps_sweep,"sourceGnssQuality":quality})
data={"analysis":"GNSS spatial radius shrink independent validation sensitivity",
      "dates":DATES,"discoveryDates":DATES[:-1],"holdoutDate":DATES[-1],
      "warning":"Representative CDR-end-nearest GNSS with possibleRadiusM, not proven actual MOS impairment location",
      "candidates":out}
path=ROOT/"outputs/gnss-radius-sensitivity-20261104.json"
path.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding="utf8")
for x in out:
    print("\n===",x["id"],x["label"],"ORIGINAL",x["currentRadiusM"],"TRAIN",x["trainCount"],"HOLDOUT",x["holdoutDistinctCustomers"],"===")
    print("PAIRWISE MAX",x["trainingPairwiseMaxM"],"MEDOID_MAX",x["trainingMaxDistFromOriginalCenterM"])
    for name,ch in x["choices"].items():
        print("CHOICE",name,ch)
    print("RADIUS SWEEP (fixed original center)")
    for row in x["sweep"]:print(row)
    print("EPS SWEEP")
    for row in x["epsSweep"]:print(row)
    print("GNSS_SOURCE_QUALITY")
    for row in x["sourceGnssQuality"]:print(row)
print("SAVED",path)
