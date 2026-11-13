#!/usr/bin/env python3
"""Read-only, two-source 25 m background MDT overlay and dated analysis.
P is the reported RSRP mean; Y is the distinct SUM/CNT mean. Neither is
substituted for the other. O is the only supplied aggregate denominator.
"""
from __future__ import annotations
from collections import Counter
from datetime import datetime
from pathlib import Path
import argparse
import hashlib
import json
import math
import os
import uuid
import re
import statistics
import xml.etree.ElementTree as ET
import zipfile

ROOT=Path(__file__).resolve().parent.parent
SOURCE=ROOT/'data'/'25격자'/'개포동 MDT.xlsx'
SOURCES=(SOURCE,ROOT/'data'/'25격자'/'개포동제외 나머지_MDT.xlsx')
TARGET=ROOT/'public'/'quality-improvement'/'mdt-grid-25m-v1.json'
NS='{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
BANDS={'475':'2.1','1550':'1.8광','1694':'1.8협','3743':'900'}
METRICS={'rsrpMean':'P','rsrqMean':'Q','phrMean':'R','rsrpMeanSumCnt':'Y'}
THRESHOLDS={'-85':'V','-90':'W','-95':'X','-100':'S','-105':'T','-110':'U'}
HEADERS={'A':'기간_일','E':'POT_GPOT ID','F':'POT_중점 UTMK X','G':'POT_중점 UTMK Y',
         'H':'POT_중점 LATITUDE','I':'POT_중점 LONGITUDE','M':'Network_LTE BAND',
         'N':'Network_LTE EARFCN','O':'LTE_MDT_측정 수','P':'LTE_MDT_RSRP 평균@',
         'Q':'LTE_MDT_RSRQ 평균','R':'LTE_MDT_PHR 평균','Y':'LTE_MDT_RSRP 평균(SUM/CNT)'}
HEADERS.update({col:'LTE_MDT_RSRP '+key+'dBm 이하 불량률(SUM/CNT)' for key,col in THRESHOLDS.items()})
MISSING={'','_','NULL','NAN','NONE','N/A'}

def read_source(path:Path=SOURCE):
    with zipfile.ZipFile(path) as archive:
        strings=[]
        if 'xl/sharedStrings.xml' in archive.namelist():
            with archive.open('xl/sharedStrings.xml') as handle:
                for _,node in ET.iterparse(handle,events=('end',)):
                    if node.tag==NS+'si':
                        strings.append(''.join(part.text or '' for part in node.iter(NS+'t')))
                        node.clear()
        sheets=[n for n in archive.namelist() if re.fullmatch(r'xl/worksheets/(?:worksheet|sheet)1.xml',n)]
        if len(sheets)!=1: raise ValueError(f'{path.name}: unsupported first worksheet layout')
        header_seen=False
        with archive.open(sheets[0]) as handle:
            for _,row in ET.iterparse(handle,events=('end',)):
                if row.tag!=NS+'row': continue
                line=int(row.attrib.get('r',0))
                if line<3: row.clear(); continue
                result={}
                for item in row.findall(NS+'c'):
                    val=item.find(NS+'v')
                    raw=val.text if val is not None else None
                    if raw is not None and item.attrib.get('t')=='s': raw=strings[int(raw)]
                    elif item.attrib.get('t')=='inlineStr': raw=''.join(t.text or '' for t in item.iter(NS+'t'))
                    if raw is not None:
                        label=re.match('[A-Z]+',item.attrib.get('r',''))
                        if label: result[label.group()]=raw
                row.clear()
                if line==3:
                    invalid=[col for col,text in HEADERS.items() if text not in result.get(col,'')]
                    if invalid: raise ValueError(f'{path.name}: unexpected source headers: {invalid}')
                    header_seen=True
                    continue
                if not header_seen: raise ValueError(f'{path.name}: missing header row')
                if result: yield result

def number(value,*,required=False):
    if value is None or str(value).strip().upper() in MISSING:
        if required: raise ValueError('Required metric missing')
        return None
    n=float(value)
    if not math.isfinite(n): raise ValueError('Non-finite metric')
    return n

