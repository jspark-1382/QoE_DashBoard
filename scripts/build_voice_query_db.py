"""Build the local immutable voice read model from published JSON, never XLSX.

The incremental decoder retains one array member plus a 1 MiB input buffer;
neither the 274 MB manifest nor a daily overview is materialized in memory.
"""
import argparse
import datetime as dt
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import time

SCHEMA = 'voice-query-db-v1'
BUILD_VERSION = '2026-11-12.6'
DROP = re.compile(r'(?:^|[\^\s/;,])H\s*(?::\s*Drop\b|(?=\^|$))|(?:^|[\s:;/])Drop\b', re.I)
TIMESTAMP = re.compile(r'^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$')

def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False)

class JsonStream:
    def __init__(self, filename):
        self.file = open(filename, encoding='utf-8-sig')
        self.buffer = ''
        self.pos = 0
        self.eof = False
        self.decoder = json.JSONDecoder()

    def fill(self):
        self.buffer = self.buffer[self.pos:] + self.file.read(1024 * 1024)
        self.pos = 0
        if len(self.buffer) == 0:
            self.eof = True

    def char(self):
        while True:
            while self.pos < len(self.buffer) and self.buffer[self.pos].isspace():
                self.pos += 1
            if self.pos < len(self.buffer):
                return self.buffer[self.pos]
            if self.eof:
                raise ValueError('Unexpected end of source JSON')
            self.fill()

    def take(self, expected):
        if self.char() != expected:
            raise ValueError('Invalid source JSON: expected ' + expected)
        self.pos += 1

    def value(self):
        self.char()
        while True:
            try:
                result, end = self.decoder.raw_decode(self.buffer, self.pos)
                self.pos = end
                return result
            except json.JSONDecodeError:
                old = len(self.buffer) - self.pos
                self.fill()
                if len(self.buffer) == old:
                    raise ValueError('Truncated source JSON')

    def members(self):
        try:
            self.take('{')
            while self.char() != '}':
                key = self.value()
                self.take(':')
                if self.char() == '[':
                    self.take('[')
                    while self.char() != ']':
                        yield key, self.value()
                        if self.char() != ']':
                            self.take(',')
                    self.take(']')
                else:
                    yield key, self.value()
                if self.char() != '}':
                    self.take(',')
            self.take('}')
        finally:
            self.file.close()

def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)

def timestamp(value):
    if not isinstance(value, str) or not TIMESTAMP.fullmatch(value):
        return None
    try:
        return dt.datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp() * 1000
    except ValueError:
        return None

def safe_rough(point, old, boundaries):
    if old and (old.get('evidence') == 'gnss' or old.get('positionQuality') == 'trilateration-reviewable'):
        return False
    sites = point.get('usedStations', [])
    if (point.get('areaId') not in boundaries or point.get('evidence') != 'estimated' or
        point.get('positionQuality') != 'three-site-rough' or point.get('estimationMethod') != 'THREE_SITE_RSRP_CENTROID' or
        point.get('representativeBasis') != 'cdr-end-nearest' or not finite(point.get('lat')) or
        not finite(point.get('lon')) or not 33 <= point['lat'] <= 39.8 or not 124 <= point['lon'] <= 132 or
        not isinstance(point.get('usedSiteCount'), int) or point['usedSiteCount'] < 3 or
        not finite(point.get('roughSearchRadiusM')) or not 600 <= point['roughSearchRadiusM'] <= 5000 or
        not finite(point.get('secondsBeforeEnd')) or not -1 <= point['secondsBeforeEnd'] <= 180 or
        len(sites) != point['usedSiteCount']):
        return False
    for i, site in enumerate(sites):
        if not finite(site.get('lat')) or not finite(site.get('lon')) or not site.get('ruId') or not site.get('cellId') or not finite(site.get('rsrpDbm')):
            return False
        for other in sites[i + 1:]:
            if not finite(other.get('lat')) or not finite(other.get('lon')):
                return False
            dy = (site['lat'] - other['lat']) * 111195
            dx = (site['lon'] - other['lon']) * 111195 * math.cos((site['lat'] + other['lat']) / 2 * math.pi / 180)
            if math.hypot(dx, dy) < 20:
                return False
    return True

