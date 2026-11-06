"""NR inventory export must remain independent of LTE matching and observations."""
import hashlib
from contextlib import redirect_stdout
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from openpyxl import Workbook

import build_nr_station_catalog as builder
from nr_station_catalog import registered_nr_pci, resolve_nr_master


class NrStationCatalogTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.inventory = self.root/'수도권_5G_261106.xlsx'
        self.public = self.root/'staged-public'

    def tearDown(self):
        self.temp.cleanup()

    def write_inventory(self, rows=(), header=None, extra_sheet=False):
        book = Workbook()
        sheet = book.active
        if header is not False:
            sheet.append(header or ['ru_id', 'cell_id', 'pci', 'latitude', 'longitude'])
        for row in rows:
            sheet.append(row)
        if extra_sheet:
            book.create_sheet('unexpected')
        book.save(self.inventory)
        book.close()

    def test_pci_range_accepts_nr_upper_half_and_preserves_zero(self):
        for value in [0, 503, 504, 1007, '000', '1007.0']:
            self.assertEqual(registered_nr_pci(value), (int(float(value)), 'valid'))
        for value in [1008, -1, 1.5, True, False, 'bad', float('nan'), float('inf')]:
            self.assertEqual(registered_nr_pci(value), (None, 'invalid'))
        for value in [None, '', 'NULL', ' _ ', 'N/A']:
            self.assertEqual(registered_nr_pci(value), (None, 'missing'))

    def test_catalog_keeps_missing_invalid_pci_but_rejects_coordinate_conflicts(self):
        self.write_inventory([
            ['NR0', 1, 0, 37.4, 127.0], ['NR1', 2, 503, 37.4, 127.1],
            ['NR2', 3, 504, 37.4, 127.2], ['NR3', 4, 1007, 37.4, 127.3],
            ['MISSING', 5, None, 37.4, 127.4], ['INVALID', 6, 1008, 37.4, 127.5],
            ['BOOL', 7, True, 37.4, 127.6],
            ['CONFLICT', 8, 400, 37.4, 127.7], ['CONFLICT', 8, 401, 37.4, 127.7],
            ['MOVED', 9, 600, 37.4, 127.8], ['MOVED', 9, 600, 37.5, 127.8],
            ['NOCOORD', 10, 1, None, 127.9], ['NOCELL', None, None, 37.4, 127.9],
            ['NR0', 1, 0, 37.4, 127.0],
        ])
        catalog = builder.build_nr_catalog(self.inventory)
        self.assertEqual(catalog['schemaVersion'], 'nr-station-catalog-v1')
        self.assertEqual(catalog['technology'], 'NR')
        self.assertNotIn('observations', catalog)
        self.assertEqual(catalog['summary'], {
            'inputRows': 14, 'invalidRows': 2, 'registeredCells': 8, 'withPci': 4,
            'missingPci': 1, 'invalidPci': 2, 'conflictingPci': 1, 'distinctPci': 4,
        })
        by_ru = {row[0]: row for row in catalog['rows']}
        self.assertEqual(by_ru['NR0'], ['NR0', '1', 0, 37.4, 127.0, 'valid'])
        self.assertEqual(by_ru['NR3'][2], 1007)
        self.assertEqual(by_ru['MISSING'][2:], [None, 37.4, 127.4, 'missing'])
        self.assertEqual(by_ru['INVALID'][2:], [None, 37.4, 127.5, 'invalid'])
        self.assertEqual(by_ru['BOOL'][5], 'invalid')
        self.assertEqual(by_ru['CONFLICT'][2:], [None, 37.4, 127.7, 'conflict'])
        self.assertNotIn('MOVED', by_ru)
        self.assertNotIn('NOCELL', by_ru)
        self.assertNotIn('NOCOORD', by_ru)

    def test_reused_cell_ids_preserve_exact_ru_identity_and_original_string_ids(self):
        self.write_inventory([
            ['NR-A', 1627668513, 600, 37.4, 127.0],
            ['NR-B', 1627668513, 601, 37.5, 127.1],
            ['NR-C', '00000000000000000001', 0, 37.6, 127.2],
            ['NR-D', '68719476735', 1007, 37.7, 127.3],
        ])
        rows = builder.build_nr_catalog(self.inventory)['rows']
        self.assertEqual([row[:2] for row in rows], [
            ['NR-A', '1627668513'], ['NR-B', '1627668513'],
            ['NR-C', '00000000000000000001'], ['NR-D', '68719476735'],
        ])

    def test_unknown_empty_and_multisheet_workbooks_fail_closed(self):
        for header, extra in [(['cell_id', 'ru_id', 'pci', 'latitude', 'longitude'], False),
                              (False, False), (None, True)]:
            with self.subTest(header=header, extra=extra):
                self.write_inventory(header=header, extra_sheet=extra)
                with self.assertRaises(ValueError):
                    builder.build_nr_catalog(self.inventory)
        self.write_inventory()
        self.assertEqual(builder.build_nr_catalog(self.inventory)['rows'], [])

    def test_invalid_coordinates_or_missing_identity_are_not_published(self):
        self.write_inventory([
            ['NR', 1, 1, 91, 127], ['NR', 2, 1, 37, 200],
            ['', 3, 1, 37, 127], [None, 4, 1, 37, 127],
            ['NR', None, 1, 37, 127], ['NR', 5, 1, 37, 127],
        ])
        catalog = builder.build_nr_catalog(self.inventory)
        self.assertEqual(catalog['summary']['invalidRows'], 5)
        self.assertEqual(catalog['summary']['registeredCells'], 1)

    def test_source_hash_and_file_date_identify_exact_workbook(self):
        self.write_inventory([['NR', 1, 1007, 37.4, 127]])
        before = self.inventory.read_bytes()
        catalog = builder.build_nr_catalog(self.inventory)
        self.assertEqual(catalog['source'], {
            'file': self.inventory.name, 'sha256': hashlib.sha256(before).hexdigest(),
            'fileDate': '2026-11-06',
        })
        self.assertEqual(self.inventory.read_bytes(), before)

    def test_source_changed_during_parse_is_rejected(self):
        self.write_inventory([['NR', 1, 1007, 37.4, 127]])
        source = builder._source(self.inventory)
        changed = {**source, 'sha256': '0'*64}
        with patch.object(builder, '_source', side_effect=[source, changed]):
            with self.assertRaisesRegex(ValueError, 'changed'):
                builder.build_nr_catalog(self.inventory)

    def test_latest_valid_dated_file_env_and_explicit_override(self):
        first = self.root/'수도권_5G_261105.xlsx'
        latest = self.inventory
        invalid_date = self.root/'수도권_5G_261399.xlsx'
        unrelated = self.root/'수도권_LTE_271101.xlsx'
        for p in [first, latest, invalid_date, unrelated]:
            p.touch()
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(resolve_nr_master(directory=self.root), latest)
        with patch.dict(os.environ, {'QOE_NR_MASTER': str(first)}):
            self.assertEqual(resolve_nr_master(directory=self.root), first)
            self.assertEqual(resolve_nr_master(latest), latest)
        with self.assertRaises(FileNotFoundError):
            resolve_nr_master(self.root/'missing.xlsx')
        with self.assertRaises(FileNotFoundError):
            resolve_nr_master(directory=self.root/'empty')

    def test_atomic_write_targets_only_nr_catalog_and_cleans_failed_temp_file(self):
        self.write_inventory([['NR', 1, 1007, 37.4, 127]])
        catalog = builder.build_nr_catalog(self.inventory)
        self.public.mkdir()
        lte = self.public/'station-catalog.json'
        lte.write_text('unchanged LTE', encoding='utf8')
        path = builder.write_nr_catalog(catalog, self.public)
        self.assertEqual(path, self.public/'nr-station-catalog.json')
        self.assertEqual(json.loads(path.read_text(encoding='utf8')), catalog)
        self.assertEqual(lte.read_text(encoding='utf8'), 'unchanged LTE')
        with patch.object(builder.os, 'replace', side_effect=OSError('fixture failure')):
            with self.assertRaises(OSError):
                builder.write_nr_catalog({**catalog, 'rows': []}, self.public)
        self.assertEqual(json.loads(path.read_text(encoding='utf8')), catalog)
        self.assertEqual(list(self.public.glob('.nr-station-catalog.*.tmp')), [])

    def test_cli_supports_nr_environment_and_explicit_staging_overrides(self):
        self.write_inventory([['NR', 1, 1007, 37.4, 127]])
        with patch('sys.argv', ['build_nr_station_catalog.py']), \
             patch.dict(os.environ, {'QOE_NR_MASTER': str(self.inventory),
                                     'QOE_PUBLIC_DIR': str(self.public)}), redirect_stdout(io.StringIO()):
            builder.main()
        self.assertTrue((self.public/'nr-station-catalog.json').is_file())
        explicit = self.root/'explicit-public'
        with patch('sys.argv', ['build_nr_station_catalog.py', '--nr-master', str(self.inventory),
                                '--public-dir', str(explicit)]), \
             patch.dict(os.environ, {'QOE_NR_MASTER': str(self.root/'does-not-exist.xlsx'),
                                     'QOE_PUBLIC_DIR': str(self.root/'wrong-public')}), \
             redirect_stdout(io.StringIO()):
            builder.main()
        exported = json.loads((explicit/'nr-station-catalog.json').read_text(encoding='utf8'))
        self.assertEqual(exported['rows'][0][2], 1007)
        self.assertFalse((self.root/'wrong-public').exists())


if __name__ == '__main__':
    unittest.main()
