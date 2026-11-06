"""Whole-inventory export and observed PCI comparison use explicit provenance."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from openpyxl import Workbook

from build_station_catalog import build_catalog, write_catalog


class StationCatalogTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.inventory = self.root/'수도권_LTE_261104.xlsx'
        self.public = self.root/'staged-public'
        self.public.mkdir()
        book = Workbook()
        sheet = book.active
        sheet.append(['cell_id','LTERU_ID','pci_no','latitude','longitude'])
        for row in [
            [1,'RU0',0,37.4,127.0], [2,'RU1',0,37.4,127.1],
            [3,'RU2',None,37.4,127.2], [4,'RU3',True,37.4,127.3],
            [5,'RU4',10,37.4,127.4], [5,'RU4',11,37.4,127.4],
            [6,'RU5',12,37.4,127.5], [6,'RU5',12,37.5,127.5],
            [7,'RU6',13,None,127.6], [1,'RU0',0,37.4,127.0],
        ]:
            sheet.append(row)
        book.save(self.inventory)
        book.close()
        def sample(ru,cell,pci):
            row = [None]*22
            row[9] = pci
            row[21] = {'baseStationId':ru,'cellId':cell}
            return row
        self.samples = [
            sample('RU0','1',0), sample('RU1','2',1),
            sample('RU2','3',0), sample('RU3','4',0),
            sample('RU4','5',10), sample('UNKNOWN','1',0),
            sample('RU0','1',None), sample('RU0','1',True),
        ]
        detail = self.public/'details.json'
        detail.write_text(json.dumps({'samples':self.samples}),encoding='utf8')
        self.manifest = {
            'meta':{'revision':'voice-fixture','dates':['2026-10-26','2026-10-27']},
            'days':[
                {'dataPath':'details.json','sampleCount':len(self.samples)},
                {'dataPath':'intentionally-missing.json','sampleCount':0},
            ],
        }
        (self.public/'voice-1030.json').write_text(json.dumps(self.manifest),encoding='utf8')

    def tearDown(self):
        self.temp.cleanup()

    def test_full_catalog_keeps_pci_zero_and_exposes_missing_invalid_conflict(self):
        catalog = build_catalog(self.inventory,self.public)
        self.assertEqual(catalog['schemaVersion'],'lte-station-catalog-v1')
        self.assertEqual(catalog['source'],{
            'file':self.inventory.name,
            'sha256':hashlib.sha256(self.inventory.read_bytes()).hexdigest(),
            'fileDate':'2026-11-04',
        })
        self.assertEqual(catalog['summary'],{
            'inputRows':10,'invalidRows':1,'registeredCells':5,'withPci':2,
            'missingPci':1,'invalidPci':1,'conflictingPci':1,'distinctPci':1,
        })
        by_ru = {row[0]:row for row in catalog['rows']}
        self.assertEqual(by_ru['RU0'],['RU0','1',0,37.4,127.0,'valid'])
        self.assertEqual(by_ru['RU2'][2:], [None,37.4,127.2,'missing'])
        self.assertEqual(by_ru['RU3'][2:], [None,37.4,127.3,'invalid'])
        self.assertEqual(by_ru['RU4'][2:], [None,37.4,127.4,'conflict'])
        self.assertNotIn('RU5',by_ru)
        self.assertNotIn('RU6',by_ru)

    def test_observations_compare_only_exact_identity_and_preserve_original_pci(self):
        catalog = build_catalog(self.inventory,self.public)
        self.assertEqual(catalog['observations'],{
            'sourceRevision':'voice-fixture','dates':['2026-10-26','2026-10-27'],
            'total':8,'exactMatched':7,'comparable':2,'matched':1,'mismatched':1,
            'unregistered':1,'unavailable':5,
        })
        original = json.loads((self.public/'details.json').read_text(encoding='utf8'))
        self.assertEqual(original['samples'],self.samples)
        path = write_catalog(catalog,self.public)
        self.assertEqual(path,self.public/'station-catalog.json')
        self.assertEqual(json.loads(path.read_text(encoding='utf8')),catalog)
        self.assertFalse((self.root/'station-catalog.json').exists())

    def test_detail_paths_must_stay_inside_selected_public_directory(self):
        self.manifest['days'][0]['dataPath'] = '../outside.json'
        (self.public/'voice-1030.json').write_text(json.dumps(self.manifest),encoding='utf8')
        with self.assertRaisesRegex(ValueError,'public'):
            build_catalog(self.inventory,self.public)

    def test_inventory_different_from_declared_manifest_is_rejected(self):
        self.manifest['meta']['stationInventory'] = {
            'file':self.inventory.name, 'sha256':'0'*64,
        }
        (self.public/'voice-1030.json').write_text(json.dumps(self.manifest),encoding='utf8')
        with self.assertRaisesRegex(ValueError,'sha256'):
            build_catalog(self.inventory,self.public)


if __name__ == '__main__':
    unittest.main()