def merge_sources(sources):
    """Merge by exact date/POT/EARFCN; refuse conflicting original rows."""
    collected={}; seen={}; dates=set(); audits=[]; raw_count=0; measurements=0
    for file,rows in sources:
        audit=dict(file=file,sourceRows=0,acceptedRows=0,duplicateRows=0)
        audits.append(audit)
        for row in rows:
            audit['sourceRows']+=1; raw_count+=1
            try:
                date=datetime.strptime(str(row['A']),'%Y%m%d').date().isoformat()
                pot=str(row['E'])
                x,y,lat,lon=(number(row[k],required=True) for k in ('F','G','H','I'))
                count_number=number(row['O'],required=True)
                count=int(count_number)
                earfcn=re.match(r'^\d+',str(row['N'])).group()
                band=BANDS[earfcn]
                values={key:number(row.get(col),required=key=='rsrpMean') for key,col in METRICS.items()}
                below={key:number(row.get(col)) for key,col in THRESHOLDS.items()}
                if (not pot or count!=count_number or count<=0 or
                    not(36<lat<39 and 125<lon<130 and -150<=values['rsrpMean']<=-40) or
                    any(v is not None and not 0<=v<=100 for v in below.values())):
                    raise ValueError('Out-of-range coordinate, count or metric')
            except (KeyError,ValueError,AttributeError,OverflowError) as exc:
                raise ValueError(f'{file}: invalid source row {audit["sourceRows"]}: {type(exc).__name__}') from exc
            dates.add(date)
            key=(date,pot,earfcn)
            signature=tuple(sorted((k,str(v)) for k,v in row.items() if v is not None and str(v)!=''))
            if key in seen:
                previous,analysis=seen[key]
                if signature!=previous: raise ValueError(f'Conflicting duplicate date/POT/EARFCN in {file}')
                audit['duplicateRows']+=1
                if file not in analysis['sourceFiles']: analysis['sourceFiles'].append(file)
                continue
            item=collected.setdefault(pot,dict(pot=pot,x=x,y=y,lat=round(lat,10),lon=round(lon,10),analysis=[]))
            if (item['x'],item['y'],item['lat'],item['lon'])!=(x,y,round(lat,10),round(lon,10)):
                raise ValueError('Conflicting center coordinates for POT')
            analysis=dict(date=date,band=band,earfcn=earfcn,samples=count,**values,belowPct=below,
                metricSamples={**{k:count if v is not None else 0 for k,v in values.items()},
                               **{k:count if v is not None else 0 for k,v in below.items()}},
                sourceFiles=[file])
            item['analysis'].append(analysis); seen[key]=(signature,analysis)
            audit['acceptedRows']+=1; measurements+=count
    if not collected: raise ValueError('Empty 25 m grid dataset')
    # Display one explicit latest date per POT; analysis never blends dates.
    records=[]
    for item in sorted(collected.values(),key=lambda c:(c['x'],c['y'],c['pot'])):
        item['analysis'].sort(key=lambda a:(a['date'],a['band'],a['earfcn']))
        display_date=max(a['date'] for a in item['analysis'])
        groups={}
        for a in item['analysis']:
            if a['date']!=display_date: continue
            n,s=groups.setdefault(a['band'],[0,0.0]); groups[a['band']]=[n+a['samples'],s+a['rsrpMean']*a['samples']]
        total=sum(n for n,s in groups.values())
        item.update(rsrp=round(sum(s for n,s in groups.values())/total,2),samples=total,
            bands={band:[round(s/n,2),n] for band,(n,s) in sorted(groups.items())},displayDate=display_date)
        records.append(item)
    return dict(schemaVersion='mdt-25m-rsrp-grid-v1',analysisSchemaVersion='mdt-grid-analysis-v1',
        source='; '.join(a['file'] for a in audits),sourceDate=max(dates),sourceDates=sorted(dates),sources=audits,
        cellSizeM=25,statistic='LTE_MDT_RSRP 평균(P), LTE_MDT_측정 수(O) 가중; 날짜별 원본 보존',
        metricWeightBasis='O: LTE_MDT_측정 수; 별도 지표별 유효 분모는 원본 미제공',
        referenceOnly=True,gridCells=len(records),sourceRows=raw_count,measurements=measurements,records=records)

def grid_basis(records):
    centers={(v['x'],v['y']):v for v in records}
    x_diffs=[]; y_diffs=[]
    for (x,y),v in centers.items():
        east=centers.get((x+25,y)); north=centers.get((x,y+25))
        if east: x_diffs.append(((east['lat']-v['lat'])/25,(east['lon']-v['lon'])/25))
        if north: y_diffs.append(((north['lat']-v['lat'])/25,(north['lon']-v['lon'])/25))
    if len(x_diffs)<100 or len(y_diffs)<100: raise ValueError('Not enough 25 m neighbors to estimate grid-axis directions')
    return dict(latPerX=statistics.mean(a for a,b in x_diffs),lonPerX=statistics.mean(b for a,b in x_diffs),
                latPerY=statistics.mean(a for a,b in y_diffs),lonPerY=statistics.mean(b for a,b in y_diffs))

def input_signature(paths=None):
    digest=hashlib.sha256(Path(__file__).read_bytes())
    for path in sorted(map(Path,SOURCES if paths is None else paths),key=lambda p:p.name):
        digest.update(path.name.encode('utf8'))
        with path.open('rb') as source:
            for piece in iter(lambda:source.read(1024*1024),b''): digest.update(piece)
    return digest.hexdigest()

def build(path=None):
    paths=SOURCES if path is None else (path,) if isinstance(path,(str,Path)) else path
    sources=[]
    for p in map(Path,paths):
        try: name=p.relative_to(ROOT).as_posix()
        except ValueError: name=p.name
        sources.append((name,read_source(p)))
    result=merge_sources(sources)
    result['basisPerMeter']=grid_basis(result['records'])
    result['inputSignature']=input_signature(paths)
    return result

def display_grid(enriched):
    # Browsers fetch only the map data. The full dated evidence is server-read.
    result={k:v for k,v in enriched.items() if k not in ('records','analysisSchemaVersion','metricWeightBasis')}
    result['analysisSource']='quality-improvement/mdt-grid-analysis-v1.json'
    result['records']=[{k:v for k,v in c.items() if k!='analysis'} for c in enriched['records']]
    return result

def atomic_json(path,data):
    path.parent.mkdir(parents=True,exist_ok=True)
    pending=path.with_name('.'+path.name+'.'+uuid.uuid4().hex+'.tmp')
    try:
        pending.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'),allow_nan=False),encoding='utf-8')
        os.replace(pending,path)
    finally:
        if pending.exists(): pending.unlink()

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--source',type=Path,action='append')
    parser.add_argument('--out',type=Path,default=TARGET)
    parser.add_argument('--analysis-out',type=Path)
    args=parser.parse_args()
    grid=build(args.source)
    analysis_out=args.analysis_out or args.out.with_name('mdt-grid-analysis-v1.json')
    if analysis_out.resolve()==args.out.resolve(): raise ValueError('Display and analysis outputs must be distinct')
    atomic_json(analysis_out,grid)
    atomic_json(args.out,display_grid(grid))
    print(json.dumps({k:v for k,v in grid.items() if k!='records'},ensure_ascii=False,indent=2))
    print('OUTPUT',args.out,'SIZE',args.out.stat().st_size,'BYTES')
