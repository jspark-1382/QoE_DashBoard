"""Small real XLSX fixtures verify ingestion semantics and public output privacy."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

SCRIPT = Path(__file__).with_name('extract_mdt_data.py').resolve()
HEADERS = ['base_date', 'svc_cont_id', 'lte_vc_div', 'wless_data_conn_timezn_cd',
           'rqt_timestamp', 'svc_ctgry_st_ymd', 'svc_ctgry_st_hhmiss',
           'svc_ctgry_fns_ymd', 'svc_ctgry_fns_hhmiss', 'out_in_div_cd',
           'ccal_fns_type_cd', 'sip_cause', 'q850_cause', 'fc', 'file_nm',
           'origin_host', 'ims_chage_id', 'start_cell_id', 'fns_cell_id', 'mdt_cnt',
           'occ_dt', 'mdt_num', 'mdt_div', 'bts_maker_nm', 'rpt_type', 'trigr_ev',
           'mdt_cell_id', 'mdt_equip_cd', 'dlearfcn', 'gnss_utmkx', 'gnss_utmky',
           'gnss_metric_id', 'rsrp', 'rsrq', 'nsinr', 'phr', 'pci', 'n1_pci',
           'n1_rsrp', 'n2_pci', 'n2_rsrp']


def column(index):
    name = ''
    while index:
        index, remainder = divmod(index - 1, 26)
        name = chr(65 + remainder) + name
    return name


def write_xlsx(path, rows, headers=HEADERS):
    path.parent.mkdir(parents=True, exist_ok=True)
    xml_rows = []
    for row_number, values in enumerate([dict(zip(headers, headers)), *rows], 1):
        cells = ''.join(f'<c r="{column(index)}{row_number}" t="inlineStr"><is><t>{escape(str(values.get(key, "")))}</t></is></c>'
                        for index, key in enumerate(headers, 1))
        xml_rows.append(f'<row r="{row_number}">{cells}</row>')
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('xl/worksheets/sheet1.xml', '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + ''.join(xml_rows) + '</sheetData></worksheet>')


def report(**updates):
    row = {key: '' for key in HEADERS}
    row.update(base_date='20260915', svc_cont_id='PRIVATE-CONTRACT-A',
               lte_vc_div='PRIVATE-CALL-A', ims_chage_id='PRIVATE-IMS-SHARED',
               svc_ctgry_st_ymd='20260915', svc_ctgry_st_hhmiss='090000',
               svc_ctgry_fns_ymd='20260915', svc_ctgry_fns_hhmiss='090002',
               occ_dt='20260915090001.000', mdt_equip_cd='STATION-A',
               mdt_cell_id='CELL-1', dlearfcn='1550', rsrp='-95', rsrq='-12.5',
               nsinr='10', pci='0', mdt_num='1', mdt_div='IN', mdt_cnt='5',
               out_in_div_cd='1', ccal_fns_type_cd='2', sip_cause='200',
               q850_cause='16', fc='0')
    row.update(updates)
    return row


class PipelineTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.source = self.root / 'data' / 'MDT_New'
        self.master = self.root / 'data' / 'BaseStation' / 'BaseStation_new.txt'
        self.master.parent.mkdir(parents=True)
        self.master.write_text('STATION-A,37.5,127.1\nMISSING,,\n', encoding='utf-8')
        (self.root / 'public').mkdir()

    def tearDown(self):
        self.temporary.cleanup()

    def extract(self, *arguments, success=True):
        result = subprocess.run([sys.executable, str(SCRIPT), *arguments], cwd=self.root,
                                text=True, encoding='utf-8', capture_output=True,
                                env={**os.environ, 'PYTHONUTF8': '1'})
        if success:
            self.assertEqual(result.returncode, 0, result.stderr)
            return json.loads((self.root / 'public/mdt-data.json').read_text(encoding='utf-8'))
        self.assertNotEqual(result.returncode, 0)
        return result

    def details(self, manifest):
        self.assertTrue(manifest['days'], 'MDT input must create customer/day partitions')
        self.assertTrue(all('dataPath' in day for day in manifest['days']), 'Manifest must reference partitions')
        return [json.loads((self.root / 'public' / day['dataPath']).read_text(encoding='utf-8')) for day in manifest['days']]

    def test_keys_preserve_contracts_and_call_divisions_and_dedup_exact_rows(self):
        # Grouping by IMS would mix two customers or collapse separate source calls.
        row = report()
        write_xlsx(self.source / 'a.xlsx', [row, row, report(lte_vc_div='PRIVATE-CALL-B'),
                                          report(svc_cont_id='PRIVATE-CONTRACT-B')])
        write_xlsx(self.source / 'b.xlsx', [row])
        manifest = self.extract()
        self.assertIn('schemaVersion', manifest['meta'], 'New MDT contract is missing')
        self.assertEqual(manifest['meta']['schemaVersion'], 'mdt-v2')
        self.assertTrue(manifest['meta']['partitioned'])
        self.assertEqual(manifest['meta']['sourceRows'], {'a.xlsx': 4, 'b.xlsx': 1})
        self.assertEqual(manifest['meta']['dedupe']['duplicateRowsRemoved'], 2)
        self.assertEqual(manifest['meta']['totalCalls'], 3)
        self.assertEqual(len(manifest['customers']), 2)
        self.assertEqual(sorted(day['callCount'] for day in manifest['days']), [1, 2])
        self.assertTrue(all(day['samples'] == [] for day in manifest['days']))
        self.assertEqual(sum(len(day['samples']) for day in self.details(manifest)), 3)
        for customer in manifest['customers']:
            self.assertEqual(customer.get('sourceContractId'), customer['displayName'].removeprefix('계약 '))
            self.assertEqual(customer['maskedPhone'], '서비스계약번호 기준')
        public_text = ''.join(path.read_text(encoding='utf-8') for path in (self.root / 'public').rglob('*.json'))
        for raw_id in ['PRIVATE-CALL-A', 'PRIVATE-CALL-B', 'PRIVATE-IMS-SHARED']:
            self.assertNotIn(raw_id, public_text)
        first_ids = sorted(customer['id'] for customer in manifest['customers'])
        self.assertEqual(first_ids, sorted(customer['id'] for customer in self.extract()['customers']))

    def test_qoe_only_uses_call_window_and_preserves_end_second_and_phr_reports(self):
        # Outside events must not inflate QoE; PHR and exact-zero fields must survive.
        rows = [report(occ_dt='20260915085959.999', rsrp='-70', rsrq='-5', nsinr='25'),
                report(occ_dt='20260915090000.000', rsrp='-120', rsrq='-20', nsinr='-5'),
                report(occ_dt='20260915090002.999', rsrp='-120', rsrq='-20', nsinr='-5'),
                report(occ_dt='20260915090003.000', rsrp='-70', rsrq='-5', nsinr='25'),
                report(occ_dt='20260915090001.500', rsrp='NULL', rsrq='_', nsinr='', phr='0',
                       gnss_utmkx='123456', gnss_utmky='234567', n1_pci='0', n1_rsrp='-110')]
        write_xlsx(self.source / 'a.xlsx', rows)
        manifest = self.extract()
        day = self.details(manifest)[0]
        call = day['calls'][0]
        self.assertEqual(call['qoe'], 1)
        self.assertEqual(call['radioCount'], 4)
        self.assertEqual(call['qoeSampleCount'], 2)
        self.assertEqual(call['mdtCount'], 5)
        self.assertEqual(call['rsrp'], -120)
        self.assertEqual(call['startTimestamp'], '2026-09-15T09:00:00+09:00')
        self.assertEqual(call['endTimestamp'], '2026-09-15T09:00:02+09:00')
        self.assertEqual([sample[21]['inCallWindow'] for sample in day['samples']], [False, True, True, True, False])
        self.assertTrue(all(sample[2:4] == [None, None] for sample in day['samples']))
        self.assertTrue(all(sample[9] == 0 for sample in day['samples']))
        phr = next(sample for sample in day['samples'] if sample[21]['phr'] == 0)
        self.assertEqual(phr[10:13], [None, None, None])
        self.assertEqual(phr[21]['neighbors'], [{'pci': 0, 'rsrp': -110}])
        self.assertEqual(phr[21]['gnssUtmkx'], 123456)
        self.assertEqual(phr[21]['locationSource'], 'unavailable')
        self.assertEqual(day['baseStations'][0]['matchLevel'], 'station')
        self.assertEqual(manifest['meta']['coverage']['stationMatchedRadioEvents'], 4)

    def test_missing_mdt_and_outside_only_calls_are_preserved_as_unscored(self):
        write_xlsx(self.source / 'a.xlsx', [report(occ_dt='', rsrp='', rsrq='', nsinr=''),
                                          report(lte_vc_div='PRIVATE-CALL-B', occ_dt='20260915085900',
                                                 mdt_equip_cd='UNKNOWN-STATION')])
        manifest = self.extract()
        day = self.details(manifest)[0]
        self.assertEqual(manifest['meta']['totalCalls'], 2)
        self.assertEqual(manifest['meta']['unscoredCalls'], 2)
        self.assertEqual(len(day['calls']), 2)
        self.assertEqual(len(day['samples']), 1)
        self.assertTrue(all(call['qoe'] is None for call in day['calls']))
        self.assertEqual(sorted(call['hasMdt'] for call in day['calls']), [False, True])
        self.assertEqual(manifest['meta']['coverage']['stationUnmatchedRadioEvents'], 1)
        self.assertEqual(day['samples'][0][16], None)

    def test_zero_sinr_is_scored_and_missing_markers_remain_null(self):
        write_xlsx(self.source / 'a.xlsx', [report(rsrp='', rsrq='_', nsinr='0', phr='NULL')])
        day = self.details(self.extract())[0]
        self.assertEqual(day['calls'][0]['qoe'], 1.67)
        self.assertEqual(day['samples'][0][12], 0)
        self.assertIsNone(day['samples'][0][21]['phr'])

    def test_cdr_cell_ids_survive_without_mdt_events_or_customer_coordinates(self):
        write_xlsx(self.source / 'a.xlsx', [report(
            svc_cont_id='00001234', start_cell_id='000123456789', fns_cell_id='000987654321',
            occ_dt='', rsrp='', rsrq='', nsinr='', mdt_cnt='0')])
        manifest = self.extract()
        day = self.details(manifest)[0]
        call = day['calls'][0]
        self.assertEqual((call.get('startCellId'), call.get('endCellId')),
                         ('000123456789', '000987654321'))
        self.assertEqual(day['sourceContractId'], '00001234')
        self.assertEqual(day['samples'], [])
        self.assertEqual(day['baseStations'], [])
        self.assertFalse(call['hasMdt'])
        self.assertEqual(call['mdtCount'], 0)
        self.assertIsNone(call['qoe'])
        self.assertEqual(manifest['meta']['unscoredCalls'], 1)
        published_path = self.root / 'public' / manifest['days'][0]['dataPath']
        published_bytes = published_path.read_bytes()
        write_xlsx(self.source / 'a.xlsx', [report(
            svc_cont_id='00001234', start_cell_id='000123456780', fns_cell_id='000987654321',
            occ_dt='', rsrp='', rsrq='', nsinr='', mdt_cnt='0')])
        revised = self.extract()
        self.assertNotEqual(revised['meta']['revision'], manifest['meta']['revision'])
        self.assertEqual(self.details(revised)[0]['calls'][0]['startCellId'], '000123456780')
        self.assertEqual(published_path.read_bytes(), published_bytes)

    def test_missing_cdr_cell_ids_are_empty_strings_even_when_mdt_has_a_cell(self):
        write_xlsx(self.source / 'a.xlsx', [report(start_cell_id='NULL', fns_cell_id='_')])
        day = self.details(self.extract())[0]
        call = day['calls'][0]
        self.assertEqual((call.get('startCellId'), call.get('endCellId')), ('', ''))
        self.assertEqual(day['samples'][0][21]['cellId'], 'CELL-1')
        self.assertTrue(call['hasMdt'])

    def test_default_prefers_new_folder_and_explicit_legacy_directory_uses_csv(self):
        write_xlsx(self.source / 'a.xlsx', [report()])
        legacy_source = self.root / 'data/MDT'
        legacy_headers = ['기준년월일', '서비스계약', '통화호구분', 'ims_charge_id', '시작시간', '종료시간',
                          'MDT발생일시', '기지국ID(MDT)', 'Cell_ID(MDT)', '주파수(MDT)', 'rsrp', 'rsrq', 'nsinr']
        legacy = dict(zip(legacy_headers, ['20260914', 'LEGACY-CONTRACT', 'LEGACY-CALL', 'LEGACY-IMS',
                                         '09:00:00', '09:00:02', '20260914090001', 'OLD-STATION',
                                         'OLD-CELL', '1550', '-100', '-15', '0']))
        write_xlsx(legacy_source / 'legacy.xlsx', [legacy], legacy_headers)
        (self.master.parent / 'virtual_base_station.csv').write_text('base_station_id,cell_id,frequency,latitude,longitude\nOLD-STATION,OLD-CELL,1550,35,126\n', encoding='utf-8')
        self.assertEqual(self.extract()['meta']['dates'], ['2026-09-15'])
        manifest = self.extract('--source-dir', 'data/MDT')
        self.assertEqual(manifest['meta']['dates'], ['2026-09-14'])
        day = self.details(manifest)[0]
        self.assertEqual(day['baseStations'][0]['cellId'], 'OLD-CELL')
        self.assertIsNone(day['samples'][0][2])
        self.assertEqual(len(day['calls']), 1)

    def test_failed_input_keeps_previous_manifest_and_published_partitions(self):
        write_xlsx(self.source / 'a.xlsx', [report()])
        before = self.extract()
        before_bytes = (self.root / 'public/mdt-data.json').read_bytes()
        write_xlsx(self.source / 'a.xlsx', [{'bad': 'row'}], ['bad'])
        self.extract(success=False)
        self.assertEqual((self.root / 'public/mdt-data.json').read_bytes(), before_bytes)
        self.assertTrue((self.root / 'public' / before['days'][0]['dataPath']).exists())

    def test_unobserved_call_day_has_explicit_zero_coverage_and_no_timestamp(self):
        write_xlsx(self.source / 'a.xlsx', [report(occ_dt='', svc_ctgry_st_hhmiss='_',
                                                 svc_ctgry_fns_hhmiss='NULL')])
        manifest = self.extract()
        day = self.details(manifest)[0]
        self.assertEqual(day['coverage'].get('totalEvents'), 0)
        self.assertEqual(day['coverage']['stationMatchedRadioEvents'], 0)
        self.assertEqual(day['coverage']['matchedBaseStationCount'], 0)
        self.assertEqual(day['coverage']['unmatchedBaseStationIds'], [])
        self.assertNotIn('startTimestamp', day['calls'][0])
        self.assertEqual(manifest['customers'][0]['callCount'], 1)

    def test_confirmed_gnss_crs_converts_by_default_and_explicit_unknown_disables_it(self):
        # The independent EPSG origin control is 38N,127.5E at x=1M,y=2M.
        write_xlsx(self.source / 'a.xlsx', [report(gnss_utmkx='1000000', gnss_utmky='2000000')])
        enabled = self.extract()
        self.assertEqual(enabled['meta'].get('gnssCrs'), 'EPSG:5179')
        disabled = self.extract('--gnss-crs', 'unknown')
        self.assertEqual(disabled['meta'].get('gnssCrs'), 'unknown')
        self.assertEqual(self.details(disabled)[0]['samples'][0][2:4], [None, None])
        self.assertEqual(self.details(disabled)[0]['samples'][0][21]['gnssUtmkx'], 1000000)
        sample = self.details(enabled)[0]['samples'][0]
        self.assertAlmostEqual(sample[2], 38, places=6)
        self.assertAlmostEqual(sample[3], 127.5, places=6)
        self.assertEqual(sample[21]['gnssCrs'], 'EPSG:5179')
        self.assertEqual(sample[21]['locationSource'], 'gnss')
        self.assertEqual(enabled['meta']['coverage']['gnssConvertedEvents'], 1)
        self.assertNotEqual(disabled['meta']['revision'], enabled['meta']['revision'])

    def test_original_contract_text_preserves_leading_zeroes_for_comparison(self):
        write_xlsx(self.source / 'a.xlsx', [report(svc_cont_id='0000123400'), report(svc_cont_id='123400')])
        manifest = self.extract()
        self.assertEqual({customer.get('sourceContractId') for customer in manifest['customers']}, {'0000123400', '123400'})
        self.assertEqual(len(manifest['customers']), 2)
        self.assertEqual({customer['displayName'] for customer in manifest['customers']}, {'계약 0000123400', '계약 123400'})
        self.assertEqual({day.get('sourceContractId') for day in manifest['days']}, {'0000123400', '123400'})
        details = self.details(manifest)
        self.assertEqual({day.get('sourceContractId') for day in details}, {'0000123400', '123400'})
        for day in details:
            self.assertTrue(all('sourceContractId' not in sample[21] for sample in day['samples']))
            self.assertTrue(all('sourceContractId' not in call for call in day['calls']))
            self.assertNotIn('PRIVATE-IMS-SHARED', json.dumps(day))
            self.assertNotIn('PRIVATE-CALL-A', json.dumps(day))

    def test_customer_gnss_and_qoe_counts_use_only_in_call_events(self):
        rows = [report(occ_dt='20260915085959', gnss_utmkx='1000000', gnss_utmky='2000000'),
                report(occ_dt='20260915090000', gnss_utmkx='1000000', gnss_utmky='2000000', rsrp='', rsrq='', nsinr='', phr='1'),
                report(occ_dt='20260915090001'), report(occ_dt='20260915090002')]
        write_xlsx(self.source / 'a.xlsx', rows)
        manifest = self.extract()
        customer = manifest['customers'][0]
        self.assertEqual(customer.get('gnssSampleCount'), 1)
        self.assertEqual(customer.get('qoeSampleCount'), 2)
        self.assertEqual(manifest['days'][0].get('gnssSampleCount'), 1)
        self.assertEqual(manifest['days'][0].get('qoeSampleCount'), 2)
        day = self.details(manifest)[0]
        self.assertEqual(day.get('gnssSampleCount'), 1)
        self.assertEqual(day['coverage']['gnssConvertedEvents'], 2)
        self.assertEqual(day['sampleCount'], 4)
        disabled = self.extract('--gnss-crs', 'unknown')
        self.assertEqual(disabled['customers'][0].get('gnssSampleCount'), 0)
        self.assertEqual(disabled['customers'][0].get('qoeSampleCount'), 2)

    def test_legacy_missing_contract_does_not_publish_call_key_as_contract(self):
        legacy_headers = ['기준년월일', '서비스계약', '통화호구분', 'ims_charge_id', '시작시간', '종료시간', 'MDT발생일시', 'rsrp']
        legacy = dict(zip(legacy_headers, ['20260914', '_', 'LEGACY-PRIVATE-CALL', 'LEGACY-PRIVATE-IMS',
                                         '09:00:00', '09:00:02', '20260914090001', '-100']))
        write_xlsx(self.source / 'legacy.xlsx', [legacy], legacy_headers)
        manifest = self.extract()
        customer = manifest['customers'][0]
        self.assertNotIn('sourceContractId', customer)
        self.assertTrue(customer['displayName'].startswith('가입자 '))
        self.assertNotIn('sourceContractId', manifest['days'][0])
        day = self.details(manifest)[0]
        self.assertNotIn('sourceContractId', day)
        self.assertNotIn('LEGACY-PRIVATE-CALL', json.dumps(day))
        self.assertNotIn('LEGACY-PRIVATE-IMS', json.dumps(day))

    def test_mixed_schema_files_keep_their_station_masters_separate(self):
        # A shared station ID must not make legacy events acquire new TXT coordinates.
        write_xlsx(self.source / 'new.xlsx', [report(mdt_equip_cd='UNKNOWN-STATION', mdt_cell_id='OLD-CELL')])
        legacy_headers = ['기준년월일', '서비스계약', '통화호구분', '시작시간', '종료시간',
                          'MDT발생일시', '기지국ID(MDT)', 'Cell_ID(MDT)', '주파수(MDT)', 'rsrp']
        legacy = dict(zip(legacy_headers, ['20260914', 'LEGACY', 'LEGACY-CALL', '09:00:00', '09:00:02',
                                         '20260914090001', 'STATION-A', 'OLD-CELL', '1550', '-100']))
        write_xlsx(self.source / 'legacy.xlsx', [legacy], legacy_headers)
        (self.master.parent / 'virtual_base_station.csv').write_text('base_station_id,cell_id,frequency,latitude,longitude\nSTATION-A,OLD-CELL,1550,35,126\nUNKNOWN-STATION,OLD-CELL,1550,36,126\n', encoding='utf-8')
        details = {day['date']: day for day in self.details(self.extract())}
        self.assertEqual(details['2026-09-14']['baseStations'][0]['latitude'], 35)
        self.assertEqual(details['2026-09-15']['baseStations'], [])

    def test_ambiguous_cell_master_is_not_treated_as_a_coordinate_match(self):
        write_xlsx(self.source / 'a.xlsx', [report()])
        ambiguous = self.master.parent / 'ambiguous.csv'
        ambiguous.write_text('base_station_id,cell_id,frequency,latitude,longitude\nSTATION-A,CELL-1,1550,35,126\nSTATION-A,CELL-1,1550,37,127\n', encoding='utf-8')
        day = self.details(self.extract('--master', str(ambiguous)))[0]
        self.assertEqual(day['baseStations'], [])
        self.assertFalse(day['samples'][0][21]['baseStationMatched'])


if __name__ == '__main__':
    unittest.main()
