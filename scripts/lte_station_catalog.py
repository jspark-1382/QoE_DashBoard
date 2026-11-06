"""Strict RU+Cell inventory loading with separately identified registered PCI.

Inventory coordinates are tower sites, never device positions. PCI reuse is
expected; neither a registered nor observed PCI is a globally unique Cell ID.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from pathlib import Path
import math
import os
import re


EXPECTED_HEADERS = ('cell_id', 'LTERU_ID', 'latitude', 'longitude')
PCI_HEADERS = ('cell_id', 'LTERU_ID', 'pci_no', 'latitude', 'longitude')


def identifier(value):
    if value is None or isinstance(value, bool):
        return ''
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def resolve_lte_master(path=None, directory=None):
    """Explicit CLI path, then environment override, then latest dated workbook."""
    chosen = path if path is not None else os.environ.get('QOE_LTE_MASTER')
    if chosen:
        result = Path(chosen)
    else:
        directory = Path(directory) if directory is not None else Path('data/BaseStation')
        candidates = [p for p in directory.glob('수도권_LTE_*.xlsx')
                      if re.fullmatch(r'수도권_LTE_\d{6}\.xlsx', p.name) and p.is_file()]
        if not candidates:
            raise FileNotFoundError(f'LTE 기지국 목록을 찾을 수 없습니다: {directory}')
        result = max(candidates, key=lambda p: p.name)
    if not result.is_file():
        raise FileNotFoundError(f'LTE 기지국 목록을 찾을 수 없습니다: {result}')
    return result


def registered_pci(value):
    """Return validated inventory PCI and status; preserve PCI 0 explicitly."""
    if value is None or (isinstance(value, str) and value.strip().upper() in
                         ('', 'NULL', 'NAN', 'NONE', 'N/A', '_')):
        return None, 'missing'
    if isinstance(value, bool):
        return None, 'invalid'
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None, 'invalid'
    if not math.isfinite(number) or not number.is_integer() or not 0 <= number <= 503:
        return None, 'invalid'
    return int(number), 'valid'


def _inventory_rows(path, audit):
    try:
        import openpyxl
    except ImportError as exc:
        raise RuntimeError('LTE 기지국 Excel 로딩에 openpyxl이 필요합니다.') from exc
    path = Path(path)
    if not path.is_file():
        raise FileNotFoundError(f'LTE 기지국 목록을 찾을 수 없습니다: {path}')
    book = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        if len(book.worksheets) != 1:
            raise ValueError('LTE 기지국 Excel은 단일 시트만 지원합니다.')
        sheet = book.worksheets[0]
        header = tuple(identifier(v) for v in next(sheet.iter_rows(min_row=1, max_row=1, values_only=True)))
        if header not in (EXPECTED_HEADERS, PCI_HEADERS):
            raise ValueError(f'LTE 기지국 헤더 불일치: {header!r}')
        columns = {name: index for index, name in enumerate(header)}
        audit['pciColumnPresent'] = header == PCI_HEADERS
        for row in sheet.iter_rows(min_row=2, values_only=True):
            audit['inputRows'] += 1
            cell, ru = identifier(row[columns['cell_id']]), identifier(row[columns['LTERU_ID']])
            pci, pci_status = registered_pci(row[columns['pci_no']] if 'pci_no' in columns else None)
            audit[{'valid': 'pciValidRows', 'missing': 'pciMissingRows', 'invalid': 'pciInvalidRows'}[pci_status]] += 1
            try:
                lat, lon = float(row[columns['latitude']]), float(row[columns['longitude']])
                valid = bool(cell and ru) and math.isfinite(lat) and math.isfinite(lon) and (
                    33 <= lat <= 39.8 and 124 <= lon <= 132)
            except (TypeError, ValueError):
                lat, lon, valid = None, None, False
            audit['validRows' if valid else 'invalidRows'] += 1
            if valid:
                audit[{'valid': 'validSitePciValidRows', 'missing': 'validSitePciMissingRows',
                       'invalid': 'validSitePciInvalidRows'}[pci_status]] += 1
            yield cell, ru, lat, lon, valid, pci, pci_status
    finally:
        book.close()


def _pci_fields(values, statuses):
    # Coordinates can identify one site while duplicate rows disagree on PCI.
    # Retain that site, but never publish an arbitrary single registered PCI.
    if len(values) > 1:
        return {'pci': None, 'inventoryPciStatus': 'conflict',
                'inventoryPciCandidates': sorted(values)}
    if 'invalid' in statuses:
        return {'pci': None, 'inventoryPciStatus': 'invalid'}
    if values:
        return {'pci': next(iter(values)), 'inventoryPciStatus': 'valid'}
    return {'pci': None, 'inventoryPciStatus': 'missing'}


def load_lte_catalog(path: Path, requested_pairs, cdr_cells=()):
    """Publish requested exact RU+Cell pairs with one position at 9 decimal places.

    Different positions for one pair are rejected. A registered PCI conflict at
    the same position is exposed separately and does not turn it into two sites.
    """
    path = Path(path)
    requested, cdr_ids = set(requested_pairs), set(cdr_cells)
    candidates, pci_values, pci_statuses = defaultdict(set), defaultdict(set), defaultdict(set)
    cdr_candidates, audit = Counter(), Counter()
    for cell, ru, lat, lon, valid, pci, pci_status in _inventory_rows(path, audit):
        if not valid:
            continue
        if cell in cdr_ids:
            cdr_candidates[cell] += 1
        key = (ru, cell)
        if key in requested:
            candidates[key].add((round(lat, 9), round(lon, 9)))
            if pci is not None:
                pci_values[key].add(pci)
            pci_statuses[key].add(pci_status)
    stations = []
    for (ru, cell), positions in sorted(candidates.items()):
        if len(positions) != 1:
            audit['requestedPairsCoordinateConflicts'] += 1
            continue
        lat, lon = next(iter(positions))
        fields = _pci_fields(pci_values[(ru, cell)], pci_statuses[(ru, cell)])
        if fields['inventoryPciStatus'] == 'conflict':
            audit['requestedPairsPciConflicts'] += 1
        stations.append({
            'baseStationId': ru, 'cellId': cell, 'frequency': None,
            'latitude': lat, 'longitude': lon, **fields,
            'isVirtual': False, 'provenanceUnknown': True, 'matchLevel': 'cell',
            'inventorySource': path.name,
        })
    audit['requestedExactPairs'] = len(requested)
    audit['matchedExactPairs'] = len(stations)
    audit['unmatchedExactPairs'] = len(requested)-len(stations)
    audit['cdrCellIdsEncountered'] = len(cdr_candidates)
    audit['cdrCellIdsUniqueRow'] = sum(count == 1 for count in cdr_candidates.values())
    audit['cdrCellIdsMultipleRows'] = sum(count > 1 for count in cdr_candidates.values())
    audit['cdrCellIdsNotFound'] = len(cdr_ids)-len(cdr_candidates)
    audit['cdrSingleCellNotTrilateration'] = True
    audit['pciOnlyMatchingUsed'] = False
    return stations, dict(audit)


def load_unique_bye_cells(path: Path, requested_cells):
    """Resolve a Cell to one (RU, lat/lon rounded to 9 decimals) identity only.

    Co-located different RUs remain ambiguous. Site coordinates never imply a
    device position, and this resolution is never a three-site measurement.
    """
    path = Path(path)
    requested = {identifier(v) for v in requested_cells if identifier(v)}
    candidates, pci_values, pci_statuses = defaultdict(set), defaultdict(set), defaultdict(set)
    invalid, audit = set(), Counter()
    for cell, ru, lat, lon, valid, pci, pci_status in _inventory_rows(path, audit):
        if cell not in requested:
            continue
        audit['matchedSourceRows'] += 1
        if not valid:
            invalid.add(cell)
            audit['invalidCandidateRows'] += 1
            continue
        site = (ru, round(lat, 9), round(lon, 9))
        candidates[cell].add(site)
        if pci is not None:
            pci_values[(cell, site)].add(pci)
        pci_statuses[(cell, site)].add(pci_status)
    sites = {}
    for cell in requested:
        values = candidates.get(cell, set())
        if cell in invalid:
            audit['invalidCells'] += 1
        elif len(values) == 1:
            site = next(iter(values))
            ru, lat, lon = site
            fields = _pci_fields(pci_values[(cell, site)], pci_statuses[(cell, site)])
            if fields['inventoryPciStatus'] == 'conflict':
                audit['uniqueSitePciConflicts'] += 1
            sites[cell] = {'cellId': cell, 'ruId': ru, 'lat': lat, 'lon': lon,
                           'source': path.name, **fields}
        elif len(values) > 1:
            audit['ambiguousCells'] += 1
        else:
            audit['missingCells'] += 1
    audit['requestedCells'] = len(requested)
    audit['uniqueSiteCells'] = len(sites)
    return sites, dict(audit)
