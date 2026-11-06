"""Protect LTE 261103 RU+Cell exact matching from repeated CellID ambiguity."""
from pathlib import Path
import os
import hashlib
import json
import tempfile
import unittest
from unittest.mock import patch

from openpyxl import Workbook
import lte_station_catalog
import build_voice_1030 as voice
from lte_station_catalog import load_lte_catalog,load_unique_bye_cells
from mdt_pipeline import _match_station, _station_indices


class NewLteCatalogTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name)/'metro.xlsx'
        book=Workbook()
        sheet=book.active
        sheet.append(['cell_id','LTERU_ID','latitude','longitude'])
        sheet.append([345, 'RU1', 37.4, 127.0])
        sheet.append([345, 'RU2', 37.5, 127.1])
        sheet.append([678, 'RU3', 37.6, 127.2])
        sheet.append([679, 'RU4', None, 127.3])
        sheet.append([700, 'RU5', 91, 127.4])
        book.save(self.path);book.close()

    def tearDown(self):
        self.temp.cleanup()

    def test_reused_cell_id_never_cell_only_locates_device(self):
        stations,audit=load_lte_catalog(
            self.path,{('RU1','345'),('RU2','345'),('RU3','678'),('BAD','345')},
            {'345','678','999'},
        )
        self.assertEqual(len(stations),3)
        self.assertEqual(audit['matchedExactPairs'],3)
        self.assertEqual(audit['cdrCellIdsMultipleRows'],1)
        self.assertEqual(audit['cdrCellIdsUniqueRow'],1)
        self.assertEqual(audit['cdrCellIdsNotFound'],1)
        self.assertEqual(audit['invalidRows'],2)
        index=_station_indices(stations)
        for ru in ('RU1','RU2'):
            ids=_match_station({'baseStationId':ru,'cellId':'345','frequency':None},stations,index,'new')
            self.assertEqual(len(ids),1)
            self.assertEqual(stations[ids[0]]['baseStationId'],ru)
        self.assertEqual(_match_station({'baseStationId':'BAD','cellId':'345','frequency':None},stations,index,'new'),[])
        self.assertEqual(_match_station({'baseStationId':'RU1','cellId':'678','frequency':None},stations,index,'new'),[])

    def test_bye_cell_site_is_allowed_only_when_ru_identity_is_unambiguous(self):
        sites,audit=load_unique_bye_cells(
            self.path, {'345','678','679','700','999'}
        )
        self.assertEqual(set(sites),{'678'})
        self.assertEqual(sites['678']['ruId'],'RU3')
        self.assertEqual((sites['678']['lat'],sites['678']['lon']),(37.6,127.2))
        self.assertEqual(audit['ambiguousCells'],1)
        self.assertEqual(audit['invalidCells'],2)
        self.assertEqual(audit['missingCells'],1)
        self.assertEqual(audit['uniqueSiteCells'],1)

    def test_conflicting_ru_cell_duplicate_is_rejected(self):
        from openpyxl import load_workbook
        book=load_workbook(self.path)
        book.active.append([345,'RU1',37.9,127.9])
        book.save(self.path);book.close()
        stations,audit=load_lte_catalog(self.path,{('RU1','345'),('RU2','345')})
        self.assertEqual(len(stations),1)
        self.assertEqual(stations[0]['baseStationId'],'RU2')
        self.assertEqual(audit['requestedPairsCoordinateConflicts'],1)

    def write_pci_inventory(self):
        book=Workbook();sheet=book.active
        sheet.append(['cell_id','LTERU_ID','pci_no','latitude','longitude'])
        rows=[
            [1,'RU0',0,37.4,127.0], [2,'RU1',503,37.4,127.1],
            [3,'RU2',None,37.4,127.2], [4,'RU3',True,37.4,127.3],
            [5,'RU4',504,37.4,127.4], [6,'RU5',1.5,37.4,127.5],
            [7,'RU6',100,37.4,127.6], [7,'RU6',101,37.4,127.6],
            [8,'RU7',102,37.4,127.7], [8,'RU7',102,37.5,127.7],
            [9,'RU8',0,37.4,127.8],
        ]
        for row in rows:sheet.append(row)
        book.save(self.path);book.close()

    def test_pci_inventory_preserves_zero_and_does_not_join_by_pci(self):
        self.write_pci_inventory()
        requested={(f'RU{i}',str(i+1)) for i in range(9)}
        stations,audit=load_lte_catalog(self.path,requested)
        by_ru={s['baseStationId']:s for s in stations}
        self.assertEqual(by_ru['RU0']['pci'],0)
        self.assertEqual(by_ru['RU1']['pci'],503)
        self.assertEqual(by_ru['RU2']['inventoryPciStatus'],'missing')
        for ru in ('RU3','RU4','RU5'):
            self.assertIsNone(by_ru[ru]['pci'])
            self.assertEqual(by_ru[ru]['inventoryPciStatus'],'invalid')
        self.assertIsNone(by_ru['RU6']['pci'])
        self.assertEqual(by_ru['RU6']['inventoryPciStatus'],'conflict')
        self.assertEqual(by_ru['RU6']['inventoryPciCandidates'],[100,101])
        self.assertNotIn('RU7',by_ru)
        self.assertEqual(audit['requestedPairsCoordinateConflicts'],1)
        self.assertEqual(audit['requestedPairsPciConflicts'],1)
        self.assertTrue(audit['pciColumnPresent'])
        self.assertEqual(_match_station({'baseStationId':'UNKNOWN','cellId':'','pci':0,'frequency':None},
            stations,_station_indices(stations),'new'),[])

    def test_bye_pci_conflict_with_unique_site_is_explicit_not_a_fake_single_pci(self):
        self.write_pci_inventory()
        sites,audit=load_unique_bye_cells(self.path,{'1','7','8'})
        self.assertEqual(sites['1']['pci'],0)
        self.assertEqual(sites['1']['inventoryPciStatus'],'valid')
        self.assertEqual(sites['7']['inventoryPciStatus'],'conflict')
        self.assertIsNone(sites['7']['pci'])
        self.assertEqual(sites['7']['inventoryPciCandidates'],[100,101])
        self.assertNotIn('8',sites)
        self.assertEqual(audit['uniqueSitePciConflicts'],1)

    def test_latest_inventory_resolution_and_explicit_override(self):
        self.assertTrue(hasattr(lte_station_catalog,'resolve_lte_master'))
        first=self.path.parent/'수도권_LTE_261103.xlsx'
        latest=self.path.parent/'수도권_LTE_261104.xlsx'
        first.touch();latest.touch()
        with patch.dict(os.environ,{},clear=True):
            self.assertEqual(lte_station_catalog.resolve_lte_master(directory=self.path.parent),latest)
        with patch.dict(os.environ,{'QOE_LTE_MASTER':str(first)}):
            self.assertEqual(lte_station_catalog.resolve_lte_master(directory=self.path.parent),first)
            self.assertEqual(lte_station_catalog.resolve_lte_master(latest),latest)
        with self.assertRaises(FileNotFoundError):
            lte_station_catalog.resolve_lte_master(self.path.parent/'missing.xlsx')

    def test_voice_build_excludes_missing_optional_legacy_from_revision_and_sources(self):
        cdr=self.path.parent/'cdr.xlsx';cdr.write_bytes(b'cdr fixture')
        mdt=self.path.parent/'mdt.xlsx';mdt.write_bytes(b'mdt fixture')
        legacy=self.path.parent/'missing.txt'
        audit_path=self.path.parent/'audit.json'
        out_path=self.path.parent/'staging'/'voice-1030.json'
        args=['build_voice_1030.py','--cdr',str(cdr),'--mdt',str(mdt),
              '--lte-master',str(self.path),'--master',str(legacy),
              '--out',str(out_path),'--audit',str(audit_path)]
        matching={'cdrMatched':0,'cdrAmbiguous':0,'cdrUnmatched':0}
        with patch('sys.argv',args), patch.object(voice,'read_cdr',return_value=([],{})), \
             patch.object(voice,'read_mdt',return_value=([],{})), \
             patch.object(voice,'build_candidate_maps',return_value=({},matching)), \
             patch.object(voice,'publish',return_value={}) as publish:
            voice.main()
        audit=json.loads(audit_path.read_text(encoding='utf-8'))
        self.assertEqual(audit['masterSources'],[self.path.name])
        self.assertFalse(audit['legacyMasterPresent'])
        self.assertEqual(audit['masterErrors'],[])
        self.assertEqual(audit['lteMasterFile'],self.path.name)
        self.assertEqual(audit['lteMasterSha256'],hashlib.sha256(self.path.read_bytes()).hexdigest())
        self.assertEqual(publish.call_args.args[3],out_path)

    def test_manifest_separates_inventory_lineage_from_observed_sample_pci(self):
        out_path=self.path.parent/'staging'/'voice-1030.json'
        audit={'cdrFile':'cdr.xlsx','mdtFile':'mdt.xlsx',
               'lteMasterFile':self.path.name,'lteMasterSha256':'fixture-sha',
               'lteMasterAudit':{'pciColumnPresent':True}}
        voice.publish([],[],audit,out_path,'fixture-revision')
        meta=json.loads(out_path.read_text(encoding='utf-8'))['meta']
        self.assertEqual(meta['stationInventory'],{
            'file':self.path.name,'sha256':'fixture-sha','pciColumnPresent':True})
        self.assertEqual(meta['sampleFields'][9],'pci')

if __name__=='__main__':
    unittest.main()
