"""Protect LTE 261103 RU+Cell exact matching from repeated CellID ambiguity."""
from pathlib import Path
import tempfile
import unittest

from openpyxl import Workbook
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

if __name__=='__main__':
    unittest.main()
