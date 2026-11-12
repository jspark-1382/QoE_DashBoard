"""Build the 2026-10-26 through 2026-10-30 voice-quality dashboard.

CDR MOS(v5) is the sole per-call MOS authority. MDT is optional radio
evidence and joins only through unambiguous service-contract/time criteria.
Source workbooks stay read-only; outputs publish atomically by revision.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import shutil
import sys
import uuid
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from statistics import fmean

from mdt_pipeline import read_rows, normalize, numeric, parse_timestamp, _match_station, _station_indices
from base_station_master import load_master
from lte_station_catalog import load_lte_catalog, resolve_lte_master
from nr_station_catalog import resolve_nr_master
from mdt_gnss import convert_gnss
from voice_xlsx_rows import cdr_rows

KST = timezone(timedelta(hours=9))
FIELDS = ['second', 'time', 'lat', 'lon', 'site', 'areaType', 'floorCode',
          'floorName', 'rat', 'pci', 'rsrp', 'rsrq', 'sinr', 'mos', 'jitter',
          'delay', 'qoe', 'cause', 'morphology', 'callId', 'ci', 'mdt']
BAD = {'', '_', 'NULL', 'NAN', 'NONE', 'N/A'}
MATCH_TOLERANCE_SEC = 30
SIP_DROP_QOE_PENALTY = 2.5


def derive_call_qoe(original_mos, sip_reason):
    """Use original RTCP MOS(v5), penalize SIP Drop, preserve raw MOS."""
    if not isinstance(original_mos, (int, float)) or not math.isfinite(original_mos) or not 1 <= original_mos <= 5:
        return None
    reason = (sip_reason or '').strip()
    is_drop = (re.search(r'(?:^|[\^\s/;,])H\s*(?::\s*Drop\b|(?=\^|$))', reason, re.I)
               or re.search(r'(?:^|[\s:;/])Drop\b', reason, re.I))
    return round(original_mos - SIP_DROP_QOE_PENALTY, 6) if is_drop else original_mos


DEFAULT_DATES = ('2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30')


def selected_dates(value: str):
    if value in ('all','2026-10-26:2026-10-30'):
        return set(DEFAULT_DATES)
    if value in DEFAULT_DATES:
        return {value}
    raise ValueError('분석 날짜는 all 또는 2026-10-26~2026-10-30 단일 날짜여야 합니다.')



def clean(value):
    if value is None:
        return ''
    v = str(value).strip()
    return '' if v.upper() in BAD else v


def value_number(value):
    n = numeric(value)
    return n if n is not None and math.isfinite(n) else None


def mos_number(value):
    n = value_number(value)
    return n if n is not None and 1 <= n <= 5 else None


def source_field(row, name):
    # Column names are numbered in the actual 2026-10-30 SIP file.
    return row.get(name)


def end_rat_from_pani(value):
    """Return only an explicit end-access RAT; do not infer it from radio or start access."""
    access = clean(value).split(';', 1)[0].strip().upper()
    if access in ('3GPP-NR-TDD', '3GPP-NR-FDD'):
        return 'NR'
    if access in ('3GPP-E-UTRAN-TDD', '3GPP-E-UTRAN-FDD'):
        return 'LTE'
    return None


def resolve_optional_nr_master(path=None, directory=None):
    """An absent optional NR file is allowed; explicit CLI/environment choices must exist."""
    required = path is not None or bool(os.environ.get('QOE_NR_MASTER'))
    try:
        return resolve_nr_master(path, directory)
    except FileNotFoundError:
        if required:
            raise
        return None


def iso_kst(value):
    if not isinstance(value, datetime):
        return None
    return value.replace(tzinfo=KST) if value.tzinfo is None else value.astimezone(KST)


def sha_key(*parts):
    return hashlib.sha256(json.dumps(parts, ensure_ascii=False, separators=(',', ':')).encode('utf-8')).hexdigest()[:24]


def file_revision(paths, config):
    sha = hashlib.sha256(json.dumps(config, sort_keys=True).encode())
    for path in paths:
        sha.update(path.name.encode('utf-8'))
        with path.open('rb') as inp:
            while True:
                piece = inp.read(1024 * 1024)
                if not piece:
                    break
                sha.update(piece)
    return sha.hexdigest()[:20]


def file_sha256(path):
    sha = hashlib.sha256()
    with path.open('rb') as inp:
        for piece in iter(lambda: inp.read(1024 * 1024), b''):
            sha.update(piece)
    return sha.hexdigest()


def read_cdr(cdr_path, target_date, *, seen=None, identity_source=None):
    dates = selected_dates(target_date)
    required = ['4. START TIME', '5. END TIME', '140. RTCP MOS(v5)',
                'E2. svc_cont_id', 'E3. Call_ID_edit']
    columns = set(required) | {'6. CALL TIME(sec)', '76. BYE CELL ID', '75. BYE 200OK CELL ID',
        '73. BYE P-Access-Network-Info', '72. BYE 200OK P-Access Network-Info',
        '74. User start CELL ID', '139. INVITE CELL ID', '10. RESULT', '11. REASON',
        '109. SIP Fail Response Code', '13. Release Cause', '9. CALL DIR',
        '59. Audio Tx jitter', '60. Audio Rx jitter', '63. Audio Tx Packetloss',
        '64. Audio Rx Packetloss', '131. RTP Audio Tx Loss CNT', '132. RTP Audio Rx Loss CNT'}
    calls = []
    audit = Counter()
    occurrences = Counter()
    for row_number, row, fingerprint in cdr_rows(cdr_path, required, columns):
        audit['inputRows'] += 1
        start = iso_kst(source_field(row, '4. START TIME'))
        end = iso_kst(source_field(row, '5. END TIME'))
        if start is None or start.date().isoformat() not in dates:
            audit['excludedDifferentDateOrTime'] += 1
            continue
        day = start.date().isoformat()
        contract = clean(source_field(row, 'E2. svc_cont_id'))
        if not contract:
            audit['excludedMissingContract'] += 1
            continue
        if seen is not None:
            occurrences[fingerprint] += 1
            if occurrences[fingerprint] <= seen.get(fingerprint, 0):
                audit['excludedCrossFileDuplicates'] += 1
                continue
        audit['published_'+day] += 1
        if end is None or end < start:
            end = start + timedelta(seconds=max(0, value_number(source_field(row, '6. CALL TIME(sec)')) or 0))
            audit['endTimeRepaired'] += 1
        mos = mos_number(source_field(row, '140. RTCP MOS(v5)'))
        status = 'VALID' if mos is not None else 'MISSING'
        if status == 'MISSING':
            audit['missingOrInvalidMos'] += 1
        elif mos < 3:
            audit['poorMos'] += 1
        elif mos < 3.5:
            audit['warningMos'] += 1
        else:
            audit['goodMos'] += 1
        # CDR CALL ID and EDIT CALL ID are not guaranteed unique; never group by either.
        identity = ['cdr-leg', contract, start.isoformat(), end.isoformat(),
                    clean(source_field(row, 'E3. Call_ID_edit')), row_number]
        if identity_source is not None:
            identity.append(identity_source)
        call_id = 'call-' + sha_key(*identity)
        bye_cell = clean(source_field(row, '76. BYE CELL ID'))
        ack_cell = clean(source_field(row, '75. BYE 200OK CELL ID'))
        # Match the RAT to the same source message as the published end Cell.
        # A start-access flag or another message's PANI may describe a different RAT.
        end_rat = end_rat_from_pani(source_field(row, '73. BYE P-Access-Network-Info')) if bye_cell else (
            end_rat_from_pani(source_field(row, '72. BYE 200OK P-Access Network-Info')) if ack_cell else None
        )
        calls.append({
            'id': call_id,
            'customerId': 'mdt-' + sha_key('mdt', contract),
            'contract': contract,
            'date': day,
            'startDt': start,
            'endDt': end,
            'editedKey': clean(source_field(row, 'E3. Call_ID_edit')),
            'startCellId': clean(source_field(row, '74. User start CELL ID')) or clean(source_field(row, '139. INVITE CELL ID')),
            'endCellId': bye_cell or ack_cell,
            'endRat': end_rat,
            'mos': mos,
            'mosStatus': status,
            'endType': clean(source_field(row, '10. RESULT')),
            'sipCause': clean(source_field(row, '11. REASON')) or clean(source_field(row, '109. SIP Fail Response Code')),
            'q850Cause': clean(source_field(row, '13. Release Cause')),
            'direction': clean(source_field(row, '9. CALL DIR')),
            'rtp': {
                'txJitter': value_number(source_field(row, '59. Audio Tx jitter')),
                'rxJitter': value_number(source_field(row, '60. Audio Rx jitter')),
                'txPacketLoss': value_number(source_field(row, '63. Audio Tx Packetloss')),
                'rxPacketLoss': value_number(source_field(row, '64. Audio Rx Packetloss')),
                'txLossCount': value_number(source_field(row, '131. RTP Audio Tx Loss CNT')),
                'rxLossCount': value_number(source_field(row, '132. RTP Audio Rx Loss CNT')),
            },
        })
        audit['publishedCalls'] += 1
    if seen is not None:
        for fingerprint, count in occurrences.items():
            seen[fingerprint] = max(count, seen.get(fingerprint, 0))
    return calls, audit


def discover_sources(root):
    files = [p for p in root.glob('*.xlsx') if not p.name.startswith('~$')]
    def ordered(paths):
        return sorted(paths, key=lambda p: (not p.name.startswith('261026_1030_'), p.name.casefold()))
    return (ordered([p for p in files if 'sip_call' in p.name.casefold()]),
            ordered([p for p in files if 'volte+mdt' in p.name.casefold()]))


def read_cdr_files(paths, target_date):
    calls, seen, totals, sources = [], {}, Counter(), []
    for index, path in enumerate(paths):
        print(json.dumps({'phase': 'read-cdr', 'file': path.name}, ensure_ascii=False), flush=True)
        rows, audit = read_cdr(path, target_date, seen=seen, identity_source=path.name if index else None)
        calls.extend(rows)
        totals.update(audit)
        sources.append({'file': path.name, 'bytes': path.stat().st_size, **dict(audit)})
        print(json.dumps({'phase': 'cdr-complete', 'file': path.name, **dict(audit)}, ensure_ascii=False), flush=True)
    return calls, totals, sources


def read_mdt(mdt_path, target_date, cdr_contracts=None):
    dates = selected_dates(target_date)
    groups = {}
    audit = Counter()
    for row in read_rows(mdt_path):
        audit['inputRows'] += 1
        # The 541k-event source is an area-wide partial MDT cohort; parse
        # expensive timestamps/events only for dates and contracts present in
        # the CDR scope. Other contracts cannot legally match any CDR leg.
        raw_date = clean(row.get('base_date'))
        if len(raw_date)==8 and raw_date.isdigit():
            normalized_date = raw_date[:4]+'-'+raw_date[4:6]+'-'+raw_date[6:8]
            if normalized_date not in dates:
                audit['excludedDifferentDate'] += 1
                continue
        if cdr_contracts is not None and clean(row.get('svc_cont_id')) not in cdr_contracts:
            audit['excludedNoCdrContract'] += 1
            continue
        try:
            date_key, customer_id, call, event, ims, modern, contract = normalize(row)
        except ValueError:
            audit['invalidRows'] += 1
            continue
        if date_key not in dates:
            audit['excludedDifferentDate'] += 1
            continue
        key = (date_key,contract, clean(row.get('lte_vc_div')))
        if not contract or not key[2]:
            audit['invalidKeys'] += 1
            continue
        group = groups.setdefault(key, {
            'date': date_key,
            'contract': contract,
            'mdtCallKey': key[2],
            'call': call,
            'events': [],
        })
        if event is not None:
            group['events'].append(event)
            audit['events'] += 1
        audit['publishedRows'] += 1
    return list(groups.values()), audit


def read_mdt_files(paths, target_date, cdr_contracts=None):
    groups, event_sources, totals, sources = {}, {}, Counter(), []
    for source_index, path in enumerate(paths):
        print(json.dumps({'phase': 'read-mdt', 'file': path.name}, ensure_ascii=False), flush=True)
        incoming, audit = read_mdt(path, target_date, cdr_contracts)
        for group in incoming:
            key = (group['date'], group['contract'], group['mdtCallKey'],
                   group['call'].get('startTimestamp'), group['call'].get('endTimestamp'))
            target = groups.setdefault(key, {**group, 'events': []})
            for event in group['events']:
                fingerprint = sha_key(key, event)
                previous = event_sources.setdefault(fingerprint, source_index)
                if previous != source_index:
                    audit['excludedCrossFileDuplicateEvents'] += 1
                    continue
                target['events'].append(event)
        totals.update(audit)
        sources.append({'file': path.name, 'bytes': path.stat().st_size, **dict(audit)})
        print(json.dumps({'phase': 'mdt-complete', 'file': path.name, **dict(audit)}, ensure_ascii=False), flush=True)
    totals['uniqueEvents'] = sum(len(g['events']) for g in groups.values())
    return list(groups.values()), totals, sources


def start_timestamp(group):
    return parse_timestamp(group['call'].get('startTimestamp'))


def build_candidate_maps(calls, mdt_groups, tolerance):
    cdr_contract = defaultdict(list)
    for idx, call in enumerate(calls):
        cdr_contract[call['contract']].append(idx)
    cdr_to_mdt, mdt_to_cdr = defaultdict(list), defaultdict(list)
    for mi, group in enumerate(mdt_groups):
        start = start_timestamp(group)
        if start is None:
            continue
        for ci in cdr_contract.get(group['contract'], ()):
            call = calls[ci]
            if call['date'] != group['date']:
                continue
            seconds = abs((call['startDt'] - start).total_seconds())
            if seconds > tolerance:
                continue
            # This yields CANDIDATES, not proof. One-to-one exclusivity is required below.
            cdr_to_mdt[ci].append((mi, seconds))
            mdt_to_cdr[mi].append((ci, seconds))
    matched = {}
    audit = Counter()
    for ci, call in enumerate(calls):
        candidates = cdr_to_mdt.get(ci, [])
        if not candidates:
            call['matchStatus'] = 'UNMATCHED'
            audit['cdrUnmatched'] += 1
        elif len(candidates) == 1 and len(mdt_to_cdr[candidates[0][0]]) == 1:
            mi, seconds = candidates[0]
            matched[ci] = mi
            call['matchStatus'] = 'MATCHED'
            call['matchDeltaSec'] = seconds
            audit['cdrMatched'] += 1
        else:
            call['matchStatus'] = 'AMBIGUOUS'
            audit['cdrAmbiguous'] += 1
    audit['mdtCalls'] = len(mdt_groups)
    audit['mdtMatched'] = len(set(matched.values()))
    audit['mdtUnlinked'] = len(mdt_groups) - audit['mdtMatched']
    audit['cdrCandidateCalls'] = sum(bool(cdr_to_mdt.get(i)) for i in range(len(calls)))
    return matched, audit


def normalize_sample(event, call_id, ci, mos, stations, indices):
    md = event['mdt']
    station_indexes = _match_station(md, stations, indices, 'new')
    md['baseStationMatched'] = bool(station_indexes)
    md['masterMatchLevel'] = (
        stations[station_indexes[0]].get('matchLevel','station')
        if len(station_indexes) == 1 else 'unmatched'
    )
    if len(station_indexes)==1:
        md['masterInventorySource'] = stations[station_indexes[0]].get('inventorySource','legacy-station-text')
    lat, lon = (None, None)
    if md.get('gnssUtmkx') is not None and md.get('gnssUtmky') is not None:
        coord = convert_gnss(md['gnssUtmkx'], md['gnssUtmky'], 'EPSG:5179')
        if coord:
            lat, lon = coord
            md['locationSource'] = 'gnss'
    md['gnssCrs'] = 'EPSG:5179'
    return [
        event['second'], event['time'], lat, lon, '지역 정보 없음',
        'unknown', '', '', 'LTE', event['pci'], event['rsrp'], event['rsrq'],
        event['nsinr'], None, None, None, mos, 'unknown', '정보 없음',
        call_id, str(ci), md,
    ], station_indexes


def as_day(customer_id, contract, group, stations, station_indices):
    # A customer can have many CDR calls; location data only exists for confirmed matches.
    records = sorted(group, key=lambda c: (c['startDt'], c['id']))
    samples = []
    calls_out = []
    station_used = set()
    gnss_in_call = 0
    for n, call in enumerate(records, 1):
        matched_group = call.get('matchedGroup')
        events = sorted(matched_group['events'], key=lambda e: e['timestamp']) if matched_group else []
        start, end = call['startDt'], call['endDt']
        radio_events = []
        has_gnss = 0
        for event in events:
            stamp = parse_timestamp(event['timestamp'])
            if not stamp or stamp < start or stamp > end + timedelta(seconds=1):
                continue
            if any(event[field] is not None for field in ('rsrp', 'rsrq', 'nsinr')):
                radio_events.append(event)
            sample, ids = normalize_sample(event, call['id'], n, call['mos'], stations, station_indices)
            samples.append(sample)
            station_used.update(ids)
            if sample[2] is not None:
                has_gnss += 1
        gnss_in_call += has_gnss
        def mean(key):
            values = [event[key] for event in radio_events if event[key] is not None]
            return round(fmean(values), 3) if values else None
        pcis = Counter(e['pci'] for e in radio_events if e['pci'] is not None)
        calls_out.append({
            'id': call['id'],
            'ci': str(n),
            'start': start.strftime('%H:%M:%S'),
            'end': end.strftime('%H:%M:%S'),
            'startTimestamp': start.isoformat(),
            'endTimestamp': end.isoformat(),
            'durationSeconds': round((end-start).total_seconds(), 3),
            'startCellId': call['startCellId'],
            'endCellId': call['endCellId'],
            'endRat': call.get('endRat'),
            'qoe': derive_call_qoe(call['mos'], call['sipCause']),  # SIP Drop penalty; MOS(v5) remains original
            'mos': call['mos'],
            'mosV5Original': call['mos'],
            'mosStatus': call['mosStatus'],
            'mosAlgorithmVersion': 'RTCP_MOS_V5',
            'rtp': call['rtp'],
            'matchStatus': call['matchStatus'],
            'matchDeltaSec': call.get('matchDeltaSec'),
            'mdtCount': len(events),
            'radioCount': len(radio_events),
            'qoeSampleCount': len(radio_events),
            'hasMdt': bool(matched_group),
            'rsrp': mean('rsrp'),
            'rsrq': mean('rsrq'),
            'sinr': mean('nsinr'),
            'pci': pcis.most_common(1)[0][0] if pcis else None,
            'site': '지역 정보 없음',
            'endType': call['endType'],
            'sipCause': call['sipCause'],
            'q850Cause': call['q850Cause'],
            'fc': '',
            'direction': call['direction'],
        })
    return {
        'key': customer_id + ':' + records[0]['date'],
        'customerId': customer_id,
        'sourceContractId': contract,
        'date': records[0]['date'],
        'service': 'Voice',
        'sampleCount': len(samples),
        'callCount': len(calls_out),
        'gnssSampleCount': gnss_in_call,
        'qoeSampleCount': sum(c['qoeSampleCount'] for c in calls_out),
        'sites': ['지역 정보 없음'],
        'rats': ['LTE'],
        'areaTypes': ['unknown'],
        'samples': samples,
        'calls': calls_out,
        'baseStations': [stations[i] for i in sorted(station_used)],
        'unscoredCalls': sum(c['mos'] is None for c in records),
    }


def publish(calls, stations, audit, output, revision):
    root = output.parent
    partition_root = root / 'voice-1030-data'
    partition_root.mkdir(parents=True, exist_ok=True)
    destination = partition_root / revision
    pending = partition_root / ('.tmp-' + uuid.uuid4().hex)
    if pending.resolve().parent != partition_root.resolve() or not pending.name.startswith('.tmp-'):
        raise ValueError('Unsafe temporary partition directory')
    pending.mkdir(parents=True)
    groups = defaultdict(list)
    for call in calls:
        groups[(call['customerId'], call['date'], call['contract'])].append(call)
    customers_by_id = {}
    days = []
    try:
        indices = _station_indices(stations)
        for (customer_id, date_key, contract), group in sorted(groups.items()):
            detail = as_day(customer_id, contract, group, stations, indices)
            filename = f'{customer_id}-{date_key}.json'
            (pending / filename).write_text(json.dumps(detail, ensure_ascii=False, separators=(',', ':'), allow_nan=False), encoding='utf-8')
            days.append({
                'key': detail['key'], 'customerId': customer_id, 'date': date_key,
                'sourceContractId': contract, 'sampleCount': detail['sampleCount'],
                'callCount': detail['callCount'], 'gnssSampleCount': detail['gnssSampleCount'],
                'qoeSampleCount': detail['qoeSampleCount'], 'sites': detail['sites'],
                'rats': detail['rats'], 'areaTypes': detail['areaTypes'],
                'dataPath': f'voice-1030-data/{revision}/{filename}', 'samples': [],
            })
            if len(days) % 10000 == 0:
                print(json.dumps({'phase': 'partitions', 'written': len(days)}, ensure_ascii=False), flush=True)
            customer = customers_by_id.setdefault(customer_id, {
                'id': customer_id,
                'displayName': '계약 ' + contract,
                'maskedPhone': '서비스계약번호 기준',
                'sourceContractId': contract,
                'dates': [],
                'sampleCount': 0,
                'callCount': 0,
                'gnssSampleCount': 0,
                'qoeSampleCount': 0,
            })
            customer['dates'].append(date_key)
            for key in ('sampleCount','callCount','gnssSampleCount','qoeSampleCount'):
                customer[key] += detail[key]
        customers = list(customers_by_id.values())
        for customer in customers:
            customer['dates'].sort(reverse=True)
        meta = {
            'schemaVersion': 'voice-1030-v1', 'partitioned': True, 'revision': revision,
            'source': 'MDT', 'dates': sorted({call['date'] for call in calls}),
            'sourceFiles': audit.get('sourceFiles', [audit['cdrFile'], audit['mdtFile']]),
            **({'sourceWorkbookAudit': audit['sourceWorkbookAudit']} if 'sourceWorkbookAudit' in audit else {}),
            'stationInventory': {
                'file': audit['lteMasterFile'], 'sha256': audit['lteMasterSha256'],
                'pciColumnPresent': audit['lteMasterAudit']['pciColumnPresent'],
            },
            **({'byeStationInventories': [
                {'technology': 'LTE', 'file': audit['lteMasterFile'], 'sha256': audit['lteMasterSha256']},
                {'technology': 'NR', 'file': audit['nrMasterFile'], 'sha256': audit['nrMasterSha256']},
            ]} if audit.get('nrMasterFile') else {}),
            'poorQoeThreshold': 3.0, 'mosPoorThreshold': 3.0,
            'mosWarningThreshold': 3.5,
            'qoeBasis': 'rtcp-mos-v5', 'mosAlgorithmVersion': 'RTCP_MOS_V5',
            'mosMissingPolicy': 'NO_IMPUTATION', 'gnssCrs': 'EPSG:5179',
            'sampleFields': FIELDS, 'baseStations': stations,
            'totalCalls': len(calls),
            'unscoredCalls': sum(c['mos'] is None for c in calls),
            'coverage': {k: v for k, v in audit.items() if isinstance(v, int)},
            'dataSelection': '2026-10-26-through-2026-10-30-start-time-only',
            'classification': {
                'measured': ['RTCP_MOS_V5', 'RTP', 'RSRP', 'RSRQ', 'SINR', 'PCI'],
                'derived': ['MOS_GRADE'],
                'estimated': ['location'],
            },
        }
        manifest = {'meta': meta, 'customers': customers, 'days': days}
        if destination.exists():
            shutil.rmtree(pending)
        else:
            pending.rename(destination)
        output.parent.mkdir(parents=True, exist_ok=True)
        tmp = output.with_name('.' + output.name + '.' + uuid.uuid4().hex + '.tmp')
        try:
            tmp.write_text(json.dumps(manifest, ensure_ascii=False, separators=(',', ':'), allow_nan=False), encoding='utf-8')
            os.replace(tmp, output)
        finally:
            if tmp.exists():
                tmp.unlink()
        return {'customers': len(customers), 'calls': len(calls), 'partitionFiles': len(days),
                'revision': revision, 'manifest': str(output)}
    finally:
        if pending.exists():
            shutil.rmtree(pending)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--cdr', type=Path, action='append', default=None)
    parser.add_argument('--mdt', type=Path, action='append', default=None)
    parser.add_argument('--master', type=Path, default=Path('data/BaseStation/BaseStation_new.txt'))
    parser.add_argument('--lte-master', type=Path, default=None,
                        help='RU+CellID 정확 매칭 인벤토리. 기본: QOE_LTE_MASTER 또는 최신 수도권_LTE_YYMMDD.xlsx')
    parser.add_argument('--nr-master', type=Path, default=None,
                        help='BYE 등록 위치용 선택 NR 인벤토리. 기본: QOE_NR_MASTER 또는 선택 LTE 폴더의 최신 5G 파일')
    parser.add_argument('--out', type=Path, default=Path('public/voice-1030.json'))
    parser.add_argument('--audit', type=Path, default=Path('outputs/voice-1030-quality-report.json'))
    parser.add_argument('--date', default='all',
                        help='all (Oct 26-30) or a single YYYY-MM-DD in that range')
    parser.add_argument('--match-seconds', type=int, default=MATCH_TOLERANCE_SEC)
    args = parser.parse_args()
    root = Path('data/MDT_New')
    discovered_cdr, discovered_mdt = discover_sources(root)
    cdr_files, mdt_files = args.cdr or discovered_cdr, args.mdt or discovered_mdt
    if not cdr_files or not mdt_files or any(not p.is_file() for p in [*cdr_files, *mdt_files]):
        parser.error('10월 26~30일 SIP CDR 및 VoLTE MDT 통합 파일을 찾지 못했습니다.')
    try:
        selected_dates(args.date)
    except ValueError as exc:
        parser.error(str(exc))
    if args.match_seconds < 0 or args.match_seconds > 60:
        parser.error('--match-seconds must be in [0, 60]')
    try:
        args.lte_master = resolve_lte_master(args.lte_master)
        args.nr_master = resolve_optional_nr_master(args.nr_master, args.lte_master.parent)
    except FileNotFoundError as exc:
        parser.error(str(exc))
    calls, cdr_audit, cdr_sources = read_cdr_files(cdr_files, args.date)
    mdt_groups, mdt_audit, mdt_sources = read_mdt_files(mdt_files, args.date, {call['contract'] for call in calls})
    matched, matching_audit = build_candidate_maps(calls, mdt_groups, args.match_seconds)
    for ci, mi in matched.items():
        calls[ci]['matchedGroup'] = mdt_groups[mi]
    legacy_present = args.master.is_file()
    legacy_stations, master_errors = load_master(args.master) if legacy_present else ([], [])
    requested_pairs = {
        (clean(event['mdt'].get('baseStationId')), clean(event['mdt'].get('cellId')))
        for ci in matched for event in calls[ci]['matchedGroup']['events']
        if clean(event['mdt'].get('baseStationId')) and clean(event['mdt'].get('cellId'))
    }
    # The full metro inventory stays on disk. Only MDT-observed RU+Cell rows
    # enter the client master, with source/provenance flags.
    exact_lte_stations, lte_audit = load_lte_catalog(
        args.lte_master, requested_pairs,
        {key for call in calls for key in (call['startCellId'], call['endCellId']) if key},
    )
    stations = exact_lte_stations + legacy_stations
    config = {'pipeline': 'voice-1026-1030-multi-source-v7', 'date': args.date,
              'toleranceSec': args.match_seconds, 'mosPoor': 3,
              'mosWarning': 3.5, 'masterJoin': 'ru+cell-exact-first',
              'byeSiteSelection': 'same-call-mdt-30s-then-first-valid-inventory-row'}
    master_sources = [args.lte_master] + ([args.nr_master] if args.nr_master is not None else []) + ([args.master] if legacy_present else [])
    revision = file_revision([*cdr_files, *mdt_files, *master_sources], config)
    audit = {
        'cdrFile': cdr_files[0].name, 'mdtFile': mdt_files[0].name,
        'sourceFiles': [p.name for p in [*cdr_files, *mdt_files]],
        'sourceWorkbookAudit': {'cdr': cdr_sources, 'mdt': mdt_sources},
        'date': args.date,
        'sourceCdr': dict(cdr_audit), 'sourceMdt': dict(mdt_audit),
        'matching': dict(matching_audit), 'masterStations': len(stations),
        'masterErrors': master_errors[:15],
        'masterSources': [path.name for path in master_sources],
        'legacyMasterPresent': legacy_present,
        'lteMasterFile': args.lte_master.name,
        'lteMasterSha256': file_sha256(args.lte_master),
        'lteMasterAudit':lte_audit,
        'nrMasterFile': args.nr_master.name if args.nr_master is not None else None,
        'nrMasterSha256': file_sha256(args.nr_master) if args.nr_master is not None else None,
        'noMdtCdrCalls':sum(call.get('matchStatus')!='MATCHED' for call in calls),
        'noMdtTrilaterationCalls':0,
        'noMdtPositionReason':'CDR only has start/end serving CELL ID; no simultaneous three-site RSRP',
        'mosThresholds': {'poorBelow': 3, 'warningBelow': 3.5, 'goodFrom': 3.5},
        'note': 'Temporal matches are accepted only when each CDR and MDT call has exactly one counterpart.',
    }
    print(json.dumps({'phase': 'publish', 'calls': len(calls), 'matched': len(matched)}, ensure_ascii=False), flush=True)
    summary = publish(calls, stations, {
        **audit, 'cdrMatched': matching_audit['cdrMatched'],
        'cdrAmbiguous': matching_audit['cdrAmbiguous'],
        'cdrUnmatched': matching_audit['cdrUnmatched'],
    }, args.out, revision)
    args.audit.parent.mkdir(parents=True, exist_ok=True)
    args.audit.write_text(json.dumps({**audit, 'output': summary}, indent=2, ensure_ascii=False), encoding='utf-8')
    print(json.dumps({'phase': 'done', **summary, 'qualityReport': str(args.audit)}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
