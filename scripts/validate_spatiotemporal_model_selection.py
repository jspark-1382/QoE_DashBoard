"""Development-only threshold selection + strictly unseen customer/cell check.

A robust interpolation gate is *tested*, not asserted superior. Selected using
26-28 data only, evaluated 29-30 with customers/cells absent from development.
When gains don't generalize, preserve the simpler last-GNSS baseline.
"""
from pathlib import Path
from collections import defaultdict
import json,math,random,statistics
ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/"outputs/spatiotemporal-research-v1"
cases=json.loads((OUT/"evaluation-cases.json").read_text("utf8"))
dev=[r for r in cases if r["date"]<="2026-10-28"]
dev_customers={r["opaqueCustomer"] for r in dev}
dev_cells={r["cell"] for r in dev}
strict=[r for r in cases if r["date"]>="2026-10-29" and
        r["opaqueCustomer"] not in dev_customers and r["cell"] not in dev_cells and r["cell"]]
assert len(strict)==34,(len(strict),len(dev))
def pair(rows):
 return [r for r in rows if r["kind"]=="middle" and
  r.get("error_last_gnss") is not None and
  r.get("error_time_interpolation") is not None and r.get("bracketMotionMeters") is not None]
dev=pair(dev)
strict=pair(strict)
def value(row,t):
 return (row["error_time_interpolation"] if t>=0 and row["bracketMotionMeters"]<=t
         else row["error_last_gnss"])
def stats(a):
 if not a:return {"n":0,"meanM":None,"p50M":None,"p90M":None,"p95M":None}
 b=sorted(a)
 def quant(p):
  x=(len(b)-1)*p;i=int(x);j=min(i+1,len(b)-1)
  return round(b[i]*(1-(x-i))+b[j]*(x-i),3)
 return {"n":len(b),"meanM":round(statistics.mean(b),3),
         "p50M":quant(.5),"p90M":quant(.9),"p95M":quant(.95)}
thresholds=[-1,0,1,3,5,10,20,40,80,200,float("inf")]
trained=[{"thresholdMeters":threshold if math.isfinite(threshold) else "ALL_INTERPOLATION",
          "rawThreshold":threshold,
          "development":stats([value(r,threshold) for r in dev]),
          "interpolationUsed":sum(threshold>=0 and r["bracketMotionMeters"]<=threshold for r in dev)}
         for threshold in thresholds]
# Positive evidence required before promoting complexity. Simplest model wins
# equal dev mean; selection NEVER consults October 29-30 errors.
best=min(trained,key=lambda x:(x["development"]["meanM"],x["interpolationUsed"]))
baseline=stats([r["error_last_gnss"] for r in strict])
selected=stats([value(r,best["rawThreshold"]) for r in strict])
interpolated=stats([r["error_time_interpolation"] for r in strict])
diff=[value(r,best["rawThreshold"])-r["error_last_gnss"] for r in strict]
# Resample entire held-out customer bundles, not individual repeated calls.
customers=sorted({r["opaqueCustomer"] for r in strict})
groups=defaultdict(list)
for r in strict:groups[r["opaqueCustomer"]].append(r)
rnd=random.Random(246810)
draws=[]
if customers:
 for i in range(1500):
  subset=[r for k in (rnd.choice(customers) for _ in customers) for r in groups[k]]
  draws.append(statistics.mean(value(r,best["rawThreshold"])-r["error_last_gnss"] for r in subset))
draws.sort()
def q(a,p):
 if not a:return None
 ix=(len(a)-1)*p;lo=int(ix);hi=min(lo+1,len(a)-1)
 return round(a[lo]*(1-(ix-lo))+a[hi]*(ix-lo),3)
output={"schemaVersion":"qoe-model-selection-v1",
 "selection":"Dev Oct26-28 only: minimize mean GNSS pseudo-error; tie -> fewer interpolations",
 "strictTest":"Oct29-30 AND disjoint raw-derived customer and observed cell",
 "developmentPairedCount":len(dev),"strictTestPairedCount":len(strict),
 "strictTestCustomers":len(customers),
 "thresholdScan":[{"thresholdMeters":v["thresholdMeters"],
                   "development":v["development"],"interpolationUsed":v["interpolationUsed"]}
                  for v in trained],
 "selectedThresholdM":best["thresholdMeters"],
 "strictTestLastGNSS":baseline,"strictTestPureInterpolation":interpolated,
 "strictTestSelectedGate":selected,
 "pairedMeanErrorDifferenceSelectedMinusLastM":round(statistics.mean(diff),3) if diff else None,
 "customerBootstrapDifference95pctIntervalM":[q(draws,.025),q(draws,.975)],
 "empiricalBetterThanBaseline":bool(selected["meanM"] is not None and
                                  selected["meanM"]+1e-9<baseline["meanM"]),
 "promoteToProduction":False,
 "reason":"GNSS pseudo-truth is mostly stationary, no external surveyed truth or time-resolved RTCP, so tuning cannot certify impairment location.",
 "noTargetOrTestLeakage":True}
p=OUT/"model_selection_review.json"
p.write_text(json.dumps(output,ensure_ascii=False,indent=2,allow_nan=False),encoding="utf8")
print(json.dumps({k:v for k,v in output.items() if k!="thresholdScan"},ensure_ascii=False,indent=2))
print("SAVED",p)
