"""Stdlib MDT adapters, disk staging, and versioned customer/day publishing.

Only one customer/day's events are held in memory. The user-authorized source
service contract is published on customer/day dimensions; original IMS/call
identifiers and exact-row fingerprints stay in a temporary SQLite database.
"""
import hashlib
import json
import math
import os
import posixpath
import shutil
import sqlite3
import tempfile
import uuid
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from statistics import fmean
from xml.etree import ElementTree as ET

from base_station_master import load_master

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
REL_NS = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
KST = timezone(timedelta(hours=9))
SITE = '지역 정보 없음'
SAMPLE_FIELDS = ['second', 'time', 'lat', 'lon', 'site', 'areaType', 'floorCode',
                 'floorName', 'rat', 'pci', 'rsrp', 'rsrq', 'sinr', 'mos', 'jitter',
                 'delay', 'qoe', 'cause', 'morphology', 'callId', 'ci', 'mdt']
NEW_REQUIRED = {'base_date', 'svc_cont_id', 'lte_vc_div', 'occ_dt'}
LEGACY_REQUIRED = {'기준년월일', 'MDT발생일시'}
COVERAGE_FIELDS = ['totalEvents', 'radioEvents', 'inCallRadioEvents', 'outsideCallRadioEvents',
                   'stationMatchedEvents', 'stationUnmatchedEvents', 'stationMatchedRadioEvents',
                   'stationUnmatchedRadioEvents', 'gnssPairsEvents', 'gnssPairsRadioEvents',
                   'gnssConvertedEvents', 'gnssConvertedRadioEvents', 'eventsWithoutLocationInput',
                   'radioEventsWithoutLocationInput', 'inCallGnssConvertedEvents']
LEGACY_MAP = {
    'base_date': '기준년월일', 'svc_cont_id': '서비스계약', 'lte_vc_div': '통화호구분',
    'ims_chage_id': 'ims_charge_id', 'occ_dt': 'MDT발생일시',
    'mdt_equip_cd': '기지국ID(MDT)', 'mdt_cell_id': 'Cell_ID(MDT)',
    'dlearfcn': '주파수(MDT)', 'mdt_cnt': 'MDT발생건수', 'mdt_num': 'MDT발생순서',
    'mdt_div': 'MDT발생구간', 'out_in_div_cd': '발착신구분',
    'ccal_fns_type_cd': '호종료유형', 'sip_cause': 'SIP', 'q850_cause': 'Q850',
    'fc': 'FC', 'gnss_utmkx': 'GNSS_UTMKX', 'gnss_utmky': 'GNSS_UTMKY',
    'gnss_metric_id': 'GNSS_METRIC_ID', 'rpt_type': '레포트타입(MDT)',
    'trigr_ev': 'Trigger Event', 'bts_maker_nm': '기지국제조사(MDT)',
}


def clean(value):
    result = str(value).strip() if value is not None else ''
    return '' if result.upper() in ('', '_', 'NULL') else result


def numeric(value):
    try:
        result = float(clean(value))
        return result if math.isfinite(result) else None
    except (ValueError, TypeError):
        return None


@lru_cache(maxsize=1024)
def parse_date(value):
    raw = clean(value)
    for pattern in ('%Y%m%d', '%Y-%m-%d'):
        try:
            return datetime.strptime(raw, pattern).strftime('%Y-%m-%d')
        except ValueError:
            pass
    raise ValueError('MDT 기준일 형식 오류')


@lru_cache(maxsize=65536)
def parse_timestamp(value, date=None):
    raw = clean(value)
    if not raw:
        return None
    if date and len(raw.split('.')[0]) <= 8 and ('T' not in raw and ' ' not in raw):
        date_compact = date.replace('-', '')
        raw = date_compact + (raw.replace(':', '').split('.')[0].zfill(6)) + ('.' + raw.split('.', 1)[1] if '.' in raw else '')
    if len(raw) >= 14 and raw[:14].isdigit():
        try:
            pattern = '%Y%m%d%H%M%S.%f' if '.' in raw else '%Y%m%d%H%M%S'
            return datetime.strptime(raw, pattern).replace(tzinfo=KST)
        except ValueError:
            return None
    try:
        result = datetime.fromisoformat(raw)
        return result.replace(tzinfo=KST) if result.tzinfo is None else result.astimezone(KST)
    except ValueError:
        return None


