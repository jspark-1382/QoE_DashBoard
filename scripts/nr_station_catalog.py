"""Load registered NR sites independently of LTE observations and LTE Cell joins.

The workbook's cell_id is retained as an original identifier. Without PLMN,
gNB, carrier and observation metadata it is not treated as a global identity
or used as evidence of a measured device position.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime
import math
import os
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parent.parent
EXPECTED_HEADERS = ('ru_id', 'cell_id', 'pci', 'latitude', 'longitude')
SOURCE_PATTERN = re.compile(r'수도권_5G_(\d{6})\.xlsx')


def identifier(value):
    if value is None or isinstance(value, bool):
        return ''
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def resolve_nr_master(path=None, directory=None):
    """Explicit CLI path, then NR-only environment override, then latest dated NR file."""
    chosen = path if path is not None else os.environ.get('QOE_NR_MASTER')
    if chosen:
        result = Path(chosen)
    else:
        folder = Path(directory) if directory is not None else ROOT/'data'/'BaseStation'
        candidates = []
        for candidate in folder.glob('수도권_5G_*.xlsx'):
            match = SOURCE_PATTERN.fullmatch(candidate.name)
            if not match or not candidate.is_file():
                continue
            try:
                date = datetime.strptime(match.group(1), '%y%m%d').date()
            except ValueError:
                continue
            candidates.append((date, candidate))
        if not candidates:
            raise FileNotFoundError(f'NR inventory workbook was not found: {folder}')
        result = max(candidates, key=lambda item: item[0])[1]
    if not result.is_file():
        raise FileNotFoundError(f'NR inventory workbook was not found: {result}')
    return result


def registered_nr_pci(value):
    """NR has 1008 physical-cell identities; PCI0 is a valid registered value."""
    if value is None or (isinstance(value, str) and value.strip().upper() in
                         ('', 'NULL', 'NAN', 'NONE', 'N/A', '_')):
        return None, 'missing'
    if isinstance(value, bool):
        return None, 'invalid'
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        return None, 'invalid'
    if not math.isfinite(number) or not number.is_integer() or not 0 <= number <= 1007:
        return None, 'invalid'
    return int(number), 'valid'


def _nr_inventory_rows(path, audit):
    try:
        import openpyxl
    except ImportError as exc:
        raise RuntimeError('NR inventory loading requires openpyxl.') from exc
    path = Path(path)
    book = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        if len(book.worksheets) != 1:
            raise ValueError('NR inventory must contain exactly one worksheet.')
        sheet = book.worksheets[0]
        iterator = sheet.iter_rows(values_only=True)
        header = tuple(identifier(value) for value in next(iterator, ()))
        if header != EXPECTED_HEADERS:
            raise ValueError(f'NR inventory header mismatch: {header!r}')
        for row in iterator:
            audit['inputRows'] += 1
            ru, cell = identifier(row[0]), identifier(row[1])
            pci, pci_status = registered_nr_pci(row[2])
            try:
                lat, lon = float(row[3]), float(row[4])
                valid = bool(ru and cell) and math.isfinite(lat) and math.isfinite(lon) and (
                    33 <= lat <= 39.8 and 124 <= lon <= 132)
            except (TypeError, ValueError, OverflowError):
                lat, lon, valid = None, None, False
            audit['validRows' if valid else 'invalidRows'] += 1
            audit[{'valid': 'pciValidRows', 'missing': 'pciMissingRows',
                   'invalid': 'pciInvalidRows'}[pci_status]] += 1
            yield ru, cell, lat, lon, valid, pci, pci_status
    finally:
        book.close()


def load_nr_catalog(path):
    """Return all valid exact NR RU+Cell pairs, with explicit PCI uncertainty.

    Multiple coordinates for one RU+Cell are rejected. Duplicate rows at the
    same coordinate are merged; contradictory PCI values never pick a winner.
    An identical Cell ID on another RU remains a separate registered site.
    """
    positions, pci_values, pci_statuses = defaultdict(set), defaultdict(set), defaultdict(set)
    audit = Counter()
    for ru, cell, lat, lon, valid, pci, status in _nr_inventory_rows(path, audit):
        if not valid:
            continue
        key = (ru, cell)
        positions[key].add((round(lat, 9), round(lon, 9)))
        if pci is not None:
            pci_values[key].add(pci)
        pci_statuses[key].add(status)
    stations = []
    for (ru, cell), coordinates in sorted(positions.items()):
        if len(coordinates) != 1:
            audit['coordinateConflicts'] += 1
            continue
        values, statuses = pci_values[(ru, cell)], pci_statuses[(ru, cell)]
        if len(values) > 1:
            pci, status = None, 'conflict'
            audit['pciConflicts'] += 1
        elif 'invalid' in statuses:
            pci, status = None, 'invalid'
        elif values:
            pci, status = next(iter(values)), 'valid'
        else:
            pci, status = None, 'missing'
        lat, lon = next(iter(coordinates))
        stations.append({'baseStationId': ru, 'cellId': cell, 'pci': pci,
                         'latitude': lat, 'longitude': lon, 'inventoryPciStatus': status})
    audit['registeredCells'] = len(stations)
    return stations, dict(audit)
