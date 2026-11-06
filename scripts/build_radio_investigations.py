"""Generate source-backed poor-VoLTE call investigations and cell triage shortlist.
No onset-time claim. No wireless-cause proof from CDR aggregates. No invented UE coordinates.
"""
from __future__ import annotations
import argparse, json, math, collections, statistics, sys, os
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from build_voice_1030 import read_cdr
from inventory_provenance import verify_inventory_provenance
from lte_station_catalog import resolve_lte_master
ROOT=Path(__file__).resolve().parent.parent
PUBLIC=Path(os.environ.get('QOE_PUBLIC_DIR',str(ROOT/'public')))
METRICS=('txPacketLoss','rxPacketLoss','txJitter','rxJitter','txLossCount','rxLossCount')
def finite(value):
 return isinstance(value,(int,float)) and math.isfinite(value)
def fmt(value):
 return round(value,5) if finite(value) else None
def percentile(arr,rate):
 if not arr:return None
 values=sorted(arr)
 return values[max(0,min(len(values)-1,math.ceil(rate*len(values))-1))]
def classify(mos):
 return 'no-mos' if mos is None else 'poor' if mos<3 else 'fair' if mos<3.5 else 'good'
def atomic_json(path,value,pretty=False):
 temporary=path.with_suffix(path.suffix+'.tmp')
 temporary.write_text(json.dumps(value,ensure_ascii=False,
                      indent=2 if pretty else None,
                      separators=None if pretty else (',',':')),encoding='utf8')
 os.replace(temporary,path)