@lru_cache(maxsize=65536)
def anonymous_id(kind, *values):
    # JSON framing keeps (a, bc) distinct from (ab, c), and date scopes call IDs.
    raw = json.dumps([kind, *values], ensure_ascii=False, separators=(',', ':'))
    return kind + '-' + hashlib.sha256(raw.encode('utf-8')).hexdigest()[:24]


def _sheet_path(archive):
    if 'xl/workbook.xml' not in archive.namelist():
        return 'xl/worksheets/sheet1.xml'
    sheets = ET.fromstring(archive.read('xl/workbook.xml')).find(NS + 'sheets')
    selected = next((sheet for sheet in sheets if sheet.attrib.get('name', '').lower() == 'result'), sheets[0])
    relation_id = selected.attrib.get(REL_NS + 'id')
    relationships = ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))
    target = next(item.attrib['Target'] for item in relationships if item.attrib['Id'] == relation_id)
    return target.lstrip('/') if target.startswith('/') else posixpath.normpath(posixpath.join('xl', target))


def read_rows(path):
    """Read sparse inline/shared-string XLSX cells; release XML rows as consumed."""
    with zipfile.ZipFile(path) as archive:
        strings = []
        if 'xl/sharedStrings.xml' in archive.namelist():
            with archive.open('xl/sharedStrings.xml') as source:
                context = ET.iterparse(source, events=('start', 'end'))
                _, root = next(context)
                for event, element in context:
                    if event == 'end' and element.tag == NS + 'si':
                        strings.append(''.join(node.text or '' for node in element.iter(NS + 't')))
                        root.clear()
        headers = None
        with archive.open(_sheet_path(archive)) as source:
            context = ET.iterparse(source, events=('start', 'end'))
            _, root = next(context)
            sheet_data = None
            for event, row in context:
                if event == 'start' and row.tag == NS + 'sheetData':
                    sheet_data = row
                if event != 'end' or row.tag != NS + 'row':
                    continue
                values = {}
                for cell in row:
                    col = ''.join(char for char in cell.attrib.get('r', '') if char.isalpha())
                    raw = cell.findtext(NS + 'v', default='')
                    kind = cell.attrib.get('t')
                    if kind == 's' and raw:
                        value = strings[int(raw)]
                    elif kind == 'inlineStr':
                        value = ''.join(node.text or '' for node in cell.iter(NS + 't'))
                    else:
                        value = raw
                    values[col] = value or ''
                # Clearing only the row leaves 600k empty siblings attached.
                if sheet_data is not None:
                    sheet_data.clear()
                else:
                    root.clear()
                if headers is None:
                    headers = {col: value.strip() for col, value in values.items()}
                    if not (NEW_REQUIRED <= set(headers.values()) or LEGACY_REQUIRED <= set(headers.values())):
                        raise ValueError(f'{path.name}: 지원하지 않는 MDT 컬럼 형식')
                elif any(str(value).strip() for value in values.values()):
                    yield {header: values.get(col, '') for col, header in headers.items()}


def score(records):
    parts = []
    for field, low, high in (('rsrp', -120, -70), ('rsrq', -20, -5), ('nsinr', -5, 25)):
        values = [numeric(row.get(field)) for row in records]
        values = [value for value in values if value is not None]
        if values:
            parts.append(1 + 4 * max(0, min(1, (fmean(values) - low) / (high - low))))
    return round(fmean(parts), 2) if parts else None


