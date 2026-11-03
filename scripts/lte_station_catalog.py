"""Strict LTE 2026-11-03 RU+CellID inventory loader.

The spreadsheet lists base-station tower coordinates, NOT user/device
positions, and contains many reused cell IDs. A cell-only match is therefore
never sufficient for MDT location inference.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from pathlib import Path
import math


EXPECTED_HEADERS = ('cell_id', 'LTERU_ID', 'latitude', 'longitude')


def identifier(value):
    if value is None or isinstance(value, bool):
        return ''
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def load_lte_catalog(path: Path, requested_pairs, cdr_cells=()):
    """Return only unambiguous requested RU+Cell rows and a source audit.

    Read the entire 87k-row workbook to detect conflicts even for pairs
    occurring late. Keep the published browser dataset limited to the RU+Cell
    identities actually measured by MDT, not every tower in the metro area.
    """
    try:
        import openpyxl
    except ImportError as exc:
        raise RuntimeError('LTE 기지국 Excel 로딩에 openpyxl이 필요합니다.') from exc

    if not path.is_file():
        raise FileNotFoundError(f'LTE 기지국 목록을 찾을 수 없습니다: {path}')

    requested = set(requested_pairs)
    cdr_ids = set(cdr_cells)
    candidates = defaultdict(set)
    cdr_candidates = Counter()
    audit = Counter()
    book = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        if len(book.worksheets) != 1:
            raise ValueError('LTE 기지국 Excel은 단일 시트만 지원합니다.')
        sheet = book.worksheets[0]
        header = tuple(identifier(v) for v in next(sheet.iter_rows(min_row=1, max_row=1, values_only=True)))
        if header != EXPECTED_HEADERS:
            raise ValueError(f'LTE 기지국 헤더 불일치: {header!r}')
        for values in sheet.iter_rows(min_row=2, values_only=True):
            audit['inputRows'] += 1
            cell_id, ru_id = identifier(values[0]), identifier(values[1])
            lat, lon = values[2], values[3]
            try:
                lat, lon = float(lat), float(lon)
            except (ValueError, TypeError):
                audit['invalidRows'] += 1
                continue
            if not cell_id or not ru_id or not (math.isfinite(lat) and math.isfinite(lon)
                and 33 <= lat <= 39.8 and 124 <= lon <= 132):
                audit['invalidRows'] += 1
                continue
            audit['validRows'] += 1
            if cell_id in cdr_ids:
                cdr_candidates[cell_id] += 1
            if (ru_id,cell_id) in requested:
                candidates[(ru_id,cell_id)].add((round(lat,9), round(lon,9)))
    finally:
        book.close()

    stations = []
    for (ru,cell), positions in sorted(candidates.items()):
        if len(positions) != 1:
            audit['requestedPairsCoordinateConflicts'] += 1
            continue
        lat, lon = next(iter(positions))
        stations.append({
            'baseStationId':ru, 'cellId':cell, 'frequency':None,
            'latitude':lat, 'longitude':lon, 'pci':None,
            'isVirtual':False,
            # The source lacks explicit position accuracy, transmit power,
            # antenna sector and calibration metadata.
            'provenanceUnknown':True, 'matchLevel':'cell',
            'inventorySource':path.name,
        })
    audit['requestedExactPairs'] = len(requested)
    audit['matchedExactPairs'] = len(stations)
    audit['unmatchedExactPairs'] = len(requested)-len(stations)
    audit['cdrCellIdsEncountered'] = len(cdr_candidates)
    audit['cdrCellIdsUniqueRow'] = sum(count==1 for count in cdr_candidates.values())
    audit['cdrCellIdsMultipleRows'] = sum(count>1 for count in cdr_candidates.values())
    audit['cdrCellIdsNotFound'] = len(cdr_ids)-len(cdr_candidates)
    audit['cdrSingleCellNotTrilateration'] = True
    return stations, dict(audit)


def load_unique_bye_cells(path: Path, requested_cells):
    """Safely resolve a CDR END CELL ID to one LTE RU *site*.

    CDR contains no RU ID. Multiple valid RU identities for one Cell ID
    are ambiguous even if their coordinates coincide. Never infer UE
    location from this site coordinate; callers must label its provenance.
    """
    try:
        import openpyxl
    except ImportError as exc:
        raise RuntimeError('LTE BYE Cell Excel 로딩에 openpyxl이 필요합니다.') from exc
    requested={identifier(v) for v in requested_cells if identifier(v)}
    if not path.is_file():
        raise FileNotFoundError(f'LTE 기지국 목록을 찾을 수 없습니다: {path}')
    candidates=defaultdict(set)
    invalid=set()
    audit=Counter()
    book=openpyxl.load_workbook(path,read_only=True,data_only=True)
    try:
        if len(book.worksheets)!=1:
            raise ValueError('LTE 기지국 Excel은 단일 시트만 지원합니다.')
        sheet=book.worksheets[0]
        headers=tuple(identifier(v) for v in next(sheet.iter_rows(min_row=1,max_row=1,values_only=True)))
        if headers!=EXPECTED_HEADERS:
            raise ValueError(f'LTE BYE Cell Excel 헤더 불일치: {headers}')
        for entry in sheet.iter_rows(min_row=2,values_only=True):
            cell=identifier(entry[0])
            if cell not in requested:continue
            audit['matchedSourceRows']+=1
            ru=identifier(entry[1])
            try:
                lat=float(entry[2]);lon=float(entry[3])
                valid=bool(ru) and math.isfinite(lat) and math.isfinite(lon) and (33<=lat<=39.8 and 124<=lon<=132)
            except (ValueError,TypeError):
                valid=False
            if not valid:
                invalid.add(cell)
                audit['invalidCandidateRows']+=1
                continue
            candidates[cell].add((ru,round(lat,9),round(lon,9)))
    finally:
        book.close()
    sites={}
    for cell in requested:
        values=candidates.get(cell,set())
        if cell in invalid:
            audit['invalidCells']+=1
        elif len(values)==1:
            ru,lat,lon=next(iter(values))
            sites[cell]={'cellId':cell,'ruId':ru,'lat':lat,'lon':lon,
                         'source':path.name}
        elif len(values)>1:
            audit['ambiguousCells']+=1
        else:
            audit['missingCells']+=1
    audit['requestedCells']=len(requested)
    audit['uniqueSiteCells']=len(sites)
    return sites,dict(audit)
