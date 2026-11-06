"""Export NR site inventory without mixing it with LTE observation provenance."""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import uuid

from nr_station_catalog import SOURCE_PATTERN, load_nr_catalog, resolve_nr_master


ROOT = Path(__file__).resolve().parent.parent


def _source(path):
    path = Path(path)
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024*1024), b''):
            digest.update(block)
    match = SOURCE_PATTERN.fullmatch(path.name)
    file_date = datetime.strptime(match.group(1), '%y%m%d').date().isoformat() if match else None
    return {'file': path.name, 'sha256': digest.hexdigest(), 'fileDate': file_date}


def build_nr_catalog(inventory_path):
    """Publish one complete read-only source snapshot, rejecting mid-read changes."""
    inventory_path = Path(inventory_path)
    before = _source(inventory_path)
    stations, audit = load_nr_catalog(inventory_path)
    after = _source(inventory_path)
    if before != after:
        raise ValueError('NR inventory source changed during parsing; rebuild from a stable workbook.')
    statuses = Counter(station['inventoryPciStatus'] for station in stations)
    return {
        'schemaVersion': 'nr-station-catalog-v1', 'technology': 'NR', 'source': before,
        'summary': {
            'inputRows': audit.get('inputRows', 0), 'invalidRows': audit.get('invalidRows', 0),
            'registeredCells': len(stations), 'withPci': statuses['valid'],
            'missingPci': statuses['missing'], 'invalidPci': statuses['invalid'],
            'conflictingPci': statuses['conflict'],
            'distinctPci': len({station['pci'] for station in stations if station['pci'] is not None}),
        },
        'rows': [[station['baseStationId'], station['cellId'], station['pci'], station['latitude'],
                  station['longitude'], station['inventoryPciStatus']] for station in stations],
    }


def write_nr_catalog(catalog, public_dir):
    public_dir = Path(public_dir)
    public_dir.mkdir(parents=True, exist_ok=True)
    target = public_dir/'nr-station-catalog.json'
    pending = target.with_name('.nr-station-catalog.'+uuid.uuid4().hex+'.tmp')
    try:
        pending.write_text(json.dumps(catalog, ensure_ascii=False, separators=(',', ':'),
                                      allow_nan=False), encoding='utf8')
        os.replace(pending, target)
    finally:
        if pending.exists():
            pending.unlink()
    return target


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--nr-master', type=Path, default=None)
    parser.add_argument('--public-dir', type=Path,
                        default=Path(os.environ.get('QOE_PUBLIC_DIR', ROOT/'public')))
    args = parser.parse_args()
    try:
        inventory_path = resolve_nr_master(args.nr_master)
        catalog = build_nr_catalog(inventory_path)
    except (FileNotFoundError, ValueError, RuntimeError) as exc:
        parser.error(str(exc))
    output = write_nr_catalog(catalog, args.public_dir)
    print(json.dumps({'output': str(output), 'source': catalog['source'],
                      'summary': catalog['summary']}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