def normalize(row):
    modern = NEW_REQUIRED <= row.keys()
    fields = row if modern else {**row, **{key: row.get(original, '') for key, original in LEGACY_MAP.items()}}
    date = parse_date(fields.get('base_date'))
    contract, call_key = clean(fields.get('svc_cont_id')), clean(fields.get('lte_vc_div'))
    source_contract = contract or None
    ims = clean(fields.get('ims_chage_id'))
    if not modern:
        call_key = call_key or ims
        contract = contract or call_key
    if not contract or not call_key:
        raise ValueError('MDT 고객/통화 식별자 누락')
    customer_id = anonymous_id('mdt', contract)
    call_id = anonymous_id('call', date, contract, call_key)
    if modern:
        start = parse_timestamp(fields.get('svc_ctgry_st_hhmiss'), clean(fields.get('svc_ctgry_st_ymd')) or date)
        end = parse_timestamp(fields.get('svc_ctgry_fns_hhmiss'), clean(fields.get('svc_ctgry_fns_ymd')) or date)
    else:
        start, end = (parse_timestamp(row.get(field), date) for field in ('시작시간', '종료시간'))
    call = {
        'id': call_id, 'start': start.strftime('%H:%M:%S') if start else '',
        'end': end.strftime('%H:%M:%S') if end else '',
        'startTimestamp': start.isoformat() if start else None,
        'endTimestamp': end.isoformat() if end else None,
        'endType': clean(fields.get('ccal_fns_type_cd')), 'sipCause': clean(fields.get('sip_cause')),
        'q850Cause': clean(fields.get('q850_cause')), 'fc': clean(fields.get('fc')),
        'direction': clean(fields.get('out_in_div_cd')), 'reportedMdtCount': numeric(fields.get('mdt_cnt')),
    }
    if not start:
        del call['startTimestamp']
    if not end:
        del call['endTimestamp']
    stamp = parse_timestamp(fields.get('occ_dt'))
    event = None
    if stamp:
        neighbors = []
        for index in (1, 2):
            pci, rsrp = numeric(fields.get(f'n{index}_pci')), numeric(fields.get(f'n{index}_rsrp'))
            if pci is not None or rsrp is not None:
                neighbors.append({'pci': pci, 'rsrp': rsrp})
        event = {
            'schema': 'new' if modern else 'legacy',
            'timestamp': stamp.isoformat(timespec='milliseconds'),
            'second': stamp.hour * 3600 + stamp.minute * 60 + stamp.second + stamp.microsecond / 1e6,
            'time': stamp.strftime('%H:%M:%S'), 'pci': numeric(fields.get('pci')),
            'rsrp': numeric(fields.get('rsrp')), 'rsrq': numeric(fields.get('rsrq')),
            'nsinr': numeric(fields.get('nsinr')),
            'mdt': {'timestamp': stamp.isoformat(timespec='milliseconds'),
                    'baseStationId': clean(fields.get('mdt_equip_cd')), 'cellId': clean(fields.get('mdt_cell_id')),
                    'frequency': numeric(fields.get('dlearfcn')), 'streamId': customer_id,
                    'phr': numeric(fields.get('phr')), 'neighbors': neighbors,
                    'phase': clean(fields.get('mdt_div')), 'sequence': numeric(fields.get('mdt_num')),
                    'gnssUtmkx': numeric(fields.get('gnss_utmkx')), 'gnssUtmky': numeric(fields.get('gnss_utmky')),
                    'gnssMetricId': clean(fields.get('gnss_metric_id')), 'locationSource': 'unavailable'},
        }
    return date, customer_id, call, event, ims, modern, source_contract


def _json(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False)


def _create_staging(connection):
    connection.executescript('''
        PRAGMA journal_mode=OFF;
        PRAGMA synchronous=OFF;
        CREATE TABLE fingerprints (hash BLOB PRIMARY KEY) WITHOUT ROWID;
        CREATE TABLE calls (id TEXT PRIMARY KEY, customer TEXT, date TEXT, payload TEXT);
        CREATE TABLE customers (id TEXT PRIMARY KEY, source_contract TEXT);
        CREATE TABLE call_ims (call_id TEXT, ims_id TEXT, PRIMARY KEY(call_id, ims_id)) WITHOUT ROWID;
        CREATE TABLE events (customer TEXT, date TEXT, call_id TEXT, stamp TEXT, payload TEXT);
    ''')


