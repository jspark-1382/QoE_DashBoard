import tempfile
import unittest
from pathlib import Path
from base_station_master import coordinate, load_master


class MasterTest(unittest.TestCase):
    def test_dms_and_invalid(self):
        self.assertAlmostEqual(coordinate('35-13-07.410', 90), 35.218725)
        self.assertAlmostEqual(coordinate('126-52-03.750', 180), 126.8677083333)
        self.assertIsNone(coordinate('35-60-00', 90))
        self.assertIsNone(coordinate('100-00-00', 90))

    def test_duplicate_headers_and_multifrequency(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'master.csv'
            path.write_bytes('CellID,CellID,주파수,PCI,위도,경도\nA,123,1550+1694,200,35-13-07.410,126-52-03.750\n'.encode('cp949'))
            stations, errors = load_master(path)
            self.assertEqual(errors, [])
            self.assertEqual([s['frequency'] for s in stations], [1550, 1694])
            self.assertTrue(all(s['cellId'] == '123' and s['baseStationId'] == 'A' for s in stations))

    def test_headerless_txt_has_station_coordinates_without_inventing_cell(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'BaseStation_new.txt'
            path.write_text('\ufeff A ,37.5,127.1\nB,,\nC,NaN,127.2\nD,91,127\nE,37,127,extra\n', encoding='utf-8')
            stations, errors = load_master(path)
            self.assertEqual(stations, [{
                'baseStationId': 'A', 'cellId': '', 'frequency': None,
                'latitude': 37.5, 'longitude': 127.1, 'pci': None,
                'isVirtual': False, 'provenanceUnknown': True, 'matchLevel': 'station',
            }])
            self.assertEqual(len(errors), 4)
            self.assertTrue(all('BaseStation_new.txt' in error for error in errors))
            self.assertTrue(any('2행' in error for error in errors))

    def test_txt_duplicate_ids_are_deduped_and_coordinate_conflicts_excluded(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'master.txt'
            path.write_text('A,37,127\nA,37,127\nB,37,127\nB,38,128\n', encoding='utf-8')
            stations, errors = load_master(path)
            self.assertEqual([station['baseStationId'] for station in stations], ['A'])
            self.assertEqual(len(errors), 2)
            self.assertTrue(any('충돌' in error for error in errors))


if __name__ == '__main__':
    unittest.main()