def main():
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--public-dir',type=Path,default=PUBLIC)
 parser.add_argument('--lte-master',type=Path,default=None)
 parser.add_argument('--mdt-audit',type=Path,default=ROOT/'outputs'/'mdt-event-mos-audit.json')
 parser.add_argument('--source-audit',type=Path,default=ROOT/'outputs'/'radio-original-source-audit.json')
 args=parser.parse_args()
 public_dir=args.public_dir.resolve()
 MAN=json.loads((public_dir/'voice-1030.json').read_text(encoding='utf8'))
 inventory=resolve_lte_master(args.lte_master) if 'stationInventory' in MAN['meta'] or args.lte_master else None
 verify_inventory_provenance(MAN,inventory,'radio investigations')
 DATES=list(MAN['meta']['dates'])
 MDT_AUDIT=json.loads(args.mdt_audit.read_text(encoding='utf8'))
 SOURCE_AUDIT=json.loads(args.source_audit.read_text(encoding='utf8'))
 source_files=set(MAN['meta']['sourceFiles'])
 if MDT_AUDIT.get('source_file') not in source_files:
  raise RuntimeError('MDT event audit does not match the current manifest source')
 for kind in ('sip_cdr','mdt'):
  info=SOURCE_AUDIT['sources'][kind]
  source_path=ROOT/'data'/'MDT_New'/info['file']
  if info['file'] not in source_files or not source_path.is_file() or source_path.stat().st_size!=info['size_bytes']:
   raise RuntimeError('Original source audit no longer matches current CDR/MDT inputs: '+kind)
 CDR=ROOT/'data'/'MDT_New'/SOURCE_AUDIT['sources']['sip_cdr']['file']
 OUT=public_dir/'radio-investigation'
 OUT.mkdir(parents=True,exist_ok=True)
 print('READING_ORIGINAL_CDR',CDR.name,flush=True)
 calls,audit=read_cdr(CDR,'all')
 print('CDR_LOADED',len(calls),'BAD',audit['poorMos'],flush=True)
 assert len(calls)==MAN['meta']['totalCalls']
 assert audit['poorMos']==1403
 dev=['2026-10-26','2026-10-27','2026-10-28']
 baseline={name:[c['rtp'][name] for c in calls
                if c['date'] in dev and classify(c['mos'])=='good' and finite(c['rtp'][name])]
           for name in METRICS}
 thresholds={name:fmt(percentile(values,.95)) for name,values in baseline.items()}
 assert all(v is not None for v in thresholds.values()),thresholds
 print('BASELINE_GOOD_CDR_P95',thresholds,flush=True)
 locations={}
 for day in DATES:
  overview=json.load(open(public_dir/'analyst-overview'/'MDT'/f'{day}.json',encoding='utf8'))
  if overview.get('sourceRevision')!=MAN['meta']['revision'] or overview.get('source')!='MDT' or overview.get('date')!=day:
   raise RuntimeError('Overview source/date/revision mismatch')
  for p in overview['callLocations']:
   locations[p['callId']]=p
 assert len(locations)==len(set(locations))
 partitions={(d['customerId'],d['date']):d['dataPath'] for d in MAN['days'] if d.get('sampleCount',0)>0}
 dayresults={day:[] for day in DATES}
 risk=collections.Counter()
 cell_counts=collections.defaultdict(lambda:collections.Counter())
 by_grade=collections.Counter()
 source_types=collections.Counter()
 radio_sample_counts=collections.Counter()
 evidence_reason_counts=collections.Counter()
 cache={}
 bad=[c for c in calls if classify(c['mos'])=='poor']
 for c in calls:
  if c['mos'] is not None:
   cell_counts[(c['date'],c['endCellId'])]['scored']+=1
   cell_counts[(c['date'],c['endCellId'])][classify(c['mos'])]+=1
 for seq,c in enumerate(bad,1):
  date=c['date']
  loc=locations.get(c['customerId']+':'+c['id'])
  source=loc['evidence'] if loc else 'unlocated'
  source_types[source]+=1
  key=(c['customerId'],date)
  radio=[]
  if key in partitions:
   if key not in cache:
    raw=json.load(open(public_dir/partitions[key],encoding='utf8'))
    if raw.get('customerId')!=c['customerId'] or raw.get('date')!=date:
     raise RuntimeError('MDT partition identity mismatch')
    by=collections.defaultdict(list)
    for sample in raw['samples']:
     by[sample[19]].append(sample)
    cache[key]=by
   radio=cache[key].get(c['id'],[])
  radio_sample_counts['with_mdt' if radio else 'without_mdt']+=1
  low_rsrp=[s for s in radio if finite(s[10]) and s[10]<=-110]
  low_sinr=[s for s in radio if finite(s[12]) and s[12]<=0]
  low_rsrq=[s for s in radio if finite(s[11]) and s[11]<=-15]
  flags=[]
  for keymetric,threshold in thresholds.items():
   value=c['rtp'].get(keymetric)
   if finite(value) and threshold is not None and value>threshold:
    flags.append({'kind':'RELATIVE_CDR_RTP_ELEVATION','metric':keymetric,
     'observed':fmt(value),'development_good_p95':threshold,
     'basis':'통화 전체 CDR 요약값의 상위 5% 초과; 무선 기인 여부 미확정'})
    evidence_reason_counts['higher_'+keymetric]+=1
  if len(low_rsrp)>=2:
   flags.append({'kind':'WEAK_RSRP_MDT','count':len(low_rsrp),
     'basis':'해당 통화에 연결된 MDT 무선 관측 RSRP<=-110dBm; 위치 검증과 분리'})
   evidence_reason_counts['weak_rsrp']+=1
  if len(low_sinr)>=2:
   flags.append({'kind':'LOW_SINR_MDT','count':len(low_sinr),
     'basis':'해당 통화에 연결된 MDT SINR<=0dB 관측; 간섭/혼잡 단정 불가'})
   evidence_reason_counts['low_sinr']+=1
  if len(low_rsrq)>=2:
   flags.append({'kind':'LOW_RSRQ_MDT','count':len(low_rsrq),
     'basis':'해당 통화에 연결된 MDT RSRQ<=-15dB 관측; PRB 부하 부재'})
   evidence_reason_counts['low_rsrq']+=1
  if c['startCellId'] and c['endCellId'] and c['startCellId']!=c['endCellId']:
   flags.append({'kind':'START_END_CELL_DIFFERENT','basis':'두 Cell ID가 다름. HO 실패 또는 문제 발생 시점의 Serving Cell을 증명하지 못함'})
   evidence_reason_counts['different_start_end_cell']+=1
  packetEvidence=any(f['kind']=='RELATIVE_CDR_RTP_ELEVATION' for f in flags)
  radioEvidence=any(f['kind'] in ('WEAK_RSRP_MDT','LOW_SINR_MDT','LOW_RSRQ_MDT') for f in flags)
  if packetEvidence and radioEvidence:
   level='RTCP_CDR_AND_RADIO_ASSOCIATION_ONLY'
   recommended='패킷 요약 저하와 MDT 무선 관측이 공존함. 같은 시점인지 RTP/RTCP 원시 패킷·RRC/HO·셀 부하 확인'
  elif radioEvidence:
   level='MDT_RADIO_OBSERVATION_ONLY'
   recommended='RSRP/SINR/RSRQ 이벤트 시각 주변 기지국 로그 확인. MOS 저하 시각은 확인되지 않음'
  elif packetEvidence:
   level='CDR_RTP_IMPAIRMENT_ONLY'
   recommended='RTP 손실·지터의 TX/RX 방향과 시간별 패킷 로그 확인; 무선/전송망 원인 분리 필요'
  else:
   level='LOW_MOS_ONLY'
   recommended='통화 MOS 외 원인 증거 부족. RTP 원본·RRC/HO 및 현장 확인 우선'
  risk[level]+=1
  site_class='LAST_GNSS_REFERENCE' if source=='gnss' else 'BYE_TOWER_ONLY' if source=='bye-cell' else 'REVIEWED_RADIO' if source=='estimated' else 'UNLOCATED'
  positioning={
   'basis':site_class,'observedPositionIsPoorOnset':False,
   'point':{'lat':loc['lat'],'lon':loc['lon']} if loc else None,
   'gnssAgeSeconds':loc.get('gnssReferenceAgeSec') if loc else None,
   'gnssPossibleRadiusM':loc.get('possibleRadiusM') if loc else None,
   'byeRu':loc.get('byeRuId') if loc else None,
   'byeCellId':loc.get('byeCellId') if loc else c['endCellId'],
   'byePci':loc.get('byePci') if loc else None,
   'byeInventoryPciStatus':loc.get('byeInventoryPciStatus') if loc else None,
   'byeInventory':loc.get('byeInventory') if loc else None,
   'byeStation':{'lat':loc['byeStationLat'],'lon':loc['byeStationLon']}
     if loc and loc.get('byeStationLat') is not None else None,
  }
  row={
   'callId':c['id'],'customerId':c['customerId'],'date':date,
   'callStart':c['startDt'].isoformat(),'callEnd':c['endDt'].isoformat(),
   'mos':c['mos'],'mosStatus':c['mosStatus'],
   'startCellId':c['startCellId'],'endCellId':c['endCellId'],
   'mdtSamples':len(radio),'radioRsrpMin':fmt(min((s[10] for s in radio if finite(s[10])),default=None)),
   'radioSinrMin':fmt(min((s[12] for s in radio if finite(s[12])),default=None)),
   'radioRsrqMin':fmt(min((s[11] for s in radio if finite(s[11])),default=None)),
   'rtpSummary':{k:fmt(c['rtp'][k]) for k in METRICS},
   'rtcpMosEventMeaning':'UNVERIFIED_REPEATED_SUMMARY',
   'qualityOnsetAt':None,'qualityOnsetEvidence':'NOT_OBSERVED_FROM_AVAILABLE_SOURCES',
   'radioRootCause':None,'radioRootCauseStatus':'NOT_PROVEN',
   'evidenceLevel':level,'supportingObservations':flags,
   'position':positioning,'recommendedCheck':recommended,
  }
  dayresults[date].append(row)
  if seq%300==0:print('POOR_TRIAGE',seq,flush=True)
 # Aggregate across 5 dates; no user/person columns in ranking.
 cell_summary=collections.defaultdict(lambda:collections.Counter())
 for (day,cell),counts in cell_counts.items():
  if not cell:continue
  for k,v in counts.items():cell_summary[cell][k]+=v
 candidates=sorted(
  ({'cellId':cell,'poorCalls':counts['poor'],'scoredCdrCalls':counts['scored'],
    'datesWithPoorCalls':sum(cell_counts[(d,cell)]['poor']>0 for d in DATES),
    'interpretation':'표본 CDR의 진단 우선순위 후보; RU 미확정 가능·품질 불량률/무선 원인 아님'}
   for cell,counts in cell_summary.items() if counts['poor']>0),
  key=lambda x:(-x['poorCalls'],-x['datesWithPoorCalls'],x['cellId'])
 )[:30]
 for date,rows in dayresults.items():
  output={'version':'radio-evidence-v1','date':date,'sourceRevision':MAN['meta']['revision'],
   'problem':'Only poor CDR calls (MOS<3). No per-call MOS degradation onset timestamp is verified.',
   'calls':rows}
  atomic_json(OUT/f'{date}.json',output)
 summary={
  'version':'radio-evidence-v1','sourceRevision':MAN['meta']['revision'],
  'sourceCdrFile':CDR.name,
  'mosPoorThreshold':3.0,'sourceMos':'SIP CDR RTCP MOS(v5), unchanged',
  'totalCdrCalls':len(calls),'poorCdrCalls':len(bad),
  'matchedMdtCdrCalls':MAN['meta']['coverage'].get('cdrMatched'),
  'poorByDate':{date:len(rows) for date,rows in dayresults.items()},
  'poorLocationEvidence':dict(source_types),'poorRadioMdtEvidence':dict(radio_sample_counts),
  'causeEvidenceTiers':dict(risk),'suspectObservationCounts':dict(evidence_reason_counts),
  'thresholdsFromGoodCallsDevelopmentDays':thresholds,
  'sourceMdtEventMosAudit':{
    'numericEvents':MDT_AUDIT['numeric_audit']['numeric_rtcp_mos'],
    'groupsWithMos':MDT_AUDIT['stats']['groups_with_mos'],
    'groupsWithDifferentMosValues':MDT_AUDIT['stats'].get('groups_with_multiple_mos_values',0),
    'segmentOnsetValidated':False,
    'why':'MDT rtcp_mos is repeated without intra-group change; no packet-level RTCP timestamp/interval semantics verified',
  },
  'requiredAdditionalEvidence':[
   'time-indexed original RTP/RTCP or RTCP XR records with codec/stream direction',
   'MDT/RRC handover/RLF/serving-neighbor cell timeline with trustworthy clock',
   'cell PRB load, interference and sector azimuth/tilt metadata',
   'independent same-area drive-test GNSS+radio+RTP records',
  ],
  'topByeCellInvestigationCandidates':candidates,
  'disclaimer':'Not a confirmed RF root cause or exact failure location. CDR/MOS are call-aggregate; GNSS age and BYE BTS are explicitly qualified.',
 }
 atomic_json(OUT/'summary.json',summary,pretty=True)
 print('EVIDENCE_SUMMARY',json.dumps({k:summary[k] for k in ['totalCdrCalls','poorCdrCalls','poorByDate','poorLocationEvidence','poorRadioMdtEvidence','causeEvidenceTiers','topByeCellInvestigationCandidates']},ensure_ascii=False)[:5000],flush=True)
 print('PUBLISHED',OUT,flush=True)

if __name__=='__main__':
 main()