def _stage(connection, paths):
    source_rows, schemas = {}, set()
    duplicates, invalid_rows, invalid_timestamps = 0, 0, 0
    revision = hashlib.sha256(b'mdt-v2.5-source-contract-confirmed-gnss')
    known_calls = set()
    known_ims = set()
    for path in paths:
        count = 0
        for count, row in enumerate(read_rows(path), 1):
            fingerprint = hashlib.sha256(_json(sorted(row.items())).encode('utf-8')).digest()
            revision.update(fingerprint)
            inserted = connection.execute('INSERT OR IGNORE INTO fingerprints VALUES (?)', (fingerprint,)).rowcount
            if not inserted:
                duplicates += 1
                continue
            try:
                date, customer, call, event, ims, modern, source_contract = normalize(row)
            except ValueError:
                invalid_rows += 1
                continue
            schemas.add('new' if modern else 'legacy')
            if call['id'] not in known_calls:
                connection.execute('INSERT INTO calls VALUES (?,?,?,?)', (call['id'], customer, date, _json(call)))
                connection.execute('INSERT INTO customers VALUES (?,?) ON CONFLICT(id) DO UPDATE SET source_contract=COALESCE(customers.source_contract,excluded.source_contract)',
                                   (customer, source_contract))
                known_calls.add(call['id'])
            if ims and (call['id'], ims) not in known_ims:
                connection.execute('INSERT OR IGNORE INTO call_ims VALUES (?,?)', (call['id'], ims))
                known_ims.add((call['id'], ims))
            if event:
                connection.execute('INSERT INTO events VALUES (?,?,?,?,?)', (customer, date, call['id'], event['timestamp'], _json(event)))
            elif clean(row.get('occ_dt') if modern else row.get('MDT발생일시')):
                invalid_timestamps += 1
            if count % 10000 == 0:
                connection.commit()
            if count % 100000 == 0:
                print(_json({'file': path.name, 'rowsRead': count, 'phase': 'staging'}), flush=True)
        source_rows[path.name] = count
        print(_json({'file': path.name, 'rows': count, 'duplicateRowsRemoved': duplicates}), flush=True)
    connection.executescript('CREATE INDEX events_day ON events(customer,date,stamp); CREATE INDEX calls_day ON calls(customer,date);')
    connection.commit()
    return source_rows, schemas, duplicates, invalid_rows, invalid_timestamps, revision


def _station_indices(stations):
    by_station, by_cell = defaultdict(list), defaultdict(list)
    for index, station in enumerate(stations):
        by_station[station['baseStationId']].append(index)
        if station['cellId']:
            by_cell[station['cellId']].append(index)
    return by_station, by_cell


def _match_station(mdt, stations, indices, schema=None):
    by_station, by_cell = indices
    station_candidates = by_station.get(mdt['baseStationId'], [])
    # TXT station matching does not assert any independent cell/frequency identity.
    exact_station = [index for index in station_candidates if stations[index].get('matchLevel') == 'station'] if schema != 'legacy' else []
    if exact_station:
        return exact_station if len(exact_station) == 1 else []
    if schema == 'new':
        return []
    candidates = by_cell.get(mdt['cellId'], [])
    matched = [index for index in candidates if (not mdt['baseStationId'] or stations[index]['baseStationId'] == mdt['baseStationId'])
               and (stations[index]['frequency'] is None or mdt['frequency'] is None or stations[index]['frequency'] == mdt['frequency'])]
    return matched if len(matched) == 1 else []


