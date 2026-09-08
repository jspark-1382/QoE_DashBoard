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


if __name__ == '__main__':
    unittest.main()
