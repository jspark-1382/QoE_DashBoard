#!/usr/bin/env python3
"""Build a display-only 25 m MDT RSRP reference overlay from data/25격자/개포동 MDT.xlsx.

No Excel changes. Use only standard-library XLSX (ZIP/OpenXML) streaming.
POT_중점 UTMK X/Y provide authoritative 25 m center spacing.
LTE_MDT_RSRP 평균 (P) is weighted by LTE_MDT_측정 수 (O), across observed bands.
"""
from __future__ import annotations
from collections import defaultdict, Counter
from datetime import datetime
from pathlib import Path
import json
import math
import re
import statistics
import xml.etree.ElementTree as ET
import zipfile

ROOT=Path(__file__).resolve().parent.parent
SOURCE=ROOT/'data'/'25격자'/'개포동 MDT.xlsx'
TARGET=ROOT/'public'/'quality-improvement'/'mdt-grid-25m-v1.json'
NS='{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
BANDS={
 '475':'2.1',
 '1550':'1.8광',
 '1694':'1.8협',
 '3743':'900',
}

def read_source(path:Path=SOURCE):
    with zipfile.ZipFile(path) as z:
        strings=[]
        with z.open('xl/sharedStrings.xml') as handle:
            for _,node in ET.iterparse(handle,events=('end',)):
                if node.tag==NS+'si':
                    strings.append(''.join(part.text or '' for part in node.iter(NS+'t')))
                    node.clear()
        headers=None
        with z.open('xl/worksheets/worksheet1.xml') as handle:
            for _,row in ET.iterparse(handle,events=('end',)):
                if row.tag!=NS+'row':continue
                line=int(row.attrib.get('r',0))
                if line<3:row.clear();continue
                result={}
                for item in row.findall(NS+'c'):
                    val=item.find(NS+'v')
                    raw=val.text if val is not None else None
                    if raw is not None and item.attrib.get('t')=='s':raw=strings[int(raw)]
                    elif item.attrib.get('t')=='inlineStr':raw=''.join(t.text or '' for t in item.iter(NS+'t'))
                    if raw is not None:
                        label=re.match('[A-Z]+',item.attrib.get('r',''))
                        if label:result[label.group()]=raw
                row.clear()
                if line==3:
                    headers=result
                    assert 'POT_중점 UTMK X' in headers.get('F',''),headers
                    assert 'POT_중점 LATITUDE' in headers.get('H',''),headers
                    assert 'LTE_MDT_RSRP 평균' in headers.get('P',''),headers
                    continue
                yield result

def build(path:Path=SOURCE):
    collected={}; dates=Counter(); skipped=0; measurements=0; raw_count=0
    for row in read_source(path):
        raw_count+=1
        try:
            date=str(row['A'])
            grid_id=row['E']
            x,y,lat,lon=(float(row[k]) for k in ('F','G','H','I'))
            count=int(float(row['O']))
            mean=float(row['P'])
            earfcn=re.match(r'\d+',row['N']).group()
            band=BANDS[earfcn]
            if not (36.0<lat<39.0 and 125.0<lon<130.0 and -150.0<=mean<=-40.0 and count>0):
                skipped+=1;continue
        except (KeyError,ValueError,AttributeError,OverflowError):
            skipped+=1;continue
        dates[date]+=1
        if grid_id not in collected:
            collected[grid_id]=dict(x=x,y=y,lat=lat,lon=lon,total=0,sum=0.0,bands={})
        item=collected[grid_id]
        if (item['x'],item['y'],item['lat'],item['lon'])!=(x,y,lat,lon):
            raise ValueError(f'Conflicting center coordinates for {grid_id}')
        item['total']+=count
        item['sum']+=count*mean
        band_stats=item['bands'].setdefault(band,[0,0.0])
        band_stats[0]+=count
        band_stats[1]+=count*mean
        measurements+=count
    if not collected or len(dates)!=1:
        raise ValueError(f'Expected a single-day nonempty 25 m grid dataset; dates={dates}')
    if skipped:
        raise ValueError(f'{skipped} invalid source rows: do not silently lose data')
    centers={(v['x'],v['y']):v for v in collected.values()}
    x_diffs=[];y_diffs=[]
    for (x,y),v in centers.items():
        east=centers.get((x+25,y))
        north=centers.get((x,y+25))
        if east:x_diffs.append(((east['lat']-v['lat'])/25,(east['lon']-v['lon'])/25))
        if north:y_diffs.append(((north['lat']-v['lat'])/25,(north['lon']-v['lon'])/25))
    if len(x_diffs)<100 or len(y_diffs)<100:raise ValueError('Not enough 25 m neighbors to estimate grid-axis directions')
    basis=dict(
      latPerX=statistics.mean(a for a,b in x_diffs),
      lonPerX=statistics.mean(b for a,b in x_diffs),
      latPerY=statistics.mean(a for a,b in y_diffs),
      lonPerY=statistics.mean(b for a,b in y_diffs),
    )
    records=[]
    for name,item in sorted(collected.items(),key=lambda pair:(pair[1]['x'],pair[1]['y'])):
        n=item['total']
        bands={label:[round(s/count,2),count] for label,(count,s) in sorted(item['bands'].items())}
        records.append(dict(
          pot=name,x=item['x'],y=item['y'],
          lat=round(item['lat'],10),lon=round(item['lon'],10),
          rsrp=round(item['sum']/n,2),samples=n,
          bands=bands,
        ))
    result=dict(
      schemaVersion='mdt-25m-rsrp-grid-v1',
      source='data/25격자/개포동 MDT.xlsx',
      sourceDate=datetime.strptime(next(iter(dates)),'%Y%m%d').strftime('%Y-%m-%d'),
      cellSizeM=25,
      statistic='LTE_MDT_RSRP 평균, LTE_MDT_측정 수 가중평균(주파수별 집계 교차)',
      referenceOnly=True,
      gridCells=len(records),sourceRows=raw_count,measurements=measurements,
      basisPerMeter=basis,
      records=records,
    )
    return result

if __name__=='__main__':
    grid=build()
    TARGET.parent.mkdir(parents=True,exist_ok=True)
    TARGET.write_text(json.dumps(grid,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    print(json.dumps({k:v for k,v in grid.items() if k not in ('records',)},ensure_ascii=False,indent=2))
    print('OUTPUT',TARGET,'SIZE',TARGET.stat().st_size,'BYTES')
