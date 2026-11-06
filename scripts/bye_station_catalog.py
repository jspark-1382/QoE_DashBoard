"""Resolve CDR Cell-to-RU inventory rows with explicit selection provenance.

An explicit source end RAT limits the lookup to that radio. The strict resolver
requires a unique identity; the display policy prefers same-call MDT evidence
and otherwise the first valid source row. Coordinates belong to registered
radio equipment, never the handset.
"""
from __future__ import annotations

from collections import Counter, defaultdict
import hashlib
import math
from pathlib import Path
import re

from lte_station_catalog import _inventory_rows, _pci_fields, identifier
from nr_station_catalog import _nr_inventory_rows


def normalize_end_rat(value):
    return {'LTE':'LTE','4G':'LTE','NR':'NR','5G':'NR'}.get(identifier(value).upper())


def _source(path, technology):
    path=Path(path)
    digest=hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda:stream.read(1024*1024),b''):
            digest.update(block)
    return {'technology':technology,'file':path.name,'sha256':digest.hexdigest()}


def _declared_sources(manifest):
    metadata=manifest.get('meta',{})
    prefix='BYE inventory provenance: '
    if 'byeStationInventories' not in metadata:
        return None
    declared=metadata['byeStationInventories']
    if not isinstance(declared,list) or not declared:
        raise ValueError(prefix+'inventory list must be nonempty')
    by_radio={}
    for source in declared:
        if (not isinstance(source,dict) or source.get('technology') not in ('LTE','NR') or
                not isinstance(source.get('file'),str) or not source['file'] or
                source['file']!=Path(source['file']).name or '/' in source['file'] or '\\' in source['file'] or
                not isinstance(source.get('sha256'),str) or
                re.fullmatch(r'[0-9a-fA-F]{64}',source['sha256']) is None):
            raise ValueError(prefix+'inventory technology/file/sha256 metadata is incomplete')
        if source['technology'] in by_radio:
            raise ValueError(prefix+'duplicate inventory technology')
        by_radio[source['technology']]=source
    return by_radio


def verify_bye_inventory_provenance(manifest, lte_path, nr_path=None):
    """Verify the complete declared inventory set, not merely its LTE member."""
    prefix='BYE inventory provenance: '
    by_radio=_declared_sources(manifest)
    if by_radio is None:
        if nr_path is not None:
            raise ValueError(prefix+'NR inventory must be declared in the source manifest')
        return False
    selected={technology:Path(path) for technology,path in [('LTE',lte_path),('NR',nr_path)] if path is not None}
    if selected.keys()!=by_radio.keys():
        raise ValueError(prefix+'selected inventory radios do not match the source manifest')
    for technology,path in selected.items():
        actual=_source(path,technology)
        expected=by_radio[technology]
        if actual['file']!=expected['file']:
            raise ValueError(prefix+'selected inventory filename does not match the source manifest')
        if actual['sha256']!=expected['sha256'].lower():
            raise ValueError(prefix+'selected inventory sha256 does not match the source manifest')
    return True


def resolve_manifest_nr_catalog(manifest, lte_path, nr_path=None):
    """Find the declared NR workbook beside LTE and verify the complete source set."""
    declared=_declared_sources(manifest)
    selected=Path(nr_path) if nr_path is not None else None
    if selected is None and declared and 'NR' in declared:
        if lte_path is None:
            raise ValueError('BYE inventory provenance: LTE directory or explicit NR path is required')
        selected=Path(lte_path).parent/declared['NR']['file']
    verify_bye_inventory_provenance(manifest,lte_path,selected)
    return selected


def _rows(path, technology, audit):
    if technology=='LTE':
        for cell,ru,lat,lon,valid,pci,status in _inventory_rows(path,audit):
            yield ru,cell,lat,lon,valid,pci,status
    else:
        yield from _nr_inventory_rows(path,audit)


def _resolution(catalog, cell_id, end_rat=None):
    cell=identifier(cell_id)
    radio=normalize_end_rat(end_rat)
    scope=(radio,) if radio else ('LTE','NR')
    if any(cell in catalog['invalidCells'].get(technology,set()) for technology in scope):
        return None,'invalid'
    candidates=[site for site in catalog['byCell'].get(cell,()) if site['technology'] in scope]
    if len(candidates)==1:
        return candidates[0],'unique'
    return None,'ambiguous' if candidates else 'missing'


def resolve_bye_site(catalog, cell_id, end_rat=None):
    """Return only one (technology, RU, coordinate) candidate in the allowed RAT scope."""
    return _resolution(catalog,cell_id,end_rat)[0]