def _day_output(connection, customer, date, stations, station_indices, gnss_crs='EPSG:5179', master_override=False):
    calls = {row[0]: json.loads(row[1]) for row in connection.execute('SELECT id,payload FROM calls WHERE customer=? AND date=? ORDER BY id', (customer, date))}
    records = defaultdict(list)
    events = []
    coverage = Counter({field: 0 for field in COVERAGE_FIELDS})
    matched_stations, used_indices, unmatched_stations = set(), set(), set()
    for call_id, payload in connection.execute('SELECT call_id,payload FROM events WHERE customer=? AND date=? ORDER BY stamp,call_id', (customer, date)):
        event = json.loads(payload)
        call = calls[call_id]
        stamp = parse_timestamp(event['timestamp'])
        start, end = parse_timestamp(call.get('startTimestamp')), parse_timestamp(call.get('endTimestamp'))
        in_window = bool(start and end and start <= stamp < end.replace(microsecond=0) + timedelta(seconds=1))
        event['mdt']['inCallWindow'] = in_window
        matched = _match_station(event['mdt'], stations, station_indices, None if master_override else event['schema'])
        event['mdt']['baseStationMatched'] = bool(matched)
        event['mdt']['masterMatchLevel'] = ('station' if stations[matched[0]].get('matchLevel') == 'station' else 'cell') if matched else 'unmatched'
        radio = any(event[field] is not None for field in ('rsrp', 'rsrq', 'nsinr'))
        gnss = all(event['mdt'][field] is not None and event['mdt'][field] != 0 for field in ('gnssUtmkx', 'gnssUtmky'))
        event['latitude'], event['longitude'] = None, None
        if gnss_crs != 'unknown':
            from mdt_gnss import convert_gnss
            coordinates = convert_gnss(event['mdt']['gnssUtmkx'], event['mdt']['gnssUtmky'], gnss_crs)
            event['mdt']['gnssCrs'] = gnss_crs
            if coordinates:
                event['latitude'], event['longitude'] = coordinates
                event['mdt']['locationSource'] = 'gnss'
        converted = event['latitude'] is not None
        coverage['totalEvents'] += 1
        coverage['radioEvents'] += int(radio)
        coverage['inCallRadioEvents'] += int(radio and in_window)
        coverage['outsideCallRadioEvents'] += int(radio and not in_window)
        coverage['stationMatchedEvents' if matched else 'stationUnmatchedEvents'] += 1
        if radio:
            coverage['stationMatchedRadioEvents' if matched else 'stationUnmatchedRadioEvents'] += 1
        coverage['gnssPairsEvents'] += int(gnss)
        coverage['gnssPairsRadioEvents'] += int(gnss and radio)
        coverage['gnssConvertedEvents'] += int(converted)
        coverage['gnssConvertedRadioEvents'] += int(converted and radio)
        coverage['inCallGnssConvertedEvents'] += int(converted and in_window)
        coverage['eventsWithoutLocationInput'] += int(not gnss and not matched)
        coverage['radioEventsWithoutLocationInput'] += int(radio and not gnss and not matched)
        if matched:
            used_indices.update(matched)
            matched_stations.add(event['mdt']['baseStationId'])
        elif event['mdt']['baseStationId']:
            unmatched_stations.add(event['mdt']['baseStationId'])
        records[call_id].append(event)
        events.append((call_id, event))
    for ordinal, (call_id, call) in enumerate(calls.items(), 1):
        call_events = records[call_id]
        in_window_radio = [event for event in call_events if event['mdt']['inCallWindow'] and any(event[field] is not None for field in ('rsrp', 'rsrq', 'nsinr'))]
        averages = {}
        for field, output_name in (('rsrp', 'rsrp'), ('rsrq', 'rsrq'), ('nsinr', 'sinr')):
            values = [event[field] for event in in_window_radio if event[field] is not None]
            averages[output_name] = round(fmean(values), 4) if values else None
        pcis = Counter(event['pci'] for event in in_window_radio if event['pci'] is not None)
        call.update(ci=str(ordinal), qoe=score(in_window_radio), **averages, mos=None,
                    pci=pcis.most_common(1)[0][0] if pcis else None, site=SITE,
                    mdtCount=len(call_events), radioCount=sum(any(event[field] is not None for field in ('rsrp', 'rsrq', 'nsinr')) for event in call_events),
                    qoeSampleCount=len(in_window_radio), hasMdt=bool(call_events))
    samples = []
    for call_id, event in events:
        call = calls[call_id]
        samples.append([event['second'], event['time'], event['latitude'], event['longitude'], SITE, 'unknown', '', '', 'LTE',
                        event['pci'], event['rsrp'], event['rsrq'], event['nsinr'], None, None, None,
                        call['qoe'], 'unknown', '정보 없음', call_id, call['ci'], event['mdt']])
    output = {'key': customer + ':' + date, 'customerId': customer, 'date': date, 'service': 'Voice',
              'sampleCount': len(samples), 'callCount': len(calls), 'sites': [SITE], 'rats': ['LTE'],
              'gnssSampleCount': coverage['inCallGnssConvertedEvents'], 'qoeSampleCount': coverage['inCallRadioEvents'],
              'areaTypes': ['unknown'], 'samples': samples, 'calls': list(calls.values()),
              'baseStations': [stations[index] for index in sorted(used_indices)],
              'callMeta': {call_id: {key: call[key] for key in ('start', 'end', 'startTimestamp', 'endTimestamp', 'reportedMdtCount', 'mdtCount', 'radioCount', 'qoeSampleCount') if key in call} for call_id, call in calls.items()},
              'coverage': {**dict(coverage), 'matchedBaseStationCount': len(matched_stations), 'unmatchedBaseStationIds': sorted(unmatched_stations)},
              'unscoredCalls': sum(call['qoe'] is None for call in calls.values())}
    source_contract = connection.execute('SELECT source_contract FROM customers WHERE id=?', (customer,)).fetchone()[0]
    if source_contract:
        output['sourceContractId'] = source_contract
    return output, coverage, matched_stations, unmatched_stations


