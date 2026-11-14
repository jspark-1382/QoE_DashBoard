"""Publish a separate, immutable catalog of customer-side handset observations.

Source SIP workbooks and the voice database are read-only. Only the selected
party's model is retained; peer models, User-Agent and IMEISV are never stored.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import posixpath
import re
import sqlite3
import time
import uuid
import zipfile
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

from lxml import etree as ET
from openpyxl.utils.datetime import MAC_EPOCH, WINDOWS_EPOCH, from_excel

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
REL_NS = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
ROOT = Path(__file__).resolve().parents[1]
KST = timezone(timedelta(hours=9))
FIELDS = frozenset({'4. START TIME', '9. CALL DIR', 'E2. svc_cont_id',
                    '126. DEVICE INVITE', '127. DEVICE 200OK',
                    '20. USER AGENT Invite', '21. USER AGENT 200OK'})
MISSING = {'', '_', '-', 'NULL', 'NAN', 'NONE', 'N/A', 'UNKNOWN', 'UNDEFINED', '미확인', '알수없음'}
MODEL = re.compile(r'[A-Za-z0-9][A-Za-z0-9 ._+()/-]{0,79}\Z')
DIRECTION = re.compile(r'^\s*(\d+)\s*:\s*(.*?)\s*$')
OUTGOING_CODES = frozenset({'1', '3', '5', '10', '14', '16'})
INCOMING_CODES = frozenset({'2', '4', '6', '11', '15'})
IPHONE = re.compile(r'(?:^|[\s/;])iPhone(?:[\s/;]|$)', re.I)


def log(phase, **values):
    print(json.dumps({'phase': phase, **values}, ensure_ascii=False), flush=True)


def clean(value):
    value = str(value).strip() if value is not None else ''
    return '' if value.upper() in MISSING else value


def customer_id(contract):
    """Exactly the existing build_voice_1030.sha_key('mdt', contract) identity."""
    raw = json.dumps(['mdt', contract], ensure_ascii=False, separators=(',', ':'))
    return 'mdt-' + hashlib.sha256(raw.encode('utf-8')).hexdigest()[:24]


def direction_side(value):
    """The source labels explicitly identify the customer as sender/receiver.

    10: 5G 음성 발신 originates INVITE; 11: 5G 음성 착신 answers with
    200OK. The other codes were also observed with explicit 발신/착신 labels
    in these six SIP files (VoLTE, MGW and video calls). Require both code and
    Korean role to agree; the unlabeled 9: ETC remains unavailable.
    """
    match = DIRECTION.fullmatch(str(value or ''))
    if not match:
        return None
    code, label = match.groups()
    outgoing, incoming = '발신' in label, '착신' in label
    if outgoing == incoming:
        return None
    if code in OUTGOING_CODES and outgoing:
        return 'invite'
    if code in INCOMING_CODES and incoming:
        return '200ok'
    return None


def valid_model(value):
    value = clean(value)
    if (not value or not MODEL.fullmatch(value) or re.search(r'\d{10,}', value)
            or not re.search(r'[A-Za-z]', value)
            or re.search(r'TTA[- ]?VoLTE|Device_Type|https?://|iOS/', value, re.I)
            or value.upper() in {'ANDROID', 'PHONE', 'ANDROID_PHONE', 'VOLTE', 'LTE', '5G'}):
        return None
    return value


def model_for_row(row):
    side = direction_side(row.get('9. CALL DIR'))
    if side is None:
        return None
    device, agent = ('126. DEVICE INVITE', '20. USER AGENT Invite') if side == 'invite' else (
        '127. DEVICE 200OK', '21. USER AGENT 200OK')
    model = valid_model(row.get(device))
    if model:
        return model
    # iPhone identifies the family only. No generation is inferred from iOS or
    # the peer's handset; unknown Android models remain unavailable.
    return 'iPhone' if IPHONE.search(str(row.get(agent) or '')) else None


def start_datetime(value):
    if isinstance(value, datetime):
        return value.replace(tzinfo=KST) if value.tzinfo is None else value.astimezone(KST)
    if isinstance(value, str) and value.strip():
        try:
            parsed = datetime.fromisoformat(value.strip())
            return parsed.replace(tzinfo=KST) if parsed.tzinfo is None else parsed.astimezone(KST)
        except ValueError:
            return None
    return None


def observation(row, dates):
    start = start_datetime(row.get('4. START TIME'))
    contract = clean(row.get('E2. svc_cont_id'))
    if not start or start.date().isoformat() not in dates or not contract:
        return None
    model = model_for_row(row)
    if model is None:
        return None
    return customer_id(contract), start.date().isoformat(), start.hour * 60 + start.minute, model


def release(element):
    element.clear()
    parent = element.getparent()
    if parent is not None:
        while element.getprevious() is not None:
            del parent[0]


def projected_rows(path):
    """Stream seven CDR columns without retaining/hash-copying the full row."""
    with zipfile.ZipFile(path) as archive:
        workbook = ET.fromstring(archive.read('xl/workbook.xml'))
        properties = workbook.find(NS + 'workbookPr')
        epoch = MAC_EPOCH if properties is not None and properties.get('date1904') in ('1', 'true') else WINDOWS_EPOCH
        sheets = workbook.find(NS + 'sheets')
        sheet = next((s for s in sheets if s.get('name', '').lower() == 'result'), sheets[0])
        relationships = ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))
        target = next(r.get('Target') for r in relationships if r.get('Id') == sheet.get(REL_NS + 'id'))
        sheet_path = target.lstrip('/') if target.startswith('/') else posixpath.normpath(posixpath.join('xl', target))
        strings = []
        if 'xl/sharedStrings.xml' in archive.namelist():
            with archive.open('xl/sharedStrings.xml') as source:
                for _, node in ET.iterparse(source, events=('end',), tag=NS + 'si'):
                    strings.append(''.join(n.text or '' for n in node.iter(NS + 't')))
                    release(node)

        def decode(cell):
            kind = cell.get('t')
            value = cell.findtext(NS + 'v', default='')
            if kind == 's' and value:
                return strings[int(value)]
            if kind == 'inlineStr':
                return ''.join(n.text or '' for n in cell.iter(NS + 't'))
            return value

        columns = None
        with archive.open(sheet_path) as source:
            for _, node in ET.iterparse(source, events=('end',), tag=NS + 'row'):
                if columns is None:
                    headers = {c.get('r', '').rstrip('0123456789'): str(decode(c)).strip() for c in node}
                    missing = FIELDS - set(headers.values())
                    if missing:
                        raise ValueError(f'{path.name}: missing SIP columns: {sorted(missing)}')
                    columns = {col: name for col, name in headers.items() if name in FIELDS}
                    release(node)
                    continue
                projected = {}
                for cell in node:
                    name = columns.get(cell.get('r', '').rstrip('0123456789'))
                    if name is None:
                        continue
                    value = decode(cell)
                    if name == '4. START TIME' and value and cell.get('t') not in ('s', 'inlineStr'):
                        try:
                            value = datetime.fromisoformat(value) if cell.get('t') == 'd' else from_excel(float(value), epoch)
                        except (ValueError, TypeError, OverflowError):
                            value = None
                    projected[name] = value
                release(node)
                if projected:
                    yield projected


def build_catalog(root, sources, revision, dates, source_check=None):
    root = Path(root).resolve()
    dates = frozenset(dates)
    folder = root / 'outputs/customer-device-data'
    folder.mkdir(parents=True, exist_ok=True)
    token = str(time.time_ns()) + '-' + uuid.uuid4().hex[:10]
    final = folder / (token + '.sqlite')
    temporary = folder / ('.building-' + token + '.sqlite')
    started = time.monotonic()
    if source_check is not None:
        source_check()
    audit = Counter()
    audit_sources, direction_counts = [], Counter()
    db = sqlite3.connect(temporary)
    try:
        db.executescript('''
          PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;
          PRAGMA temp_store=MEMORY; PRAGMA cache_size=-32768;
          CREATE TABLE meta(key TEXT PRIMARY KEY,json TEXT NOT NULL);
          CREATE TABLE customer_devices(
            customer_id TEXT NOT NULL,date TEXT NOT NULL,
            minute INTEGER NOT NULL CHECK(minute>=0 AND minute<1440),model TEXT NOT NULL,
            PRIMARY KEY(customer_id,date,minute,model)) WITHOUT ROWID;
        ''')
        db.executemany('INSERT INTO meta VALUES (?,?)', [('sourceRevision', json.dumps(revision)),
            ('schema', json.dumps('customer-device-db-v1')), ('dates', json.dumps(sorted(dates)))])
        for path in sources:
            path = Path(path)
            source_started = time.monotonic()
            source_audit = Counter()
            log('device-source-start', file=path.name, bytes=path.stat().st_size)
            batch = []
            for row in projected_rows(path):
                source_audit['inputRows'] += 1
                if source_audit['inputRows'] % 50000 == 0:
                    log('device-source-progress', file=path.name, rows=source_audit['inputRows'],
                        seconds=round(time.monotonic() - source_started, 1))
                direction = str(row.get('9. CALL DIR') or '').strip()
                # Direction is a fixed source enumeration, never a customer ID.
                direction_counts[direction if re.fullmatch(r'[0-9: A-Za-z가-힣()+/_-]{1,80}', direction) else 'unrecognized'] += 1
                start = start_datetime(row.get('4. START TIME'))
                if not start or start.date().isoformat() not in dates:
                    source_audit['excludedDateOrTime'] += 1
                    continue
                if not clean(row.get('E2. svc_cont_id')):
                    source_audit['excludedMissingContract'] += 1
                    continue
                side = direction_side(direction)
                if side is None:
                    source_audit['excludedDirection'] += 1
                    continue
                value = observation(row, dates)
                if value is None:
                    source_audit['excludedModelUnavailable'] += 1
                    continue
                source_audit['availableRows'] += 1
                source_audit['selectedInvite' if side == 'invite' else 'selected200ok'] += 1
                if value[3] == 'iPhone':
                    source_audit['iphoneFamilyRows'] += 1
                batch.append(value)
                if len(batch) >= 10000:
                    db.executemany('INSERT OR IGNORE INTO customer_devices VALUES (?,?,?,?)', batch)
                    db.commit()
                    batch.clear()
            if batch:
                db.executemany('INSERT OR IGNORE INTO customer_devices VALUES (?,?,?,?)', batch)
            db.commit()
            audit.update(source_audit)
            details = {'file': path.name, **dict(source_audit), 'seconds': round(time.monotonic() - source_started, 2)}
            audit_sources.append(details)
            log('device-source-complete', **details)
        audit['observations'] = db.execute('SELECT COUNT(*) FROM customer_devices').fetchone()[0]
        audit['customers'] = db.execute('SELECT COUNT(DISTINCT customer_id) FROM customer_devices').fetchone()[0]
        audit['models'] = db.execute('SELECT COUNT(DISTINCT model) FROM customer_devices').fetchone()[0]
        audit['duplicateModelMinutesRemoved'] = audit['availableRows'] - audit['observations']
        if source_check is not None:
            if source_check() != revision:
                raise ValueError('Original source revision changed during device extraction')
        result = {'schemaVersion': 'customer-device-index-v1', 'sourceRevision': revision,
            'database': final.relative_to(root).as_posix(), 'dates': sorted(dates),
            'audit': {**dict(audit), 'directions': dict(direction_counts), 'sources': audit_sources,
                      'buildSeconds': round(time.monotonic() - started, 2)}}
        db.execute('INSERT INTO meta VALUES (?,?)', ('audit', json.dumps(result['audit'], ensure_ascii=False)))
        db.commit()
        if db.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
            raise ValueError('Device catalog integrity check failed')
        db.close()
        os.replace(temporary, final)
        staged = final.with_suffix('.index.json')
        staged.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
        log('device-artifact-ready', database=result['database'], stagedIndex=staged.relative_to(root).as_posix(), audit=result['audit'])
        return result
    except BaseException:
        db.close()
        if temporary.exists():
            temporary.unlink()
        raise


def publish_index(root, result):
    root = Path(root).resolve()
    current = json.loads((root / 'public/voice-query-index.json').read_text(encoding='utf-8'))
    if result.get('sourceRevision') != current.get('sourceRevision'):
        raise ValueError('Source revision changed before device publication')
    database = (root / result['database']).resolve()
    if not database.is_relative_to(root / 'outputs/customer-device-data') or not database.is_file():
        raise ValueError('Invalid device catalog database path')
    with sqlite3.connect(database.as_uri() + '?mode=ro', uri=True) as db:
        revision = db.execute("SELECT json FROM meta WHERE key='sourceRevision'").fetchone()
        schema = db.execute("SELECT json FROM meta WHERE key='schema'").fetchone()
        if not revision or json.loads(revision[0]) != current['sourceRevision'] or not schema or json.loads(schema[0]) != 'customer-device-db-v1':
            raise ValueError('Device database revision or schema mismatch')
    target = root / 'public/customer-device-index.json'
    temporary = target.with_name('.customer-device-index-' + uuid.uuid4().hex + '.tmp')
    temporary.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    try:
        os.replace(temporary, target)
    finally:
        if temporary.exists():
            temporary.unlink()
    log('device-index-published', database=result['database'], sourceRevision=result['sourceRevision'])


def source_paths(source_dir, meta):
    sources = sorted((p for p in Path(source_dir).glob('*.xlsx')
        if not p.name.startswith('~$') and 'sip_call' in p.name.casefold()),
        key=lambda p: (not p.name.startswith('261026_1030_'), p.name.casefold()))
    expected = {name for name in meta.get('sourceFiles', []) if 'sip_call' in name.casefold()}
    if not expected or {path.name for path in sources} != expected:
        raise ValueError('SIP source files do not match the current voice revision')
    return sources


def source_fingerprint(paths, config):
    """Identical byte framing to build_voice_1030.file_revision."""
    digest = hashlib.sha256(json.dumps(config, sort_keys=True).encode())
    for path in paths:
        digest.update(path.name.encode('utf-8'))
        with path.open('rb') as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b''):
                digest.update(chunk)
    return digest.hexdigest()[:20]


def verify_source_revision(root, source_dir, meta):
    """Fail closed if the immutable source bytes no longer match this pipeline.

    The published voice-v7 fingerprint includes all SIP, MDT and station files,
    so validating SIP filenames/sizes alone would not prove source identity.
    """
    if meta.get('coverage', {}).get('legacyMasterPresent'):
        raise ValueError('Legacy source revision verification needs its original master configuration')
    config = {'pipeline': 'voice-1026-1030-multi-source-v7',
        'date': meta['dates'][0] if len(meta['dates']) == 1 else 'all',
        'toleranceSec': 30, 'mosPoor': 3, 'mosWarning': 3.5,
        'masterJoin': 'ru+cell-exact-first',
        'byeSiteSelection': 'same-call-mdt-30s-then-first-valid-inventory-row'}
    paths = [Path(source_dir) / name for name in meta['sourceFiles']]
    paths += [Path(root) / 'data/BaseStation' / item['file'] for item in meta['byeStationInventories']]
    actual = source_fingerprint(paths, config)
    if actual != meta.get('revision'):
        raise ValueError('Original source bytes do not match the published voice revision')
    log('device-source-revision-verified', sourceRevision=actual, files=len(paths))
    return actual


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--source-dir', type=Path)
    parser.add_argument('--publish', action='store_true', help='Publish the index after a successful fresh build')
    parser.add_argument('--publish-index', type=Path, help='Atomically publish an already verified staged index')
    args = parser.parse_args()
    root = args.root.resolve()
    if args.publish_index:
        publish_index(root, json.loads(args.publish_index.read_text(encoding='utf-8')))
        return
    index = json.loads((root / 'public/voice-query-index.json').read_text(encoding='utf-8'))
    database = (root / index['database']).resolve()
    with sqlite3.connect(database.as_uri() + '?mode=ro', uri=True) as db:
        meta = json.loads(db.execute("SELECT json FROM meta WHERE key='dataset'").fetchone()[0])
    if meta.get('revision') != index.get('sourceRevision'):
        raise ValueError('Current voice manifest and database revision mismatch')
    source_dir = args.source_dir or root / 'data/MDT_New'
    sources = source_paths(source_dir, meta)
    result = build_catalog(root, sources, index['sourceRevision'], meta['dates'],
        source_check=lambda: verify_source_revision(root, source_dir, meta))
    if args.publish:
        publish_index(root, result)


if __name__ == '__main__':
    main()
