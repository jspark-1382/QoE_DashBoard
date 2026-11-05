"""Read-only, PII-safe audit of original SIP CDR + MDT Excel and LTE station catalog.
Never export phone, IMSI, contract, SIP ID, or individual records.
"""
from __future__ import annotations
import json, math, collections, statistics, sys
from pathlib import Path
from datetime import datetime
from openpyxl import load_workbook

ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'outputs'/'radio-original-source-audit.json'
DATA=ROOT/'data'/'MDT_New'
INPUTS={
 'sip_cdr':next(DATA.glob('261026_1030_SIP_Call*.xlsx')),
 'mdt':next(DATA.glob('261026_1030_VoLTE+MDT*.xlsx')),
}
def valid(value):
 if value is None:return False
 if isinstance(value,str) and value.strip().upper() in ('','NULL','NAN','N/A','NONE','_','-'):return False
 if isinstance(value,float) and not math.isfinite(value):return False
 return True
def numerical(value):
 if not valid(value):return None
 try:
  v=float(value)
  return v if math.isfinite(v) else None
 except (ValueError,TypeError):return None
def scrub(d):
 return {str(k):int(v) for k,v in d.items()}
res={'analysis':'source-workbooks-not-derived-json','sources':{},'cdr':{},'mdt':{},'quality_gates':{}}
for kind,path in INPUTS.items():
 book=load_workbook(path,read_only=True,data_only=True,keep_links=False)
 sheet=book.active
 headers=next(sheet.iter_rows(min_row=1,max_row=1,values_only=True))
 index={str(v).strip():idx for idx,v in enumerate(headers) if v is not None}
 res['sources'][kind]={'file':path.name,'size_bytes':path.stat().st_size,'rows_including_header':sheet.max_row,'columns':len(headers),'sheet':sheet.title}
 if kind=='sip_cdr':
  keys={
   'start':'4. START TIME','end':'5. END TIME','duration':'6. CALL TIME(sec)',
   'mos':'140. RTCP MOS(v5)','rtcp_tx':'55. Audio Tx RTCP CNT','rtcp_rx':'56. Audio Rx RTCP CNT',
   'tx_jitter':'59. Audio Tx jitter','rx_jitter':'60. Audio Rx jitter',
   'tx_loss':'63. Audio Tx Packetloss','rx_loss':'64. Audio Rx Packetloss',
   'tx_rtt':'67. Audio Tx RTT','rx_rtt':'68. Audio Rx RTT',
   'tx_loss_cnt':'131. RTP Audio Tx Loss CNT','rx_loss_cnt':'132. RTP Audio Rx Loss CNT',
   'ho_flag':'107. HO Detect Flag > SMS Over IP Flag','start_cell':'74. User start CELL ID',
   'invite_cell':'139. INVITE CELL ID','bye_cell':'76. BYE CELL ID','bye200_cell':'75. BYE 200OK CELL ID',
   'sip_invite':'23. INVITE','sip_bye':'115. BYE REASON','sip_id':'16. SIP CALL ID',
   'customer':'E2. svc_cont_id','mdt_ue':'E1. MDT UE',
  }
 else:
  keys={
   'date':'base_date','event_at':'occ_dt','start_at':'svc_ctgry_st_ymd',
   'end_at':'svc_ctgry_fns_ymd','event_kind':'mdt_div',
   'rtcp_mos':'rtcp_mos','rsrp':'rsrp','rsrq':'rsrq','sinr':'nsinr',
   'gnss_x':'gnss_utmkx','gnss_y':'gnss_utmky','trigger':'trigr_ev',
   'report_type':'rpt_type','cell':'mdt_cell_id','site':'mdt_equip_cd',
   'pci':'pci','start_cell':'start_cell_id','end_cell':'fns_cell_id',
   'call_marker':'mdt_num','customer':'svc_cont_id','group_key':'lte_vc_div',
  }
 pos={key:index.get(column) for key,column in keys.items()}
 assert all(p is not None for p in pos.values()),{k:v for k,v in pos.items() if v is None}
 counts=collections.Counter()
 missing=collections.Counter()
 by_date=collections.Counter()
 kinds=collections.Counter()
 trigger=collections.Counter()
 mos_values=[]
 for row_num,row in enumerate(sheet.iter_rows(min_row=2,values_only=True),2):
  counts['rows']+=1
  for label,col in pos.items():
   if valid(row[col]):counts['valid_'+label]+=1
   else:missing[label]+=1
  if kind=='sip_cdr':
   dt=row[pos['start']]
   day=dt.date().isoformat() if isinstance(dt,datetime) else 'invalid'
   by_date[day]+=1
   mos=numerical(row[pos['mos']])
   if mos is not None and 1<=mos<=5:
    mos_values.append(mos)
    counts['poor' if mos<3 else 'fair' if mos<3.5 else 'good']+=1
    if valid(row[pos['tx_loss']]) or valid(row[pos['rx_loss']]):
     counts['scored_with_packet_loss']+=1
    if valid(row[pos['rtcp_tx']]) or valid(row[pos['rtcp_rx']]):
     counts['scored_with_rtcp_count']+=1
   else:counts['unscored']+=1
   if valid(row[pos['start_cell']]) and valid(row[pos['bye_cell']]):
    counts['both_start_bye_cell']+=1
   if not valid(row[pos['bye_cell']]) and valid(row[pos['bye200_cell']]):
    counts['bye200_fallback']+=1
  else:
   v=row[pos['date']]
   date=str(v).strip()
   by_date[date]+=1
   kindval=str(row[pos['event_kind']]).strip() if valid(row[pos['event_kind']]) else 'missing'
   kinds[kindval]+=1
   trigval=str(row[pos['trigger']]).strip() if valid(row[pos['trigger']]) else 'missing'
   trigger[trigval]+=1
   if valid(row[pos['gnss_x']]) and valid(row[pos['gnss_y']]):counts['gnss_both']+=1
   if numerical(row[pos['rtcp_mos']]) is not None:counts['numeric_rtcp_mos']+=1
   if numerical(row[pos['rsrp']]) is not None:counts['numeric_rsrp']+=1
   if numerical(row[pos['sinr']]) is not None:counts['numeric_sinr']+=1
  if row_num%75000==0:print(kind,'raw_rows_scanned',row_num-1,flush=True)
 result={
  'rows':counts['rows'],'fields_nonmissing':{k:counts['valid_'+k] for k in pos},
  'fields_missing':scrub(missing),'date_counts':scrub(by_date),'counters':scrub({k:v for k,v in counts.items() if not k.startswith('valid_')})
 }
 if kind=='sip_cdr':
  result['mos_stats']={'valid_rows':len(mos_values),'mean':round(statistics.fmean(mos_values),4) if mos_values else None}
 else:
  result['mdt_type_counts']=scrub(kinds)
  result['trigger_counts_top20']=scrub(dict(trigger.most_common(20)))
 res[kind]=result
 book.close()
 print('SOURCE_DONE',kind,'rows',result['rows'],'by_date',result['date_counts'],'nonmissing_mos',result['fields_nonmissing']['mos' if kind=='sip_cdr' else 'rtcp_mos'],flush=True)

res['quality_gates']={
 'cdr_mdt_join_requires_unique_contract_time':'not proven by original IDs; inspect existing audit',
 'rtcp_mos_per_segment':res['mdt']['fields_nonmissing']['rtcp_mos'],
 'rtcp_packet_captures_available':False,
 'original_rtp_per_packet_timestamps_available':False,
}
OUT.write_text(json.dumps(res,indent=2,ensure_ascii=False),encoding='utf8')
print('SAVED',OUT,flush=True)