def _remove_pending_partition(pending, partition_root):
    resolved = pending.resolve()
    if resolved.parent != partition_root.resolve() or not resolved.name.startswith('.tmp-'):
        raise ValueError('임시 MDT 출력 경로가 출력 폴더를 벗어남')
    shutil.rmtree(resolved)


def _publish(connection, output, source_rows, schemas, duplicates, invalid_rows, invalid_timestamps, revision_hash, masters, master_errors, master_sources, gnss_crs, master_override):
    output.parent.mkdir(parents=True, exist_ok=True)
    partition_root = output.parent / 'mdt-data'
    partition_root.mkdir(exist_ok=True)
    revision = revision_hash.hexdigest()[:20]
    destination = partition_root / revision
    pending = partition_root / ('.tmp-' + uuid.uuid4().hex)
    resolved_root = partition_root.resolve()
    if destination.resolve().parent != resolved_root or pending.resolve().parent != resolved_root:
        raise ValueError('MDT 분할 출력 경로가 출력 폴더를 벗어남')
    pending.mkdir()
    customers, days = {}, []
    overall_coverage = Counter({field: 0 for field in COVERAGE_FIELDS})
    matched, unmatched = set(), set()
    total_calls = unscored = 0
    indices = _station_indices(masters)
    try:
        for customer, date in connection.execute('SELECT DISTINCT customer,date FROM calls ORDER BY customer,date'):
            day, coverage, day_matched, day_unmatched = _day_output(connection, customer, date, masters, indices, gnss_crs, master_override)
            filename = customer + '-' + date + '.json'
            (pending / filename).write_text(_json(day), encoding='utf-8')
            entry = {key: day[key] for key in ('key', 'customerId', 'date', 'service', 'sampleCount', 'callCount', 'gnssSampleCount', 'qoeSampleCount', 'sites', 'rats', 'areaTypes', 'sourceContractId') if key in day}
            entry.update(samples=[], dataPath=f'mdt-data/{revision}/{filename}')
            days.append(entry)
            if customer not in customers:
                customers[customer] = {'id': customer, 'displayName': '가입자 ' + customer.split('-', 1)[1][:8],
                                       'maskedPhone': '계약번호 기반 익명 ID', 'dates': [], 'sampleCount': 0, 'callCount': 0,
                                       'gnssSampleCount': 0, 'qoeSampleCount': 0, 'hasName': False}
                if 'sourceContractId' in day:
                    customers[customer].update(sourceContractId=day['sourceContractId'], displayName='계약 ' + day['sourceContractId'],
                                               maskedPhone='서비스계약번호 기준')
            customers[customer]['dates'].append(date)
            customers[customer]['sampleCount'] += day['sampleCount']
            customers[customer]['callCount'] += day['callCount']
            customers[customer]['gnssSampleCount'] += day['gnssSampleCount']
            customers[customer]['qoeSampleCount'] += day['qoeSampleCount']
            total_calls += day['callCount']
            unscored += day['unscoredCalls']
            overall_coverage.update(coverage)
            matched.update(day_matched)
            unmatched.update(day_unmatched)
        overall_coverage.update({'matchedBaseStationCount': len(matched), 'unmatchedBaseStationCount': len(unmatched)})
        coverage_meta = dict(overall_coverage)
        coverage_meta['unmatchedBaseStationIds'] = sorted(unmatched)
        meta = {'schemaVersion': 'mdt-v2', 'partitioned': True, 'revision': revision,
                'sourceFiles': list(source_rows), 'sourceRows': source_rows,
                'dates': sorted({day['date'] for day in days}), 'source': 'MDT',
                'inputSchemas': sorted(schemas), 'poorQoeThreshold': 2.5,
                'qoeBasis': 'call-radio-estimate', 'qoeWindow': 'start-through-entire-end-second',
                'fixedLocation': False, 'frequencyEncoding': 'unknown', 'gnssCrs': gnss_crs,
                'coordinateNotes': ('사용자가 확인한 UTMK / EPSG:5179에서 위경도로 변환; GNSS 기록의 측정 정확도는 별도 확인' if gnss_crs != 'unknown'
                                    else '명시적으로 위경도 변환 비활성; 원본 GNSS X/Y 보존'),
                'gnssSampleCountDefinition': 'valid-converted-gnss-within-call-window',
                'qoeSampleCountDefinition': 'radio-events-within-call-window',
                'sampleFields': SAMPLE_FIELDS,
                'classification': {'measured': ['rsrp', 'rsrq', 'sinr', 'pci', 'phr', 'neighbors', 'gnssUtmkx', 'gnssUtmky'],
                                   'derived': ['QoE'], 'estimated': ['location']},
                'baseStations': masters, 'masterErrors': master_errors, 'masterSources': master_sources,
                'totalCalls': total_calls, 'unscoredCalls': unscored, 'duplicateRows': duplicates,
                'dedupe': {'strategy': 'exact-row-across-inputs', 'duplicateRowsRemoved': duplicates,
                           'uniqueRows': sum(source_rows.values()) - duplicates},
                'invalidCallRows': invalid_rows, 'invalidTimestampRows': invalid_timestamps,
                'coverage': coverage_meta}
        manifest = {'meta': meta, 'customers': list(customers.values()), 'days': days}
        # Write complete immutable partitions before the single manifest switch.
        if destination.exists():
            _remove_pending_partition(pending, partition_root)
        else:
            pending.replace(destination)
        temporary_manifest = output.with_name('.' + output.name + '.' + uuid.uuid4().hex + '.tmp')
        try:
            with temporary_manifest.open('w', encoding='utf-8', newline='') as handle:
                handle.write(_json(manifest))
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary_manifest, output)
        finally:
            if temporary_manifest.exists():
                temporary_manifest.unlink()
    finally:
        if pending.exists():
            _remove_pending_partition(pending, partition_root)
    return {'MDT_rows': sum(source_rows.values()), 'events': overall_coverage['totalEvents'],
            'source_calls': total_calls, 'unscored_calls': unscored, 'customers': len(customers),
            'duplicate_rows_removed': duplicates, 'revision': revision, 'manifest': str(output)}


