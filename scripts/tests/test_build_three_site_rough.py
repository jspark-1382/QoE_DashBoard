"""Safety tests for conservative RSRP-weighted three-site map evidence."""
import unittest,sys,os,subprocess,tempfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent.parent))
from build_three_site_rough import centroid_candidate,physical_sites,distance_m

def row(t,lat,lon,rsrp=-85):
    return {'time':t,'coord':(lat,lon),'rsrp':rsrp,'ru':'RU','cell':'100','timestamp':'2026-10-30T12:00:00+09:00'}

class RoughThreeSiteTest(unittest.TestCase):
    def test_import_and_help_do_not_require_default_inventory_from_current_directory(self):
        scripts=Path(__file__).resolve().parent.parent
        environment={key:value for key,value in os.environ.items() if key!='QOE_LTE_MASTER'}
        with tempfile.TemporaryDirectory(prefix='qoe-three-site-import-') as directory:
            imported=subprocess.run([
                sys.executable,'-B','-X','utf8','-c',
                'import sys;sys.path.insert(0,sys.argv[1]);'
                'from build_three_site_rough import build_site_catalog;'
                'assert build_site_catalog([], "explicit-inventory.xlsx")=={}',
                str(scripts),
            ],cwd=directory,env=environment,capture_output=True,text=True)
            self.assertEqual(imported.returncode,0,imported.stderr)
            help_result=subprocess.run([
                sys.executable,'-B','-X','utf8',str(scripts/'build_three_site_rough.py'),'--help',
                '--lte-master',str(Path(directory)/'explicit-inventory.xlsx'),
            ],cwd=directory,env=environment,capture_output=True,text=True)
            self.assertEqual(help_result.returncode,0,help_result.stderr)
            self.assertIn('--lte-master',help_result.stdout)

    def test_no_two_site_handset_location(self):
        self.assertIsNone(centroid_candidate([
            row(100,37.5,127),row(101,37.503,127.002)],105))

    def test_colocated_sectors_are_one_site(self):
        same=[row(100,37.5,127,-80),row(101,37.50001,127.00001,-90),row(102,37.5,127.00002,-83)]
        self.assertEqual(len(physical_sites(same)),1)
        self.assertIsNone(centroid_candidate(same,105))

    def test_future_radio_does_not_enter_history(self):
        sites=[row(100,37.5,127),row(103,37.504,127.003),row(110,37.506,127.008)]
        self.assertIsNone(centroid_candidate(sites,105))

    def test_rough_search_area_and_weighted_center(self):
        sites=[row(100,37.5,127,-64),row(101,37.504,127.003,-90),row(102,37.505,127.009,-98)]
        c=centroid_candidate(sites,104)
        self.assertIsNotNone(c)
        self.assertEqual(c['usedSiteCount'],3)
        self.assertGreaterEqual(c['roughSearchRadiusM'],700)
        self.assertLess(c['lon'],127.005)
        self.assertLess(c['lat'],37.504)
        self.assertIsNone(c.get('estimatedAccuracyM'))

    def test_distant_sites_rejected(self):
        sites=[row(100,37.5,127),row(101,37.54,127),row(102,37.55,127.05)]
        self.assertIsNone(centroid_candidate(sites,105))

    def test_observations_older_than_window_excluded(self):
        sites=[row(60,37.5,127),row(80,37.504,127.003),row(100,37.505,127.009)]
        self.assertIsNone(centroid_candidate(sites,105))

if __name__=="__main__":unittest.main()
