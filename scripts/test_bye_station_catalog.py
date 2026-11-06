"""BYE sites require an unambiguous RAT/RU/coordinate identity, not a PCI hit."""
from collections import Counter
import copy
import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from openpyxl import Workbook
from shapely.geometry import box

from bye_station_catalog import (
    load_bye_catalog, normalize_end_rat, resolve_bye_site,
    resolve_manifest_nr_catalog, verify_bye_inventory_provenance,
)
import administrative_dong as mapper


class ByeStationCatalogTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.lte = self.root/'lte.xlsx'
        self.nr = self.root/'nr.xlsx'
        self.write(self.lte, ['cell_id','LTERU_ID','pci_no','latitude','longitude'], [
            ['dual','LTE-D',7,37.5,127.05], ['lte-only','LTE-A',0,37.5,127.0],
            ['invalid-dual','LTE-B',3,None,127.0],
            ['same-position','LTE-S',1,37.5,127.0],
        ])
        self.write(self.nr, ['ru_id','cell_id','pci','latitude','longitude'], [
            ['NR-D','dual',1007,37.6,127.06], ['NR-A','nr-only',0,37.501,127.001],
            ['NR-R1','reused',700,37.5,127.0], ['NR-R2','reused',700,37.5,127.0],
            ['NR-C','coord-conflict',800,37.5,127.0], ['NR-C','coord-conflict',800,37.6,127.0],
            ['NR-I','invalid-dual',1,37.5,127.0],
            ['NR-P','pci-conflict',600,37.5,127.0], ['NR-P','pci-conflict',601,37.5,127.0],
            ['NR-S','same-position',1,37.5,127.0],
            ['NR-L','0009007199254740993',504,37.5,127.0],
        ])

    def write(self, path, header, rows):
        book=Workbook();sheet=book.active;sheet.append(header)
        for row in rows:sheet.append(row)
        book.save(path);book.close()

    def catalog(self):
        return load_bye_catalog(self.lte,self.nr,{
            'dual','lte-only','nr-only','reused','coord-conflict',
            'invalid-dual','pci-conflict','same-position','0009007199254740993','missing',
        })

    def declared(self):
        return {'meta':{'byeStationInventories':[
            {'technology':tech,'file':path.name,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
            for tech,path in [('LTE',self.lte),('NR',self.nr)]
        ]}}

    def test_unknown_rat_requires_one_identity_across_both_inventories(self):
        catalog,audit=self.catalog()
        self.assertIsNone(resolve_bye_site(catalog,'dual'))
        self.assertIsNone(resolve_bye_site(catalog,'same-position'))
        self.assertIsNone(resolve_bye_site(catalog,'reused'))
        self.assertIsNone(resolve_bye_site(catalog,'coord-conflict'))
        self.assertIsNone(resolve_bye_site(catalog,'invalid-dual'))
        self.assertIsNone(resolve_bye_site(catalog,'missing'))
        self.assertEqual(resolve_bye_site(catalog,'lte-only')['technology'],'LTE')
        self.assertEqual(resolve_bye_site(catalog,'nr-only')['technology'],'NR')
        self.assertGreaterEqual(audit['ambiguousCells'],3)
        self.assertGreaterEqual(audit['invalidCells'],1)

    def test_explicit_rat_disambiguates_only_its_own_radio_and_never_falls_across(self):
        catalog,_=self.catalog()
        self.assertEqual(resolve_bye_site(catalog,'dual','LTE')['ruId'],'LTE-D')
        self.assertEqual(resolve_bye_site(catalog,'dual','5G')['ruId'],'NR-D')
        self.assertEqual(resolve_bye_site(catalog,'dual','NR')['pci'],1007)
        self.assertIsNone(resolve_bye_site(catalog,'lte-only','NR'))
        self.assertIsNone(resolve_bye_site(catalog,'nr-only','LTE'))
        self.assertIsNone(resolve_bye_site(catalog,'dual','unrecognized'))
        self.assertEqual(resolve_bye_site(catalog,'invalid-dual','NR')['ruId'],'NR-I')
        self.assertIsNone(resolve_bye_site(catalog,'invalid-dual','LTE'))
        for value,result in [('LTE','LTE'),(' 4g ','LTE'),('NR','NR'),('5G','NR'),('',None),(None,None),('VoLTE',None)]:
            self.assertEqual(normalize_end_rat(value),result)

    def test_pci_uncertainty_does_not_fabricate_site_identity_and_original_ids_survive(self):
        catalog,_=self.catalog()
        site=resolve_bye_site(catalog,'pci-conflict','NR')
        self.assertEqual(site['technology'],'NR')
        self.assertIsNone(site['pci'])
        self.assertEqual(site['inventoryPciStatus'],'conflict')
        self.assertEqual(site['inventoryPciCandidates'],[600,601])
        self.assertEqual(resolve_bye_site(catalog,'nr-only')['pci'],0)
        self.assertEqual(resolve_bye_site(catalog,'0009007199254740993')['cellId'],'0009007199254740993')
        self.assertEqual(resolve_bye_site(catalog,'0009007199254740993')['pci'],504)

    def test_nr_is_optional_for_legacy_lte_and_unrequested_cells_are_not_exposed(self):
        catalog,audit=load_bye_catalog(self.lte,None,{'lte-only','missing'})
        self.assertEqual(resolve_bye_site(catalog,'lte-only')['ruId'],'LTE-A')
        self.assertIsNone(resolve_bye_site(catalog,'dual'))
        self.assertIsNone(resolve_bye_site(catalog,'lte-only','NR'))
        self.assertEqual(audit['requestedCells'],2)
        self.assertEqual(audit['uniqueSiteCells'],1)
        self.assertEqual(audit['missingCells'],1)

    def test_duplicate_coordinate_or_invalid_candidate_is_not_dropped_before_ambiguity_checks(self):
        catalog,_=self.catalog()
        self.assertIsNone(resolve_bye_site(catalog,'coord-conflict','NR'))
        self.assertIsNone(resolve_bye_site(catalog,'reused','NR'))
        self.assertIsNone(resolve_bye_site(catalog,'invalid-dual'))
        site=resolve_bye_site(catalog,'lte-only')
        self.assertEqual(site['source'],'lte.xlsx')
        self.assertEqual(site['sourceSha256'],hashlib.sha256(self.lte.read_bytes()).hexdigest())

    def test_declared_inventory_set_requires_every_radio_file_and_matching_content(self):
        manifest=self.declared()
        self.assertTrue(verify_bye_inventory_provenance(manifest,self.lte,self.nr))
        self.assertFalse(verify_bye_inventory_provenance({'meta':{}},self.lte,None))
        with self.assertRaisesRegex(ValueError,'inventory|Inventory'):
            verify_bye_inventory_provenance(manifest,self.lte,None)
        wrong=copy.deepcopy(manifest);wrong['meta']['byeStationInventories'][1]['sha256']='0'*64
        with self.assertRaisesRegex(ValueError,'sha256'):
            verify_bye_inventory_provenance(wrong,self.lte,self.nr)
        for metadata in (None,[],[{'technology':'NR','file':'nr.xlsx'}],manifest['meta']['byeStationInventories']*2):
            with self.subTest(metadata=metadata),self.assertRaises(ValueError):
                verify_bye_inventory_provenance({'meta':{'byeStationInventories':metadata}},self.lte,self.nr)

    def test_manifest_nr_resolution_uses_only_the_declared_sibling_file_or_verified_explicit_path(self):
        manifest=self.declared()
        self.assertEqual(resolve_manifest_nr_catalog(manifest,self.lte),self.nr)
        self.assertEqual(resolve_manifest_nr_catalog(manifest,self.lte,self.nr),self.nr)
        self.assertIsNone(resolve_manifest_nr_catalog({'meta':{}},self.lte))
        lte_only=copy.deepcopy(manifest)
        lte_only['meta']['byeStationInventories']=lte_only['meta']['byeStationInventories'][:1]
        self.assertIsNone(resolve_manifest_nr_catalog(lte_only,self.lte))
        with self.assertRaises(ValueError):
            resolve_manifest_nr_catalog(lte_only,self.lte,self.nr)
        self.nr.unlink()
        with self.assertRaises(FileNotFoundError):
            resolve_manifest_nr_catalog(manifest,self.lte)

    def test_declared_paths_cannot_escape_inventory_directory_and_changes_during_read_fail(self):
        manifest=self.declared()
        manifest['meta']['byeStationInventories'][1]['file']='../nr.xlsx'
        with self.assertRaises(ValueError):
            resolve_manifest_nr_catalog(manifest,self.lte)
        import bye_station_catalog as resolver
        original=resolver._rows
        def changing(path,technology,audit):
            yield from original(path,technology,audit)
            Path(path).write_bytes(b'changed after the workbook was read')
        with patch.object(resolver,'_rows',side_effect=changing),self.assertRaisesRegex(ValueError,'changed'):
            load_bye_catalog(self.lte,self.nr,{'lte-only'})

    def test_admin_mapper_preserves_primary_gnss_and_adds_separate_rat_aware_bye_support(self):
        calls=[
            {'id':'gnss','endCellId':'nr-only','endRat':'NR','mos':4.2,'start':'10:00:00'},
            {'id':'fallback','endCellId':'nr-only','mos':2.2,'start':'10:00:00'},
            {'id':'ambiguous','endCellId':'dual','mos':2.3,'start':'10:00:00'},
            {'id':'explicit','endCellId':'dual','endRat':'NR','mos':2.4,'start':'10:00:00'},
        ]
        overview={'calls':copy.deepcopy(calls),'date':'2026-10-30'}
        x,y=mapper.forward_5186(37.49,127.01)
        primary=[('gnss',x,y,'gnss',37.49,127.01,'2026-10-30T01:00:00Z','2026-10-30T01:00:10Z',10,{'estimationMethod':'GNSS'})]
        region={'id':'adm:test','label':'test','lat':37.5,'lon':127.0,'coordinates':[],
                'bbox':(-1000000,-1000000,2000000,2000000),'geometry':box(-1000000,-1000000,2000000,2000000)}
        with patch.object(mapper,'check_prj'),patch.object(mapper,'read_dbf',return_value=[{'BASE_DATE':'20251101'}]),\
             patch.object(mapper,'get_normalized_points',return_value=(primary,Counter())),\
             patch.object(mapper,'read_local_boundaries',return_value=[region]):
            audit=mapper.attach(overview,self.declared(),self.root,self.root/'fake.shp',self.root/'points.json',self.lte,self.nr)
        points={p['callId']:p for p in overview['callLocations']}
        self.assertEqual(points['gnss']['evidence'],'gnss')
        self.assertEqual((points['gnss']['lat'],points['gnss']['lon']),(37.49,127.01))
        self.assertEqual(points['gnss']['byeTechnology'],'NR')
        self.assertEqual((points['gnss']['byeStationLat'],points['gnss']['byeStationLon']),(37.501,127.001))
        self.assertEqual(points['fallback']['evidence'],'bye-cell')
        self.assertEqual(points['fallback']['byeTechnology'],'NR')
        self.assertEqual(points['explicit']['byeRuId'],'NR-D')
        self.assertEqual(points['ambiguous']['byeRuId'],'LTE-D')
        self.assertEqual(points['ambiguous']['byeSelectionMethod'],'first')
        self.assertEqual(points['ambiguous']['byeCandidateCount'],2)
        self.assertEqual(points['gnss']['byeSelectionMethod'],'unique')
        self.assertEqual(audit['noUniqueByeCellFallbackCalls'],0)
        self.assertEqual(audit['locatedByeCellCalls'],3)
        self.assertEqual(overview['byeInventorySources'],self.declared()['meta']['byeStationInventories'])
        self.assertEqual([call['mos'] for call in overview['calls']],[call['mos'] for call in calls])


if __name__=='__main__':
    unittest.main()
