"""CLI for streamed legacy/new MDT ingestion and atomic, partitioned output."""
import argparse
import json
from pathlib import Path

from mdt_pipeline import extract, numeric, read_rows, score


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir', type=Path, help='Defaults to data/MDT_New when present, otherwise data/MDT')
    parser.add_argument('--output', type=Path, default=Path('public/mdt-data.json'), help='Manifest output path')
    parser.add_argument('--master', type=Path, help='Explicit station TXT or legacy cell CSV')
    parser.add_argument('--staging-dir', type=Path, help='Temporary private SQLite parent directory (removed on exit)')
    parser.add_argument('--gnss-crs', choices=('unknown', 'EPSG:5179'), default='EPSG:5179',
                        help='Defaults to confirmed UTMK / EPSG:5179; unknown disables conversion')
    args = parser.parse_args()
    source = args.source_dir or (Path('data/MDT_New') if Path('data/MDT_New').is_dir() else Path('data/MDT'))
    summary = extract(source, args.output, args.master, args.staging_dir, args.gnss_crs)
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == '__main__':
    main()
