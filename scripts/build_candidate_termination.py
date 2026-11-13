#!/usr/bin/env python3
"""Extract original termination fields for every currently published candidate call.
No voice rebuild. Identity, physical row numbers, source ordering and cross-file
deduplication are delegated to the existing CDR parser. Source workbooks are read-only.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import uuid
from collections import Counter
import build_voice_1030 as voice

ROOT=Path(__file__).resolve().parent.parent
BASES=('quality-improvement','quality-improvement-full',
       'quality-improvement-mixed-evaluation','quality-improvement-mixed-full',
       'quality-models','quality-models-full','quality-models-mixed-evaluation','quality-models-mixed-full')

def field_presence(value):
    # Preserve raw sentinels in records, but never count them as acquired causes.
    return value is not None and str(value).strip().upper() not in {'','NULL','NONE','NAN','N/A','_'}

def add_target(targets,call):
    public_id=call.get('callId')
    date=call.get('date'); customer=call.get('customerId')
    if not isinstance(public_id,str) or not isinstance(customer,str) or not isinstance(date,str):
        raise ValueError('Published candidate call identity is incomplete')
    raw=call.get('rawCallId') or public_id.rsplit(':',1)[-1]
    if not isinstance(raw,str) or not raw.startswith('call-'):
        raise ValueError('Published candidate raw call identity is unavailable')
    record=dict(rawCallId=raw,customerId=customer,date=date)
    if public_id in targets and targets[public_id]!=record:
        raise ValueError('Conflicting published candidate call identity')
    targets[public_id]=record

def collect_public_targets(public_dir,revision):
    targets={}; artifacts={}; scopes=0; candidates=0; models=set()
    def read(path):
        path=path.resolve()
        if not path.is_relative_to(public_dir.resolve()): raise ValueError('Candidate artifact leaves public directory')
        raw=path.read_bytes()
        artifacts[path.relative_to(public_dir.resolve()).as_posix()]=dict(
            sha256=hashlib.sha256(raw).hexdigest(),bytes=len(raw))
        return json.loads(raw)
    for base in BASES:
        index_path=public_dir/base/'index.json'
        if not index_path.exists(): continue
        index=read(index_path)
        if index.get('sourceRevision')!=revision: raise ValueError('Published candidate index revision mismatch')
        for entry in index.get('entries',[]):
            scopes+=1
            report=read(public_dir/base/entry['path'])
            if base.startswith('quality-models'):
                if report.get('sourceRevision')!=revision: raise ValueError('Published model revision mismatch')
                for model_id,model in report.get('models',{}).items():
                    models.add(model_id)
                    for candidate in model.get('candidates',[]):
                        candidates+=1
                        for call in [*candidate.get('members',[]),*candidate.get('validationPoints',[])]: add_target(targets,call)
            else:
                if report.get('scope',{}).get('sourceRevision')!=revision: raise ValueError('Published candidate summary revision mismatch')
                models.add('dbscan')
                for card in report.get('candidates',[]):
                    candidates+=1
                    detail=read(public_dir/base/card['detailPath'])
                    if detail.get('scope',{}).get('sourceRevision')!=revision: raise ValueError('Published candidate detail revision mismatch')
                    # Include neighboring/control/validation calls exposed by the same
                    # detail, in addition to every discovery member.
                    for call in detail.get('calls',[]):
                        if call.get('sourceRevision')!=revision: raise ValueError('Published candidate call revision mismatch')
                        add_target(targets,call)
    if not targets: raise ValueError('No currently published candidate calls')
    coverage=dict(scope='published-candidate-call-union',indexBases=[b for b in BASES if (public_dir/b/'index.json').exists()],
        scopeEntries=scopes,candidateOccurrences=candidates,modelIds=sorted(models),
        dates=sorted({c['date'] for c in targets.values()}),targetCalls=len(targets),
        sourceArtifacts=[dict(file=p,**v) for p,v in sorted(artifacts.items())])
    return targets,coverage

def join_terminations(targets,source_calls):
    by_raw={}
    for call in source_calls:
        raw=call['id']
        if raw in by_raw: raise ValueError('Ambiguous original call identity; refusing first-match join')
        by_raw[raw]=call
    records={}; missing=0
    for public_id,target in sorted(targets.items()):
        call=by_raw.get(target['rawCallId'])
        if call is None: missing+=1; continue
        if (call['date'],call['customerId'])!=(target['date'],target['customerId']):
            raise ValueError('Original call date/customer does not match published identity')
        fields=call.get('termination',{})
        records[public_id]={key:fields.get(key) for key in voice.TERMINATION_COLUMNS}
    if missing: raise ValueError(f'{missing} published candidate calls missing from original sources')
    return records

def validate_published_targets(db,targets):
    for public_id,target in targets.items():
        db_id=public_id[11:] if public_id.startswith(target['date']+':') else public_id
        rows=db.execute('SELECT raw_id,customer_id,date FROM calls WHERE id=?',(db_id,)).fetchall()
        if len(rows)!=1 or tuple(rows[0])!=(target['rawCallId'],target['customerId'],target['date']):
            raise ValueError('Candidate call is not an exact current published database identity')

def atomic_json(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    pending=path.with_name('.'+path.name+'.'+uuid.uuid4().hex+'.tmp')
    try:
        pending.write_text(json.dumps(value,ensure_ascii=False,separators=(',',':'),allow_nan=False),encoding='utf8')
        os.replace(pending,path)
    finally:
        if pending.exists(): pending.unlink()

def build(root=ROOT,public_dir=None):
    public=Path(public_dir) if public_dir is not None else root/'public'
    index=json.loads((public/'voice-query-index.json').read_text(encoding='utf8'))
    revision=index['sourceRevision']
    database=(root/index['database']).resolve()
    if not database.is_relative_to(root.resolve()): raise ValueError('Database path leaves workspace')
    with sqlite3.connect(database.as_uri()+'?mode=ro',uri=True) as db:
        db.execute('PRAGMA query_only=ON')
        meta=json.loads(db.execute("SELECT json FROM meta WHERE key='dataset'").fetchone()[0])
        if meta.get('revision')!=revision: raise ValueError('Published dataset revision mismatch')
        targets,coverage=collect_public_targets(public,revision)
        validate_published_targets(db,targets)
    wanted={c['rawCallId'] for c in targets.values()}
    print(json.dumps(dict(phase='targets-verified',calls=len(targets),rawCalls=len(wanted),scopeEntries=coverage['scopeEntries'])),flush=True)
    source_audit=meta.get('sourceWorkbookAudit',{}).get('cdr')
    if not source_audit: raise ValueError('Published CDR source ordering/provenance is missing')
    source_calls=[]; sources=[]; seen={}
    for index,original in enumerate(source_audit):
        name=original['file']
        if Path(name).name!=name: raise ValueError('Invalid published CDR source name')
        path=root/'data'/'MDT_New'/name
        if path.stat().st_size!=original['bytes']: raise ValueError('CDR source size changed since publication')
        print(json.dumps(dict(phase='read-original-termination',file=name),ensure_ascii=False),flush=True)
        calls,audit=voice.read_cdr(path,'all',seen=seen,identity_source=name if index else None,wanted_ids=wanted)
        if audit['inputRows']!=original['inputRows']: raise ValueError('CDR source row count changed since publication')
        source_calls.extend(calls)
        sources.append(dict(file=name,sha256=voice.file_sha256(path),bytes=path.stat().st_size,
            sourceRows=audit['inputRows'],selectedCalls=len(calls),
            crossFileDuplicateRows=audit['excludedCrossFileDuplicates']))
        print(json.dumps(dict(phase='source-complete',selectedCalls=len(calls),sourceRows=audit['inputRows'])),flush=True)
    records=join_terminations(targets,source_calls)
    coverage.update(coveredCalls=len(records),rawCalls=len(wanted),missingCalls=0,ambiguousCalls=0,
        fieldAvailable={key:sum(field_presence(r[key]) for r in records.values()) for key in voice.TERMINATION_COLUMNS})
    return dict(schemaVersion='qoe-candidate-termination-v1',sourceRevision=revision,
        sources=sources,coverage=coverage,records=records)

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--root',type=Path,default=ROOT)
    parser.add_argument('--public-dir',type=Path)
    parser.add_argument('--out',type=Path)
    args=parser.parse_args()
    args.out=args.out or (args.public_dir or args.root/'public')/'quality-improvement/candidate-termination-v1.json'
    result=build(args.root,args.public_dir)
    atomic_json(args.out,result)
    print(json.dumps(dict(phase='complete',records=len(result['records']),sources=len(result['sources']),
                         outputBytes=args.out.stat().st_size)),flush=True)

if __name__=='__main__': main()
