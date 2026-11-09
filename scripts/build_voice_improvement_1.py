"""Publish scoped investigation reports and an exact-condition index, separately."""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import os
import re

from voice_improvement_1 import build_report, canonical, scope_dates


def scope_key(scope, policy):
    return hashlib.sha256(canonical(dict(scope=scope,policy=policy)).encode()).hexdigest()[:20]


def coverage(calls, decisions):
    by_id={d['callId']:d for d in decisions}
    def counts(subset):
        evaluated=[c for c in subset if isinstance(c.get('mos'),(int,float)) and not isinstance(c.get('mos'),bool) and 1<=c['mos']<=5]
        linked=[c for c in evaluated if c['mdtLinkStatus']=='unique']
        accepted=[by_id[c['callId']] for c in linked if by_id[c['callId']]['status']=='accepted']
        g=sum(d['kind']=='gnss' for d in accepted); t=sum(d['kind']=='reviewed-radio' for d in accepted)
        return dict(N=len(subset),M=len(evaluated),D=len(linked),G=g,T=t,U=g+t)
    def ratios(c):
        return {f'{n}_{d}':dict(numerator=c[n],denominator=c[d],value=c[n]/c[d] if c[d] else None) for n,d in [('M','N'),('D','N'),('D','M'),('G','D'),('T','D'),('U','D'),('U','N')]}
    all_counts=counts(calls);poor=counts([c for c in calls if isinstance(c.get('mos'),(int,float)) and 1<=c['mos']<3])
    reasons=Counter(reason for d in decisions if d['status']=='excluded' for reason in set(d['reasons']))
    return dict(**all_counts,poor=poor,ratios=ratios(all_counts),poorRatios=ratios(poor),
                mdtAmbiguous=sum(c['mdtLinkStatus']=='ambiguous' for c in calls),mdtUnknown=sum(c['mdtLinkStatus']=='unknown' for c in calls),
                mosMissing=sum(c.get('mos') is None for c in calls),mosInvalid=sum(c.get('mos') is not None and not (isinstance(c['mos'],(int,float)) and 1<=c['mos']<=5) for c in calls),
                excludedReasons=dict(sorted(reasons.items())))


def _atomic_json(target, value):
    target.parent.mkdir(parents=True,exist_ok=True)
    temporary=target.with_name(target.name+f'.{os.getpid()}.tmp')
    try:
        temporary.write_text(json.dumps(value,ensure_ascii=False,separators=(',',':'),allow_nan=False),encoding='utf8')
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)


def publish_reports(document, out_dir, all_ranges=False):
    out_dir=Path(out_dir).resolve()
    if any(part in ('analyst-overview','improvement-candidates','voice-1030') for part in out_dir.parts) or out_dir.name=='public':
        raise ValueError('unsafe output overlaps original generated data')
    revision=document['sourceRevision']
    if not re.fullmatch(r'[A-Za-z0-9_-]+',revision):
        raise ValueError('unsafe revision output path')
    dates=scope_dates(document['scope'])
    if not set(dates)<=set(document['availableDates']):
        raise ValueError('missing source date partition')
    if not all_ranges and document['scopeKey']!=scope_key(document['scope'],document['policy']):
        raise ValueError('scope key does not match canonical analysis conditions')
    ranges=[dates[i:j] for i in range(len(dates)) for j in range(i+1,len(dates)+1)] if all_ranges else [dates]
    entries=[]
    for selected in ranges:
        scope=dict(document['scope'],dateStart=selected[0],dateEnd=selected[-1])
        if all_ranges:
            scope['mode']='holdout' if len(selected)>=3 else 'screening'
        scoped=dict(document,scope=scope,scopeKey=scope_key(scope,document['policy']))
        if all_ranges:
            scoped['calls']=[c for c in document['calls'] if c['date'] in selected]
            ids={c['callId'] for c in scoped['calls']}
            scoped['decisions']=[d for d in document['decisions'] if d['callId'] in ids]
            scoped['coverage']=coverage(scoped['calls'],scoped['decisions'])
        # Historical Cell references are only meaningful for their exact source/window.
        reference=document.get('publicationReference')
        if reference and not (scope['dateStart']==reference.get('dateStart') and scope['dateEnd']==reference.get('dateEnd') and scope['from']=='00:00' and scope['to']=='23:59' and scope['mode']=='holdout'):
            scoped['publicationReference']=None
        report=build_report(scoped)
        relative=f"{revision}/{scoped['scopeKey']}/report.json"
        _atomic_json(out_dir/relative,report)
        entries.append(dict(scopeKey=scoped['scopeKey'],scope=scope,policy=document['policy'],path=relative,
                            inputHash=document.get('inputHash',''),inventoryHash=document.get('inventoryHash',''),
                            canonicalScope=canonical(dict(scope=scope,policy=document['policy']))))
    index_path=out_dir/'index.json'
    available_dates=set(document['availableDates'])
    if index_path.exists():
        existing=json.loads(index_path.read_text('utf8'))
        if existing.get('schemaVersion')=='voice-improvement-1-index-v1' and existing.get('sourceRevision')==revision:
            available_dates.update(existing.get('availableDates',[]))
            new_keys={e['scopeKey'] for e in entries}
            entries += [e for e in existing['entries'] if e['scopeKey'] not in new_keys]
    entries.sort(key=lambda e:(e['scope']['dateStart'],e['scope']['dateEnd'],e['scope']['from'],e['scope']['to'],e['scope']['mode']))
    index=dict(schemaVersion='voice-improvement-1-index-v1',sourceRevision=revision,availableDates=sorted(available_dates),entries=entries)
    _atomic_json(index_path,index)
    return index


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input',type=Path,required=True)
    parser.add_argument('--out-dir',type=Path,default=Path(__file__).resolve().parents[1]/'public/voice-improvement-1')
    parser.add_argument('--all-ranges',action='store_true',help='Publish each contiguous date subrange using screening for 1-2 days and holdout for 3+ days')
    args=parser.parse_args()
    document=json.loads(args.input.read_text('utf8'))
    index=publish_reports(document,args.out_dir,args.all_ranges)
    print(json.dumps(dict(sourceRevision=index['sourceRevision'],reports=len(index['entries']),output=str(args.out_dir/'index.json'))))


if __name__=='__main__':
    main()
