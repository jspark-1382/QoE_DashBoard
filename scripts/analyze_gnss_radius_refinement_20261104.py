"""Complementary descriptive geometry and stale-GNSS audit.
Do not use retrospective five-day fits as independent validation.
"""
from pathlib import Path
from collections import Counter,defaultdict
from itertools import combinations
import json,math,numpy as np
from sklearn.metrics.pairwise import haversine_distances

root=Path.cwd()
data=json.loads((root/'outputs/gnss-radius-sensitivity-20261104.json').read_text('utf8'))
all_poor=[]
all_norm=[]
for day in range(26,31):
 date=f'2026-10-{day:02d}'
 overview=json.loads((root/'public/analyst-overview/MDT'/f'{date}.json').read_text('utf8'))
 by={x['id']:x for x in overview['calls']}
 for loc in overview['callLocations']:
  if loc.get('evidence')!='gnss':continue
  call=by.get(loc['callId'])
  if not call or not isinstance(call.get('mos'),(int,float)):continue
  x={'lat':float(loc['lat']),'lon':float(loc['lon']),
    'date':date,'customer':call['customerId'],'poor':call['mos']<3,
    'positionQuality':loc.get('positionQuality'),'referenceBasis':loc.get('referenceBasis'),
    'ageS':loc.get('gnssReferenceAgeSec'),'possibleRadiusM':loc.get('possibleRadiusM'),
    'mos':call['mos']}
  (all_poor if x['poor'] else all_norm).append(x)

R=6371008.8
def d(a,b):
 return float(haversine_distances(np.radians([[a['lat'],a['lon']]]),
                                 np.radians([[b['lat'],b['lon']]])).item()*R)
def mincircle(points):
 lat0=sum(p['lat'] for p in points)/len(points)
 lon0=sum(p['lon'] for p in points)/len(points)
 def convert(p):
  return np.array([(p['lon']-lon0)*math.pi/180*R*math.cos(math.radians(lat0)),
                   (p['lat']-lat0)*math.pi/180*R])
 xyz=[convert(p) for p in points]
 candidates=list(xyz)
 candidates.extend((xyz[i]+xyz[j])/2 for i,j in combinations(range(len(xyz)),2))
 for i,j,k in combinations(range(len(xyz)),3):
  a,b,c=xyz[i],xyz[j],xyz[k]
  de=2*(a[0]*(b[1]-c[1])+b[0]*(c[1]-a[1])+c[0]*(a[1]-b[1]))
  if abs(de)<1e-8:continue
  a2=a@a;b2=b@b;c2=c@c
  center=np.array([(a2*(b[1]-c[1])+b2*(c[1]-a[1])+c2*(a[1]-b[1]))/de,
                   (a2*(c[0]-b[0])+b2*(a[0]-c[0])+c2*(b[0]-a[0]))/de])
  candidates.append(center)
 center,rad=min(((c,max(float(np.linalg.norm(z-c)) for z in xyz)) for c in candidates),key=lambda x:x[1])
 loc={'lat':lat0+float(center[1])*180/math.pi/R,
      'lon':lon0+float(center[0])*180/math.pi/(R*math.cos(math.radians(lat0)))}
 return loc,rad
def summary(items):
 return {"count":len(items),"distinctCustomers":len({p['customer'] for p in items}),
    "freshWithin1sec":sum(isinstance(p['ageS'],(int,float)) and p['ageS']<=1 for p in items),
    "freshWithin10sec":sum(isinstance(p['ageS'],(int,float)) and p['ageS']<=10 for p in items),
    "lastKnownOver60s":sum(p['referenceBasis']=='last-known-gnss' for p in items),
    "ageSec":sorted(round(p['ageS'] or 0,1) for p in items),
    "assumedMovementRadiusM":sorted(round(p['possibleRadiusM'] or 0) for p in items)}
out=[]
for z in data['candidates']:
 old_samples=z['sourceGnssQuality']
 source_candidates=[]
 for p in old_samples:
  matches=[x for x in all_poor if x['date']==p['date'] and d(x,p)<0.1]
  assert len(matches)==1,(z['id'],p,len(matches))
  source_candidates.append(matches[0])
 training_customers={p['customer'] for p in source_candidates}
 test_candidates=[p for p in all_poor if p['date']=='2026-10-30' and p['customer'] not in training_customers and
                  min(d(p,t) for t in source_candidates)<=100]
 assert len({p['customer'] for p in test_candidates})==2
 combined=source_candidates+test_candidates
 a,b=mincircle(combined)
 orig=z['choices']['display_current']['center']
 shift=d({'lat':orig[0],'lon':orig[1]},a)
 # Purely descriptive all-known points fit: no longer independent validation
 normal_inside=[p for p in all_norm if d(p,a)<=b+0.05]
 poor_inside=[p for p in all_poor if d(p,a)<=b+0.05]
 center_train=z['choices']['minimum_enclosing_training_disk']['center']
 center_train={'lat':center_train[0],'lon':center_train[1]}
 train_min_radius=z['choices']['minimum_enclosing_training_disk']['radiusM']
 holdout_dists=[round(d(t,center_train),1) for t in test_candidates]
 plus30=max(30,train_min_radius+30)
 plus40=max(40,train_min_radius+40)
 row={
  'candidate':z['id'],'originalCenter':orig,'originalRadiusM':z['currentRadiusM'],
  'training':summary(source_candidates),'holdout':summary(test_candidates),
  'allFiveDayMinCircleCenter':[round(a['lat'],7),round(a['lon'],7)],
  'allFiveDayMinCircleRadiusM':round(b,1),'shiftFromOriginalM':round(shift,1),
  'allFiveDayCirclePoorCalls':len(poor_inside),
  'allFiveDayCircleNormalCalls':len(normal_inside),
  'allFiveDayCircleNormalDistinctCustomers':len({p['customer'] for p in normal_inside}),
  'trainOnlyMinimalCenter':center_train,
  'trainOnlyMinimalRadiusM':train_min_radius,
  'trainOnlyCenterHeldOutDistancesM':holdout_dists,
  'trainOnlyCirclePlus30M':round(plus30,1),
  'trainOnlyCirclePlus30HeldoutCustomers':len({p['customer'] for p in test_candidates if d(p,center_train)<=plus30}),
  'trainOnlyCirclePlus40M':round(plus40,1),
  'trainOnlyCirclePlus40HeldoutCustomers':len({p['customer'] for p in test_candidates if d(p,center_train)<=plus40})
 }
 out.append(row)
 print(json.dumps(row,ensure_ascii=False,indent=2))
f=root/'outputs/gnss_radius_refinement_review_20261104.json'
f.write_text(json.dumps({'notes':[
 'All-five-day minimum circle uses holdout data and is descriptive only, NOT independent validation.',
 '250m GNSS possibleRadiusM base is an assumed conservative movement/offset model, not sensor-supplied GPS 95% accuracy.',
 'Selected call-end GNSS may not be at MOS impairment onset.'],
 'results':out},ensure_ascii=False,indent=2),encoding='utf8')
print('SAVED',f)
