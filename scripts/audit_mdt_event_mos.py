"""Audit raw MDT event RTCP MOS without assuming identical CDR MOS(v5).
Only aggregates saved, never subscriber identifiers.
"""
from __future__ import annotations
import json,math,collections,statistics,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from mdt_pipeline import read_rows,parse_timestamp,numeric
ROOT=Path(__file__).resolve().parent.parent
source=next((ROOT/'data'/'MDT_New').glob('261026_1030_VoLTE+MDT*.xlsx'))
out=ROOT/'outputs'/'mdt-event-mos-audit.json'
groups={}
audit=collections.Counter();by_day=collections.defaultdict(collections.Counter)
by_phase=collections.defaultdict(collections.Counter)
for n,row in enumerate(read_rows(source),1):
 day=str(row.get('base_date','')).strip()
 key=(day,str(row.get('svc_cont_id','')).strip(),str(row.get('lte_vc_div','')).strip())
 state=groups.setdefault(key,[0,set(),[]])
 state[0]+=1
 kind=str(row.get('mdt_div','')).strip()
 mos=numeric(row.get('rtcp_mos'))
 rsrp=numeric(row.get('rsrp'))
 ts=parse_timestamp(row.get('occ_dt'))
 if mos is not None and math.isfinite(mos):
  audit['numeric_rtcp_mos']+=1;by_day[day]['mos_event']+=1
  by_phase[kind]['with_mos']+=1
  if 1<=mos<=5:
   audit['rtcp_mos_in_1_to_5']+=1
   state[1].add(round(mos,4))
   if len(state[2])<250:state[2].append((ts,mos,rsrp,kind))
  else:audit['rtcp_mos_outside_1_to_5']+=1
  if ts is not None:by_phase[kind]['with_timestamp']+=1
 else:by_phase[kind]['without_mos']+=1
 if kind.startswith('Call_'):
  audit['Call_phase_events']+=1
  if mos is not None:audit['Call_phase_with_mos']+=1
 if rsrp is not None:audit['events_with_rsrp']+=1
 if n%100000==0:print('MDT_MOS_RAW_ROWS',n,flush=True)
stats=collections.Counter();mos_diff=[];time_diffs=[]
for (day,_,_), (size,distinct,eventrows) in groups.items():
 stats['groups']+=1
 if distinct:stats['groups_with_mos']+=1
 if len(distinct)>=2:
  stats['groups_with_multiple_mos_values']+=1
  vals=[x[1] for x in eventrows]
  if len(vals)>1:mos_diff.append(max(vals)-min(vals))
 if size>1:stats['groups_multiple_rows']+=1
 if len(eventrows)>=2:
  ascending=sorted([e for e in eventrows if e[0] is not None],key=lambda x:x[0])
  if len(ascending)>=2 and len({x[1] for x in ascending})>1:
   time_diffs.extend((b[0]-a[0]).total_seconds() for a,b in zip(ascending,ascending[1:]) if (b[0]-a[0]).total_seconds()>=0)
 by_day[day]['groups']+=1
 by_day[day]['groups_with_varying_mos']+=len(distinct)>=2
def statsvals(values):
 if not values:return {'n':0}
 x=sorted(values)
 return {'n':len(x),'median':round(statistics.median(x),4),'p90':round(x[min(len(x)-1,int(.9*len(x)))],4),'max':round(x[-1],4)}
report={'source_file':source.name,'input_events':n,'stats':dict(stats),'numeric_audit':dict(audit),
 'per_date':{day:dict(counts) for day,counts in by_day.items()},
 'per_phase_top20':dict(sorted(((p,dict(c)) for p,c in by_phase.items()),key=lambda x:-x[1].get('with_mos',0))[:20]),
 'within_call_mos_range':statsvals(mos_diff),'consecutive_mos_event_gap_s':statsvals(time_diffs),
 'finding':'Event RTCP MOS is a candidate for time-local MOS evidence if semantics and source clock are confirmed; not presumed equal to CDR RTCP MOS(v5).'}
out.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
print('MDT_MOS_AUDIT',json.dumps({k:report[k] for k in ['stats','numeric_audit','within_call_mos_range','consecutive_mos_event_gap_s']},ensure_ascii=False))
print('SAVED',out)
