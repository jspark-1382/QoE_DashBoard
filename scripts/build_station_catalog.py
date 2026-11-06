"""Export the full LTE inventory with a separate exact-identity observed PCI audit."""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import uuid

from lte_station_catalog import (
    _inventory_rows, identifier, load_lte_catalog, registered_pci, resolve_lte_master,
)
from inventory_provenance import verify_inventory_provenance


ROOT = Path(__file__).resolve().parent.parent


def _source(path):
    sha = hashlib.sha256()
    with path.open('rb') as inp:
        for block in iter(lambda: inp.read(1024*1024), b''):
            sha.update(block)
    match = re.fullmatch(r'수도권_LTE_(\d{6})\.xlsx', path.name)
    file_date = None
    if match:
        file_date = datetime.strptime(match.group(1), '%y%m%d').date().isoformat()
    return {'file': path.name, 'sha256': sha.hexdigest(), 'fileDate': file_date}


def _observations(public_dir, stations):
    manifest = json.loads((public_dir/'voice-1030.json').read_text(encoding='utf-8-sig'))
    meta = manifest['meta']
    fields = meta.get('sampleFields')
    if fields is not None and (len(fields) < 22 or fields[9] != 'pci' or fields[21] != 'mdt'):
        raise ValueError('voice sampleFields must identify original PCI and MDT metadata')
    exact = {(s['baseStationId'], s['cellId']): s for s in stations}
    counts = dict.fromkeys(
        ('total', 'exactMatched', 'comparable', 'matched', 'mismatched', 'unregistered', 'unavailable'), 0)
    public_root = public_dir.resolve()
    for day in manifest['days']:
        if day.get('sampleCount', 0) <= 0:
            continue
        detail_path = (public_root/day['dataPath']).resolve()
        if not detail_path.is_relative_to(public_root):
            raise ValueError('voice detail path must stay inside the selected public directory')
        detail = json.loads(detail_path.read_text(encoding='utf-8-sig'))
        for sample in detail['samples']:
            counts['total'] += 1
            md = sample[21] if len(sample) > 21 and isinstance(sample[21], dict) else {}
            station = exact.get((identifier(md.get('baseStationId')), identifier(md.get('cellId'))))
            if station is None:
                counts['unregistered'] += 1
                continue
            counts['exactMatched'] += 1
            observed, observed_status = registered_pci(sample[9] if len(sample) > 9 else None)
            if station['inventoryPciStatus'] != 'valid' or observed_status != 'valid':
                counts['unavailable'] += 1
                continue
            counts['comparable'] += 1
            counts['matched' if observed == station['pci'] else 'mismatched'] += 1
    return {'sourceRevision': meta['revision'], 'dates': meta['dates'], **counts}


def build_catalog(inventory_path, public_dir):
    """Keep every valid exact RU+Cell identity, including unavailable registered PCI."""
    inventory_path, public_dir = Path(inventory_path), Path(public_dir)
    manifest = json.loads((public_dir/'voice-1030.json').read_text(encoding='utf-8-sig'))
    verify_inventory_provenance(manifest, inventory_path, 'station catalog')
    scan_audit = Counter()
    requested = {(ru, cell) for cell, ru, _lat, _lon, valid, _pci, _status in
                 _inventory_rows(inventory_path, scan_audit) if valid}
    stations, audit = load_lte_catalog(inventory_path, requested)
    rows = [[s['baseStationId'], s['cellId'], s['pci'], s['latitude'], s['longitude'],
             s['inventoryPciStatus']] for s in stations]
    statuses = Counter(s['inventoryPciStatus'] for s in stations)
    return {
        'schemaVersion': 'lte-station-catalog-v1',
        'source': _source(inventory_path),
        'summary': {
            'inputRows': audit.get('inputRows', 0), 'invalidRows': audit.get('invalidRows', 0),
            'registeredCells': len(stations), 'withPci': statuses['valid'],
            'missingPci': statuses['missing'], 'invalidPci': statuses['invalid'],
            'conflictingPci': statuses['conflict'],
            'distinctPci': len({s['pci'] for s in stations if s['pci'] is not None}),
        },
        'rows': rows,
        'observations': _observations(public_dir, stations),
    }


def write_catalog(catalog, public_dir):
    public_dir = Path(public_dir)
    public_dir.mkdir(parents=True, exist_ok=True)
    path = public_dir/'station-catalog.json'
    pending = path.with_name('.station-catalog.'+uuid.uuid4().hex+'.tmp')
    try:
        pending.write_text(json.dumps(catalog, ensure_ascii=False, separators=(',', ':'),
                                      allow_nan=False), encoding='utf8')
        os.replace(pending, path)
    finally:
        if pending.exists():
            pending.unlink()
    return path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--public-dir', type=Path,
                        default=Path(os.environ.get('QOE_PUBLIC_DIR', ROOT/'public')))
    parser.add_argument('--lte-master', type=Path, default=None)
    args = parser.parse_args()
    try:
        inventory_path = resolve_lte_master(args.lte_master)
    except FileNotFoundError as exc:
        parser.error(str(exc))
    catalog = build_catalog(inventory_path, args.public_dir)
    path = write_catalog(catalog, args.public_dir)
    print(json.dumps({'output': str(path), 'source': catalog['source'],
                      'summary': catalog['summary'], 'observations': catalog['observations']},
                     ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
