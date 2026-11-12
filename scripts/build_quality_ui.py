"""Build complete day evidence and compact date-range reports with bounded memory.

Single-day reports retain every original CDR for the exporter's census proof.
Multi-day reports retain linked/ambiguous evidence; coverage is summed from the
complete day censuses. Thus an area-wide CDR expansion does not duplicate every
unmatched call into all fifteen date-range reports.
"""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
import subprocess

from build_voice_improvement_1 import publish_reports, scope_key

ROOT = Path(__file__).resolve().parents[1]
COUNTS = ('N', 'M', 'D', 'G', 'T', 'U')


def merge_coverage(coverages):
    def counts(rows):
        return {key: sum(row[key] for row in rows) for key in COUNTS}

    def ratios(row):
        return {f'{n}_{d}': {'numerator': row[n], 'denominator': row[d],
                              'value': row[n]/row[d] if row[d] else None}
                for n, d in [('M', 'N'), ('D', 'N'), ('D', 'M'), ('G', 'D'),
                             ('T', 'D'), ('U', 'D'), ('U', 'N')]}

    total, poor = counts(coverages), counts([c['poor'] for c in coverages])
    reasons = Counter()
    for item in coverages:
        reasons.update(item['excludedReasons'])
    return {**total, 'poor': poor, 'ratios': ratios(total), 'poorRatios': ratios(poor),
            **{key: sum(c[key] for c in coverages)
               for key in ('mdtAmbiguous', 'mdtUnknown', 'mosMissing', 'mosInvalid')},
            'excludedReasons': dict(reasons)}


def sparse_document(document):
    ids = {c['callId'] for c in document['calls']}
    decision_ids = {d['callId'] for d in document['decisions']}
    if (len(ids) != len(document['calls']) or len(decision_ids) != len(document['decisions'])
            or ids != decision_ids or len(ids) != document['coverage']['N']):
        raise ValueError('Incomplete original day census')
    retained = [c for c in document['calls'] if c['mdtLinkStatus'] != 'none']
    retained_ids = {c['callId'] for c in retained}
    # Original per-partition hashes are retained in the full single-day report.
    # The compact range references its verified full-day input hash instead.
    files = [f for f in document['inputFiles'] if not f['file'].startswith('voice-1030-data/')]
    return {**document, 'calls': retained,
            'decisions': [d for d in document['decisions'] if d['callId'] in retained_ids],
            'inputFiles': files,
            'provenance': {**{k: v for k, v in document['provenance'].items() if k != 'inputFiles'},
                           'inputFiles': files, 'fullDayInputHash': document['inputHash']}}


def build(public_dir, work_dir, reuse_cache=True):
    manifest = json.loads((public_dir/'voice-1030.json').read_text(encoding='utf-8'))
    revision, dates = manifest['meta']['revision'], sorted(manifest['meta']['dates'])
    del manifest
    env = {**os.environ, 'QOE_PUBLIC_DIR': str(public_dir), 'NODE_OPTIONS': '--max-old-space-size=8192'}
    reports = public_dir/'voice-improvement-1'
    work_dir.mkdir(parents=True, exist_ok=True)
    documents = {}
    for date in dates:
        cache = work_dir/(revision+'-'+date+'.json')
        document = None
        if reuse_cache and cache.is_file():
            try:
                cached = json.loads(cache.read_text(encoding='utf-8'))
            except (ValueError, OSError):
                cached = {}
            if cached.get('sourceRevision') == revision and (reports/revision/cached.get('scopeKey', '')/'report.json').is_file():
                document = cached
        if document is None:
            subprocess.run(['node', str(ROOT/'scripts/build-voice-improvement-1-input.cjs'),
                            '--public-dir', str(public_dir), '--date-start', date, '--date-end', date,
                            '--mode', 'screening', '--out-dir', str(work_dir)],
                           cwd=ROOT, env=env, check=True)
            original = json.loads((work_dir/'input.json').read_text(encoding='utf-8'))
            if original['sourceRevision'] != revision:
                raise ValueError('Source revision changed while building evidence')
            publish_reports(original, reports, False)
            document = sparse_document(original)
            del original
            temporary = cache.with_suffix('.tmp')
            temporary.write_text(json.dumps(document, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
            os.replace(temporary, cache)
        documents[date] = document
        print(json.dumps({'phase': 'quality-day', 'date': date, 'totalCalls': document['coverage']['N'],
                          'linkedEvidence': len(document['calls'])}), flush=True)
    for start in range(len(dates)):
        for end in range(start+1, len(dates)):
            selected = dates[start:end+1]
            originals = [documents[d] for d in selected]
            first = originals[0]
            scope = {**first['scope'], 'dateStart': selected[0], 'dateEnd': selected[-1],
                     'mode': 'holdout' if len(selected) >= 3 else 'screening'}
            input_hashes = [{'date': d, 'inputHash': documents[d]['inputHash']} for d in selected]
            digest = hashlib.sha256(json.dumps(input_hashes, sort_keys=True).encode()).hexdigest()
            files = {f['file']: f for original in originals for f in original['inputFiles']}
            document = {**first, 'scope': scope, 'scopeKey': scope_key(scope, first['policy']),
                        'calls': [c for original in originals for c in original['calls']],
                        'decisions': [d for original in originals for d in original['decisions']],
                        'coverage': merge_coverage([o['coverage'] for o in originals]),
                        'inputHash': digest, 'inputFiles': list(files.values()),
                        'provenance': {'completeDayCensuses': input_hashes, 'inputHash': digest,
                                       'inventoryHash': first['inventoryHash'], 'inputFiles': list(files.values())},
                        'publicationReference': None}
            publish_reports(document, reports, False)
            print(json.dumps({'phase': 'quality-range', 'start': selected[0], 'end': selected[-1],
                              'totalCalls': document['coverage']['N'], 'linkedEvidence': len(document['calls'])}), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--public-dir', type=Path, default=Path(os.environ.get('QOE_PUBLIC_DIR', ROOT/'public')))
    parser.add_argument('--work-dir', type=Path, default=ROOT/'outputs/quality-ui-input')
    parser.add_argument('--reuse-cache', action='store_true')
    args = parser.parse_args()
    build(args.public_dir.resolve(), args.work_dir.resolve(), args.reuse_cache)