def build_default_screening(db, dates):
    """Materialize the default population once, keeping custom scopes queryable."""
    db.execute('''CREATE TABLE screen_default_rows AS WITH selected AS (
      SELECT c.customer_id,c.date,ROUND(c.qoe,6) AS qoe,c.is_drop,c.screen_area
      FROM facts c NOT INDEXED WHERE c.date>=? AND c.date<=? AND c.start_second>=0 AND c.start_second<86400),
      grouped AS (SELECT customer_id AS id,COUNT(*) AS total,COUNT(qoe) AS eligible,
        SUM(CASE WHEN qoe<3 THEN 1 ELSE 0 END) AS poor,SUM(is_drop) AS dropCount,AVG(qoe) AS mean,
        COUNT(DISTINCT CASE WHEN qoe<3 THEN date END) AS repeatedDays FROM selected GROUP BY customer_id),
      area_days AS (SELECT customer_id,screen_area,COUNT(DISTINCT date) AS n FROM selected
        WHERE qoe<3 AND screen_area<>'' GROUP BY customer_id,screen_area),
      highest AS (SELECT customer_id,MAX(n) AS sameAreaDays FROM area_days GROUP BY customer_id),
      rates AS (SELECT g.*,COALESCE(p.number,'') AS number,
        CASE WHEN eligible>0 THEN poor*1.0/eligible ELSE 0 END AS poorRate,
        dropCount*1.0/total AS dropRate,COALESCE(h.sameAreaDays,0) AS sameAreaDays
        FROM grouped g LEFT JOIN customers p ON p.id=g.id LEFT JOIN highest h ON h.customer_id=g.id)
      SELECT *,CASE WHEN poor>=10 OR (eligible>=5 AND poor>0 AND poorRate>=.5) THEN 1 ELSE 0 END AS concentrated,
        CASE WHEN dropCount>=3 OR (total>=5 AND dropCount>0 AND dropRate>=.1) THEN 1 ELSE 0 END AS dropHeavy FROM rates''',
      (min(dates), max(dates)))
    db.executescript('''
      CREATE UNIQUE INDEX screen_default_id ON screen_default_rows(id);
      CREATE INDEX screen_default_poor ON screen_default_rows(poor DESC,repeatedDays DESC,poorRate DESC,dropCount DESC,number);
      CREATE INDEX screen_default_drop ON screen_default_rows(dropCount DESC,poor DESC,dropRate DESC,repeatedDays DESC,poorRate DESC,number);
      CREATE INDEX screen_default_repeat ON screen_default_rows(repeatedDays DESC,poor DESC,sameAreaDays DESC,poorRate DESC,dropCount DESC,number);
    ''')
    fields = ['total','affected','repeat','concentrated','dropHeavy','locationRepeat','calls','eligible','poor','drop','affectedCallTotal']
    values = db.execute('''SELECT COUNT(*),SUM(poor>0),SUM(repeatedDays>=2),SUM(concentrated),SUM(dropHeavy),
      SUM(sameAreaDays>=2),SUM(total),SUM(eligible),SUM(poor),SUM(dropCount),
      SUM(CASE WHEN poor>0 THEN total ELSE 0 END) FROM screen_default_rows''').fetchone()
    report = {key: value or 0 for key, value in zip(fields, values)}
    affected_call_total = report.pop('affectedCallTotal')
    report['groups'] = {key: 0 for key in ['concentrated','repeat','drop','temporary','good']}
    for kind, count in db.execute('''SELECT CASE WHEN concentrated THEN 'concentrated'
      WHEN repeatedDays>=2 THEN 'repeat' WHEN dropHeavy THEN 'drop' WHEN poor>0 THEN 'temporary'
      ELSE 'good' END AS kind,COUNT(*) FROM screen_default_rows GROUP BY kind'''):
        report['groups'][kind] = count
    db.execute('INSERT INTO meta VALUES (?,?)', ('screening-default-report', compact({'report': report, 'affectedCallTotal': affected_call_total})))


