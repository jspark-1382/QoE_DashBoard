"""Rebuild all revision-bound voice UI assets in staging, validate, then publish locally."""
from __future__ import annotations

import argparse
from datetime import datetime
import json
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
INDEX_DIRS = ('quality-improvement', 'quality-improvement-full', 'quality-models',
              'quality-models-full', 'quality-improvement-mixed-full',
              'quality-improvement-mixed-evaluation', 'quality-models-mixed-full',
              'quality-models-mixed-evaluation', 'voice-improvement-1')


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def query_ready(public, revision, root=ROOT):
    """A cached source publication also needs its matching local query store."""
    try:
        index = read(public/'voice-query-index.json')
        database = (root/index['database']).resolve()
        allowed = (root/'outputs/voice-query-data').resolve()
        return (index.get('schemaVersion') == 'voice-query-index-v1'
                and index.get('databaseSchema') == 'voice-query-db-v1'
                and index.get('sourceRevision') == revision
                and database.is_relative_to(allowed) and database.suffix == '.sqlite'
                and database.is_file())
    except (OSError, KeyError, TypeError, ValueError):
        return False


def inputs_signature():
    from build_voice_1030 import discover_sources
    cdr, mdt = discover_sources(ROOT/'data/MDT_New')
    paths = [*cdr, *mdt]
    for directory in (ROOT/'data/BaseStation', ROOT/'data/행정동경계'):
        paths.extend(p for p in directory.iterdir() if p.is_file() and not p.name.startswith('~$'))
    # Query-service and client transport changes do not change source artifacts.
    # Their read model has its own version/fingerprint and readiness check.
    paths.extend(p for p in (ROOT/'scripts').iterdir()
                 if p.suffix in ('.py', '.cjs') and not p.name.startswith(('test_', 'test-', 'voice-query-'))
                 and p.name != 'build_voice_query_db.py')
    paths.extend(p for p in (ROOT/'lib').rglob('*.ts')
                 if not p.name.startswith(('server-', 'use-'))
                 and p.name not in ('screening-query.ts', 'candidate-resource-cache.ts'))
    digest = hashlib.sha256()
    for variable in ('QOE_LTE_MASTER', 'QOE_NR_MASTER'):
        selected = os.environ.get(variable, '')
        digest.update(json.dumps([variable, selected]).encode('utf-8'))
        if selected:
            paths.append(Path(selected).resolve())
    for path in sorted(set(paths)):
        digest.update(str(path.relative_to(ROOT) if path.is_relative_to(ROOT) else path).encode('utf-8'))
        with path.open('rb') as source:
            for piece in iter(lambda: source.read(4*1024*1024), b''):
                digest.update(piece)
    return digest.hexdigest()


def validate(public):
    manifest = read(public/'voice-1030.json')
    revision = manifest['meta']['revision']
    total = manifest['meta']['totalCalls']
    assert sum(d['callCount'] for d in manifest['days']) == total
    source_audit = manifest['meta']['sourceWorkbookAudit']
    assert len(manifest['meta']['sourceFiles']) == len(source_audit['cdr']) + len(source_audit['mdt'])
    assert sum(s['publishedCalls'] for s in source_audit['cdr']) == total
    overview_total = 0
    for date in manifest['meta']['dates']:
        overview = read(public/'analyst-overview/MDT'/(date+'.json'))
        assert overview['sourceRevision'] == revision
        assert len(overview['calls']) == sum(d['callCount'] for d in manifest['days'] if d['date'] == date)
        overview_total += len(overview['calls'])
        del overview
        for folder in ('gps-map-stations', 'three-site-rough'):
            assert read(public/folder/(date+'.json'))['sourceRevision'] == revision
    assert overview_total == total
    for folder in INDEX_DIRS:
        assert read(public/folder/'index.json')['sourceRevision'] == revision, folder
    for filename in ('gps-marker-rf-v1.json', 'candidate-mdt-rsrp-v1.json'):
        assert read(public/'quality-improvement'/filename)['sourceRevision'] == revision
    screening = read(public/'customer-screening-data/2026-10-26_2026-10-30.json')
    assert screening['sourceRevision'] == revision
    assert screening['audit']['calls'] == total
    assert screening['audit']['customers'] == len(manifest['customers'])
    return {'revision': revision, 'sourceFiles': len(manifest['meta']['sourceFiles']),
            'calls': total, 'customers': len(manifest['customers']), 'screeningAudit': screening['audit']}


def promote(stage, public, backup):
    stage, public, backup = (p.resolve() for p in (stage, public, backup))
    if any(a == b or a in b.parents or b in a.parents
           for a, b in ((stage, public), (stage, backup), (public, backup))):
        raise ValueError('Stage, public and backup must be separate directories')
    changed = []

    def transfer(source, destination):
        if not source.resolve().is_relative_to(stage) or not destination.resolve().is_relative_to(public):
            raise ValueError('Publication path escapes intended directories')
        if source.is_symlink() or destination.is_symlink():
            raise ValueError('Refusing publication through symlinks')
        destination.parent.mkdir(parents=True, exist_ok=True)
        if source.is_dir():
            if not destination.exists():
                source.rename(destination)
            else:
                for item in sorted(source.iterdir()):
                    transfer(item, destination/item.name)
        else:
            previous = backup/destination.relative_to(public)
            if destination.exists():
                previous.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(destination, previous)
            changed.append((destination, previous if destination.exists() else None))
            os.replace(source, destination)

    try:
        # Manifest commits last, after all source partitions and derived assets exist.
        for item in sorted(stage.iterdir(), key=lambda p: (p.name == 'voice-1030.json', p.name)):
            transfer(item, public/item.name)
    except BaseException:
        for destination, previous in reversed(changed):
            if previous is not None:
                shutil.copy2(previous, destination)
        raise