def bye_site_candidates(catalog, cell_id, end_rat=None):
    """Valid coordinate candidates in original workbook order, with RAT scope."""
    cell=identifier(cell_id)
    radio=normalize_end_rat(end_rat)
    scope=(radio,) if radio else ('LTE','NR')
    return [site for site in catalog['byCell'].get(cell,()) if site['technology'] in scope]


def select_bye_site(catalog, cell_id, end_rat=None, mdt_events=()):
    """Prefer a uniquely identified recent MDT RU, else the first valid row.

    Events must already belong to a confirmed CDR/MDT match. A matching
    observation between end-30s and end+1s can select a registered candidate.
    Equal latest timestamps naming different RUs, or a RU with conflicting
    registered coordinates, cannot select a unique MDT location.
    """
    candidates=bye_site_candidates(catalog,cell_id,end_rat)
    if not candidates:
        return None
    strict=resolve_bye_site(catalog,cell_id,end_rat)
    if strict is not None:
        return {**strict,'byeSelectionMethod':'unique','byeCandidateCount':1}
    eligible=[]
    for event in mdt_events or ():
        lag=event.get('secondsBeforeEnd')
        if (not isinstance(lag,(int,float)) or isinstance(lag,bool) or
                not math.isfinite(lag) or not -1 <= lag <= 30 or
                identifier(event.get('cellId'))!=identifier(cell_id)):
            continue
        technology=normalize_end_rat(event.get('technology'))
        ru=identifier(event.get('ruId'))
        matching=[site for site in candidates if site['technology']==technology and site['ruId']==ru]
        if matching:
            eligible.append((lag,technology,ru,matching))
    if eligible:
        latest_lag=min(event[0] for event in eligible)
        latest=[event for event in eligible if event[0]==latest_lag]
        identities={(event[1],event[2]) for event in latest}
        if len(identities)==1 and len(latest[0][3])==1:
            site=latest[0][3][0]
            return {**site,'byeSelectionMethod':'mdt','byeCandidateCount':len(candidates),
                    'byeSelectionDeltaSeconds':round(latest_lag,3),'byeSelectionMdtRu':site['ruId']}
    return {**candidates[0],'byeSelectionMethod':'first','byeCandidateCount':len(candidates)}


def load_bye_catalog(lte_path, nr_path, requested_cells):
    """Retain raw duplicate/invalid evidence until the Cell-level decision.

    A coordinate-conflicting pair remains multiple candidates. Invalid rows
    prevent strict unique resolution; display selection can use a valid row
    with an explicit fallback label. Rows are never dropped to claim uniqueness.
    """
    requested={identifier(cell) for cell in requested_cells if identifier(cell)}
    positions=defaultdict(set)
    ordered_positions=[]
    pcis,pci_statuses=defaultdict(set),defaultdict(set)
    invalid=defaultdict(set)
    sources=[]
    audit=Counter()
    for technology,path in [('LTE',lte_path),('NR',nr_path)]:
        if path is None:
            continue
        path=Path(path)
        source=_source(path,technology)
        sources.append(source)
        scan_audit=Counter()
        for ru,cell,lat,lon,valid,pci,status in _rows(path,technology,scan_audit):
            if cell not in requested:
                continue
            audit['matchedSourceRows']+=1
            if not valid:
                invalid[technology].add(cell)
                audit['invalidCandidateRows']+=1
                continue
            key=(technology,ru,cell)
            coordinate=(round(lat,9),round(lon,9))
            if coordinate not in positions[key]:
                positions[key].add(coordinate)
                ordered_positions.append((key,coordinate))
            if pci is not None:
                pcis[key].add(pci)
            pci_statuses[key].add(status)
        if _source(path,technology)!=source:
            raise ValueError('BYE inventory source changed during parsing')
    source_by_radio={source['technology']:source for source in sources}
    by_cell=defaultdict(list)
    for (technology,ru,cell),(lat,lon) in ordered_positions:
        fields=_pci_fields(pcis[(technology,ru,cell)],pci_statuses[(technology,ru,cell)])
        source=source_by_radio[technology]
        by_cell[cell].append({'cellId':cell,'ruId':ru,'lat':lat,'lon':lon,
            'technology':technology,'source':source['file'],'sourceSha256':source['sha256'],**fields})
    catalog={'byCell':dict(by_cell),'invalidCells':dict(invalid),'sources':sources}
    for cell in requested:
        site,status=_resolution(catalog,cell)
        audit[{'unique':'uniqueSiteCells','invalid':'invalidCells',
               'ambiguous':'ambiguousCells','missing':'missingCells'}[status]]+=1
        if site and site['inventoryPciStatus']=='conflict':
            audit['uniqueSitePciConflicts']+=1
    audit['requestedCells']=len(requested)
    return catalog,dict(audit)