def build(public_dir, out_dir, root_dir=None):
    started = time.monotonic()
    public_dir, out_dir = Path(public_dir).resolve(), Path(out_dir).resolve()
    root = Path(root_dir).resolve() if root_dir else public_dir.parent
    out_dir.mkdir(parents=True, exist_ok=True)
    source_files = [public_dir / 'voice-1030.json'] + sorted((public_dir / 'analyst-overview' / 'MDT').glob('*.json'))
    source_files += sorted((public_dir / 'three-site-rough').glob('*.json')) + sorted((public_dir / 'gps-map-stations').glob('*.json'))
    fingerprint = hashlib.sha256(compact([BUILD_VERSION, [(str(p.relative_to(public_dir)), p.stat().st_size, p.stat().st_mtime_ns) for p in source_files]]).encode()).hexdigest()[:16]
    index_path = public_dir / 'voice-query-index.json'
    if index_path.exists():
        previous = json.loads(index_path.read_text(encoding='utf8'))
        if previous.get('fingerprint') == fingerprint and (root / previous.get('database', '')).is_file():
            print('Voice query read model unchanged; retained', previous['database'], flush=True)
            return previous
    temporary = out_dir / ('building-' + fingerprint + '.sqlite')
    if temporary.exists():
        temporary.unlink()
    db = sqlite3.connect(temporary)
    db.executescript('''
      PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA temp_store=FILE; PRAGMA cache_size=-32768;
      CREATE TABLE meta(key TEXT PRIMARY KEY,json TEXT NOT NULL);
      CREATE TABLE customers(id TEXT PRIMARY KEY,number TEXT,json TEXT NOT NULL);
      CREATE TABLE days(customer_id TEXT,date TEXT,contract TEXT,json TEXT NOT NULL,PRIMARY KEY(customer_id,date));
      CREATE TABLE calls(id TEXT PRIMARY KEY,raw_id TEXT,customer_id TEXT,date TEXT,start_second REAL,source_clock REAL,
        timestamp_ms REAL,analytics_hour INTEGER,hour INTEGER,mos REAL,qoe REAL,is_drop INTEGER,sip_group TEXT,
        contract TEXT,area TEXT,cell TEXT,end_second REAL,json TEXT NOT NULL);
      CREATE TABLE locations(call_id TEXT,kind TEXT,area TEXT,evidence TEXT,lat REAL,lon REAL,json TEXT NOT NULL,PRIMARY KEY(call_id,kind));
      CREATE TABLE areas(id TEXT PRIMARY KEY,label TEXT,lat REAL,lon REAL,json TEXT NOT NULL);
      CREATE TABLE cell_sites(cell TEXT PRIMARY KEY,lat REAL,lon REAL);
    ''')
    meta = None
    for key, value in JsonStream(public_dir / 'voice-1030.json').members():
        if key == 'meta':
            meta = value
            db.execute('INSERT INTO meta VALUES (?,?)', ('dataset', compact(value)))
        elif key == 'customers':
            db.execute('INSERT INTO customers VALUES (?,?,?)', (value['id'], value.get('sourceContractId'), compact(value)))
        elif key == 'days':
            db.execute('INSERT INTO days VALUES (?,?,?,?)', (value['customerId'], value['date'], value.get('sourceContractId'), compact(value)))
    if not meta or not meta.get('revision') or meta.get('qoeBasis') != 'rtcp-mos-v5':
        raise ValueError('Published RTCP MOS(v5) manifest and revision are required')
    revision = meta['revision']
    if not isinstance(revision, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', revision):
        raise ValueError('Invalid published source revision')
    if not isinstance(meta.get('dates'), list) or not meta['dates'] or any(not isinstance(date, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', date) for date in meta['dates']):
        raise ValueError('Invalid published source dates')
    total = 0
    overview_meta = {}
    for date in meta['dates']:
        day_started = time.monotonic()
        headers = {}
        count = 0
        for key, value in JsonStream(public_dir / 'analyst-overview' / 'MDT' / (date + '.json')).members():
            if key == 'calls':
                c = value
                if not c.get('id') or not c.get('customerId') or not finite(c.get('startSecond')):
                    raise ValueError('Published call lacks original identity/time')
                mos = c.get('mos')
                drop = bool(DROP.search(str(c.get('sipCause') or '').strip()))
                qoe = (math.floor((mos - 2.5) * 1e6 + .5) / 1e6 if drop else mos) if finite(mos) and 1 <= mos <= 5 else None
                if 'mos' not in c and finite(c.get('qoe')):
                    qoe = c['qoe']
                stamp = timestamp(c.get('startTimestamp'))
                clock_match = re.search(r'T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$', c.get('startTimestamp') or '')
                source_clock = (int(clock_match[1]) * 3600 + int(clock_match[2]) * 60 + int(clock_match[3]) + float(clock_match[4] or 0)) if clock_match else c['startSecond']
                end = c.get('end', '')
                end_second = sum(int(part) * factor for part, factor in zip(end.split(':'), [3600, 60, 1])) if re.fullmatch(r'\d{2}:\d{2}:\d{2}', end) else None
                db.execute('INSERT INTO calls VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', (
                    c['id'], c.get('rawCallId') or c['id'][len(c['customerId']) + 1:], c['customerId'], date,
                    c['startSecond'], source_clock, stamp, int((stamp + 9 * 3600000) // 3600000) % 24 if stamp is not None else None,
                    math.floor(c['startSecond'] / 3600), mos if finite(mos) else None, qoe, int(drop),
                    'drop' if drop else 'normal' if re.fullmatch(r'A\s*:\s*Normal', str(c.get('sipCause') or '').strip(), re.I) else 'other',
                    c.get('contractId'), (c.get('gridIds') or [''])[0], c.get('endCellId') or '', end_second, compact(c)))
                count += 1
                if count % 10000 == 0:
                    db.commit()
            elif key == 'callLocations':
                p = value
                if not finite(p.get('lat')) or not finite(p.get('lon')) or abs(p['lat']) > 90 or abs(p['lon']) > 180 or p.get('evidence') not in ('gnss', 'estimated', 'bye-cell'):
                    continue
                db.execute('INSERT OR REPLACE INTO locations VALUES (?,?,?,?,?,?,?)', (p['callId'], 'original', p.get('areaId', ''), p['evidence'], p['lat'], p['lon'], compact(p)))
                if p['evidence'] == 'bye-cell' and p.get('byeCellId'):
                    db.execute('INSERT OR IGNORE INTO cell_sites VALUES (?,?,?)', (str(p['byeCellId']), round(p['lat'], 6), round(p['lon'], 6)))
            elif key == 'administrativeDongs':
                db.execute('INSERT OR IGNORE INTO areas VALUES (?,?,?,?,?)', (value['id'], value['label'], value['lat'], value['lon'], compact(value)))
            elif key == 'byeInventorySources':
                headers.setdefault(key, []).append(value)
            elif key != 'cells':
                headers[key] = value
        if headers.get('sourceRevision') != revision or headers.get('source') != 'MDT' or headers.get('date') != date:
            raise ValueError('Overview source/revision/date mismatch: ' + date)
        if not overview_meta:
            overview_meta = headers
        total += count
        db.commit()
        print(date, 'calls', count, 'seconds', round(time.monotonic() - day_started, 2), flush=True)
    db.execute("INSERT INTO locations SELECT call_id,'view',area,evidence,lat,lon,json FROM locations WHERE kind='original'")
    boundaries = {row[0] for row in db.execute('SELECT id FROM areas')}
    for date in meta['dates']:
        filename = public_dir / 'three-site-rough' / (date + '.json')
        if filename.exists():
            data = json.loads(filename.read_text(encoding='utf8'))
            if (data.get('schemaVersion') != 'coarse-three-site-v1' or data.get('sourceRevision') != revision or data.get('date') != date or data.get('method') != 'THREE_SITE_RSRP_CENTROID' or data.get('notA90PercentAccuracyRegion') is not True):
                raise ValueError('Stale or invalid rough sidecar: ' + date)
            for point in data.get('points', []):
                found = db.execute('SELECT json FROM calls WHERE id=?', (point['callId'],)).fetchone()
                if not found:
                    continue
                call = json.loads(found[0])
                found = db.execute("SELECT json FROM locations WHERE call_id=? AND kind='view'", (point['callId'],)).fetchone()
                old = json.loads(found[0]) if found else None
                if not safe_rough(point, old, boundaries):
                    continue
                safe = {**point, 'start': call['start'], 'mos': call.get('mos'), 'modelUncertaintyM': None, 'modelConfidenceScore': None}
                if old and old.get('evidence') == 'bye-cell':
                    for key in ['byeCellId', 'byeRuId', 'byeInventory', 'byeTechnology', 'byeInventorySha256', 'byeSelectionMethod', 'byeCandidateCount', 'byeSelectionDeltaSeconds', 'byeSelectionMdtRu']:
                        if key in old:
                            safe[key] = old[key]
                    safe.update(byeStationLat=old['lat'], byeStationLon=old['lon'])
                db.execute('INSERT OR REPLACE INTO locations VALUES (?,?,?,?,?,?,?)', (safe['callId'], 'view', safe['areaId'], safe['evidence'], safe['lat'], safe['lon'], compact(safe)))
        filename = public_dir / 'gps-map-stations' / (date + '.json')
        if filename.exists():
            data = json.loads(filename.read_text(encoding='utf8'))
            if data.get('sourceRevision') != revision or data.get('date') != date or data.get('schemaVersion') != 'gps-map-stations-v1':
                raise ValueError('Stale GPS station sidecar: ' + date)
            for call_id, record in data.get('records', {}).items():
                station = record.get('station', {})
                if station.get('isVirtual') or not station.get('baseStationId') or not station.get('cellId') or not finite(station.get('latitude')) or not finite(station.get('longitude')) or abs(station['latitude']) > 90 or abs(station['longitude']) > 180 or (station['latitude'] == 0 and station['longitude'] == 0):
                    continue
                for kind, raw in db.execute("SELECT kind,json FROM locations WHERE call_id=? AND evidence='gnss'", (call_id,)).fetchall():
                    point = json.loads(raw)
                    observed = timestamp(point.get('observedAt'))
                    if observed is not None and observed == timestamp(record.get('observedAt')):
                        point['gpsStation'] = station
                        db.execute('UPDATE locations SET json=? WHERE call_id=? AND kind=?', (compact(point), call_id, kind))
    db.executescript('''
      CREATE INDEX calls_date_time ON calls(date,start_second);
      CREATE INDEX calls_customer_date ON calls(customer_id,date,start_second);
      CREATE INDEX calls_band ON calls(qoe,date,start_second);
      CREATE INDEX calls_raw ON calls(raw_id);
      CREATE INDEX locations_kind_area ON locations(kind,area,evidence,call_id);
      CREATE INDEX days_contract ON days(contract,customer_id,date);
      CREATE INDEX customers_number ON customers(number);
      CREATE TABLE facts AS SELECT c.id,c.raw_id,c.customer_id,c.date,c.start_second,c.source_clock,c.timestamp_ms,
        c.analytics_hour,c.hour,c.mos,c.qoe,c.is_drop,c.sip_group,c.contract,c.area,c.cell,c.end_second,
        CASE WHEN l.call_id IS NOT NULL THEN 1 ELSE 0 END AS located,
        COALESCE(NULLIF(c.area,''),l.area,'') AS screen_area
        FROM calls c LEFT JOIN locations l ON l.call_id=c.id AND l.kind='original';
      CREATE UNIQUE INDEX facts_id ON facts(id);
      CREATE INDEX facts_date_time ON facts(date,start_second);
      CREATE INDEX facts_customer_date ON facts(customer_id,date,start_second);
      CREATE INDEX facts_score ON facts(qoe,date,start_second);
    ''')
    build_default_screening(db, meta['dates'])
    db.execute('ANALYZE')
    counts = db.execute('SELECT COUNT(*),COUNT(DISTINCT customer_id),COUNT(qoe),SUM(qoe<3),SUM(is_drop),COUNT(DISTINCT CASE WHEN qoe<3 THEN customer_id END) FROM calls').fetchone()
    if meta.get('totalCalls') is not None and counts[0] != meta['totalCalls']:
        raise ValueError('Call conservation audit failed')
    if counts[1] != db.execute('SELECT COUNT(*) FROM customers').fetchone()[0]:
        raise ValueError('Customer conservation audit failed')
    audit = dict(zip(['calls', 'customers', 'evaluated', 'poor', 'drops', 'affected'], counts))
    audit['mapped'] = dict(db.execute("SELECT evidence,COUNT(*) FROM locations l JOIN calls c ON c.id=l.call_id WHERE l.kind='view' AND c.qoe<3 GROUP BY evidence"))
    db.execute('INSERT INTO meta VALUES (?,?)', ('overview', compact(overview_meta)))
    db.execute('INSERT INTO meta VALUES (?,?)', ('audit', compact(audit)))
    db.execute('INSERT INTO meta VALUES (?,?)', ('schema', compact(SCHEMA)))
    db.commit()
    if db.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
        raise ValueError('SQLite integrity audit failed')
    db.close()
    final = out_dir / (revision + '-' + fingerprint + '.sqlite')
    if final.exists():
        # A previously published immutable artifact is never replaced, even
        # when recovering a missing index for identical source inputs.
        existing = sqlite3.connect(f'file:{final.as_posix()}?mode=ro', uri=True)
        try:
            existing_meta = json.loads(existing.execute("SELECT json FROM meta WHERE key='dataset'").fetchone()[0])
            if existing_meta.get('revision') != revision or existing.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
                raise ValueError('Existing immutable read model is invalid; choose a new build version')
        finally:
            existing.close()
        temporary.unlink()
    else:
        os.replace(temporary, final)
    result = {'schemaVersion': 'voice-query-index-v1', 'databaseSchema': SCHEMA, 'sourceRevision': revision,
              'fingerprint': fingerprint, 'database': os.path.relpath(final, root).replace('\\', '/'),
              'totalCalls': audit['calls'], 'totalCustomers': audit['customers'], 'audit': audit,
              'buildSeconds': round(time.monotonic() - started, 3), 'databaseBytes': final.stat().st_size}
    temp_index = index_path.with_suffix('.json.tmp')
    temp_index.write_text(compact(result), encoding='utf8')
    os.replace(temp_index, index_path)
    print(compact(result), flush=True)
    return result

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--public-dir', default=os.environ.get('QOE_PUBLIC_DIR', 'public'))
    parser.add_argument('--out-dir', default='outputs/voice-query-data')
    parser.add_argument('--root-dir', default=None, help='Repository root for the published relative database path')
    args = parser.parse_args()
    build(args.public_dir, args.out_dir, args.root_dir)
