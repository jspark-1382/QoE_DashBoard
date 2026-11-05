from pathlib import Path
import json, collections, statistics
m=json.load(open('public/voice-1030.json',encoding='utf8'))
counts=collections.Counter();ages=[];days=collections.Counter()
for entry in m['days']:
 if not entry.get('gnssSampleCount',0):continue
 d=json.load(open('public/'+entry['dataPath'],encoding='utf8'))
 grouped=collections.defaultdict(list)
 for r in d['samples']:
  md=r[21] or {}
  if md.get('locationSource')=='gnss' and isinstance(r[2],(int,float)) and isinstance(r[3],(int,float)):
   try:
    from datetime import datetime
    ts=datetime.fromisoformat(md['timestamp'].replace('Z','+00:00')).timestamp()
   except (ValueError,TypeError,KeyError,AttributeError):continue
   grouped[r[19]].append((ts,r[2],r[3]))
 for call,fixes in grouped.items():
  counts['gnss_calls']+=1;counts['gnss_fixes']+=len(fixes)
  ordered=sorted(fixes)
  if len(ordered)<2:continue
  target=ordered[-1]
  previous=[p for p in ordered[:-1] if p[0]<target[0]]
  if not previous:continue
  age=target[0]-previous[-1][0]
  ages.append(age)
  if age<=180:
   counts['holdout_calls_180s']+=1
   days[entry['date']]+=1
  else:counts['over_180s']+=1
print('GNSS_HOLDOUT_PROFILE',dict(counts),'DATES',dict(days),'AGE_MEDIAN',statistics.median(ages) if ages else None,
'P90',sorted(ages)[int(len(ages)*.9)] if ages else None,'AGE_SMALL_UNDER_1S',sum(x<1 for x in ages))
