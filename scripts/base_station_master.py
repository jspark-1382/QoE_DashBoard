"""Read legacy and updated MDT station CSV without losing duplicate CellID headers."""
import csv
import io
import math


def number(value):
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (TypeError, ValueError):
        return None


def coordinate(value, limit):
    value = value.strip()
    parts = value.split('-')
    if len(parts) == 3 and all(number(p) is not None for p in parts):
        degrees, minutes, seconds = map(float, parts)
        if not (0 <= minutes < 60 and 0 <= seconds < 60):
            return None
        result = degrees + minutes / 60 + seconds / 3600
    else:
        result = number(value)
    return result if result is not None and -limit <= result <= limit else None


def load_master(path):
    if not path.exists():
        return [], ['기지국 Master 없음']
    raw = path.read_bytes()
    try:
        content = raw.decode('utf-8-sig')
    except UnicodeDecodeError:
        content = raw.decode('cp949')
    reader = csv.reader(io.StringIO(content))
    header = next(reader, [])
    legacy = 'base_station_id' in header
    updated = len(header) == 6 and header[:2] == ['CellID', 'CellID']
    if not legacy and not updated:
        return [], ['지원하지 않는 기지국 Master 컬럼 형식']
    stations, errors = [], []
    for line, values in enumerate(reader, 2):
        if not values or not any(v.strip() for v in values):
            continue
        if len(values) != len(header):
            errors.append(f'Master {line}행: 컬럼 수 불일치')
            continue
        if legacy:
            row = dict(zip(header, values))
        else:
            # Two CellID columns mean station identifier and cell identifier, respectively.
            row = dict(zip(['base_station_id', 'cell_id', 'frequency', 'pci', 'latitude', 'longitude'], values))
        lat, lon = coordinate(row.get('latitude', ''), 90), coordinate(row.get('longitude', ''), 180)
        if lat is None or lon is None or not row.get('cell_id', '').strip():
            errors.append(f'Master {line}행: 좌표 또는 Cell ID 누락/오류')
            continue
        frequencies = [number(v.strip()) for v in row.get('frequency', '').split('+')]
        if any(f is None for f in frequencies) and row.get('frequency', '').strip():
            errors.append(f'Master {line}행: 주파수 형식 오류')
            continue
        for frequency in dict.fromkeys(frequencies):
            stations.append(dict(baseStationId=row.get('base_station_id', '').strip(), cellId=row['cell_id'].strip(),
                frequency=frequency, latitude=lat, longitude=lon, pci=number(row.get('pci')),
                txPowerDbm=number(row.get('tx_power_dbm')), txPowerType=row.get('tx_power_type', '').strip().upper(),
                isVirtual=row.get('is_virtual', '').strip().lower() in ('true', '1', 'yes'),
                provenanceUnknown='is_virtual' not in row))
    return stations, errors