def extract(source_dir, output=Path('public/mdt-data.json'), master_path=None, staging_dir=None, gnss_crs='EPSG:5179'):
    source_dir, output = Path(source_dir), Path(output)
    gnss_crs = gnss_crs or 'unknown'
    if gnss_crs not in ('unknown', 'EPSG:5179'):
        raise ValueError('지원하지 않는 GNSS 좌표계')
    if not source_dir.is_dir():
        raise ValueError(f'MDT 입력 폴더 없음: {source_dir}')
    paths = [path for path in sorted(source_dir.glob('*.xlsx')) if not path.name.startswith('~$')]
    if not paths:
        raise ValueError(f'MDT Excel 파일 없음: {source_dir}')
    if staging_dir:
        Path(staging_dir).mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='mdt-private-', dir=staging_dir) as temporary:
        connection = sqlite3.connect(str(Path(temporary) / 'staging.sqlite3'))
        try:
            _create_staging(connection)
            source_rows, schemas, duplicates, invalid_rows, invalid_timestamps, revision = _stage(connection, paths)
            revision.update(_json({'sourceRows': source_rows, 'gnssCrs': gnss_crs, 'masterOverride': bool(master_path)}).encode('utf-8'))
            if master_path:
                master_paths = [Path(master_path)]
            else:
                master_paths = []
                if 'new' in schemas:
                    master_paths.append(Path('data/BaseStation/BaseStation_new.txt'))
                if 'legacy' in schemas:
                    master_paths.append(Path('data/BaseStation/virtual_base_station.csv'))
            masters, master_errors, master_sources = [], [], []
            for path in master_paths:
                stations, errors = load_master(path)
                masters.extend(stations)
                master_errors.extend(errors)
                master_sources.append(path.name)
                revision.update(path.read_bytes() if path.exists() else b'master-missing')
            return _publish(connection, output, source_rows, schemas, duplicates, invalid_rows,
                            invalid_timestamps, revision, masters, master_errors, master_sources, gnss_crs, bool(master_path))
        finally:
            connection.close()