def build(work, skip_source=False, resume=False):
    signature = inputs_signature()
    current = ROOT/'outputs/voice-ui-current.json'
    if not skip_source and current.is_file():
        saved = read(current)
        live = ROOT/'public/voice-1030.json'
        if saved.get('pipelineSignature') == signature and live.is_file():
            manifest = read(live)
            if manifest['meta']['revision'] == saved['revision'] and all(
                    (ROOT/'public'/folder/'index.json').is_file() and
                    read(ROOT/'public'/folder/'index.json')['sourceRevision'] == saved['revision']
                    for folder in INDEX_DIRS):
                # The query builder has its own bounded freshness check. This also
                # upgrades an existing source publication without rereading XLSX.
                subprocess.run([sys.executable, '-B', 'scripts/build_voice_query_db.py',
                                '--root-dir', str(ROOT)], cwd=ROOT, check=True)
                if not query_ready(ROOT/'public', saved['revision']):
                    raise ValueError('Voice query store does not match the published source')
                print(json.dumps({'phase': 'already-current', **saved}, ensure_ascii=False), flush=True)
                return
    public = work/'public'
    public.mkdir(parents=True, exist_ok=True)
    env = {**os.environ, 'QOE_PUBLIC_DIR': str(public), 'NODE_OPTIONS': '--max-old-space-size=8192',
           'PYTHONUNBUFFERED': '1'}

    def run(args):
        print(json.dumps({'phase': 'run', 'command': args}, ensure_ascii=False), flush=True)
        subprocess.run(args, cwd=ROOT, env=env, check=True)

    if not skip_source:
        run([sys.executable, '-B', 'scripts/build_voice_1030.py', '--out', str(public/'voice-1030.json'),
             '--audit', str(work/'source-audit.json')])
    revision = read(public/'voice-1030.json')['meta']['revision']
    checkpoint = work/'steps.json'
    state = read(checkpoint) if resume and checkpoint.exists() else {}
    done = set(state.get('done', [])) if state.get('revision') == revision else set()
    commands = [
        ('overview', ['node', 'scripts/build-analyst-overview.cjs', 'MDT']),
        ('rough', [sys.executable, '-B', 'scripts/build_three_site_rough.py']),
        ('gps-stations', ['node', 'scripts/build-gps-map-stations.cjs']),
        ('screening', ['node', 'scripts/build-customer-screening.cjs']),
        ('quality-evidence', [sys.executable, '-B', 'scripts/build_quality_ui.py', '--work-dir', str(work/'quality-input'),
                              *(['--reuse-cache'] if resume else [])]),
        ('quality-export', ['node', 'scripts/export-quality-improvement.cjs']),
        ('quality-full', [sys.executable, '-B', 'scripts/build-quality-full-period.py']),
        ('models-full', [sys.executable, '-B', 'scripts/build-quality-model-alternatives.py', '--analysis-mode', 'all']),
        ('models-evaluation', [sys.executable, '-B', 'scripts/build-quality-model-alternatives.py', '--analysis-mode', 'evaluation']),
        ('mixed-candidates', [sys.executable, '-B', 'scripts/build-quality-mixed-candidates.py']),
        ('mixed-models-full', [sys.executable, '-B', 'scripts/build-quality-models-mixed.py', '--analysis-mode', 'all']),
        ('mixed-models-evaluation', [sys.executable, '-B', 'scripts/build-quality-models-mixed.py', '--analysis-mode', 'evaluation']),
        ('candidate-rf', ['node', 'scripts/build-candidate-mdt-rsrp.cjs']),
        ('gps-rf', ['node', 'scripts/build-qoe-gps-marker-rf.cjs']),
        ('voice-query', [sys.executable, '-B', 'scripts/build_voice_query_db.py',
                         '--public-dir', str(public), '--out-dir', str(ROOT/'outputs/voice-query-data'),
                         '--root-dir', str(ROOT)]),
    ]
    for name, args in commands:
        if name in done:
            continue
        run(args)
        done.add(name)
        checkpoint.write_text(json.dumps({'revision': revision, 'done': sorted(done)}), encoding='utf-8')
    summary = validate(public)
    if not query_ready(public, revision):
        raise ValueError('Voice query store is missing or stale; publication was not changed')
    print(json.dumps({'phase': 'validated', **summary}, ensure_ascii=False), flush=True)
    backup = work/('previous-public-'+datetime.now().strftime('%Y%m%d-%H%M%S'))
    promote(public, ROOT/'public', backup)
    audit = ROOT/'outputs/voice-1030-quality-report.json'
    if audit.exists():
        backup.mkdir(parents=True, exist_ok=True)
        shutil.copy2(audit, backup/'source-audit.json')
    shutil.copy2(work/'source-audit.json', audit)
    summary['pipelineSignature'] = signature
    (work/'result.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
    current.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'phase': 'published', **summary}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--work-dir', type=Path, default=ROOT/'outputs/voice-ui-build')
    parser.add_argument('--skip-source', action='store_true')
    parser.add_argument('--resume', action='store_true')
    args = parser.parse_args()
    build(args.work_dir.resolve(), args.skip_source, args.resume)
