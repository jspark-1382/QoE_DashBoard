"""Multiple workbooks must preserve CDR legs and join optional MDT evidence."""
from datetime import datetime
from pathlib import Path
import tempfile
import unittest

from openpyxl import Workbook
import build_voice_1030 as voice


class MultiSourceTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def cdr(self, name, rows):
        path = self.root / name
        book = Workbook()
        headers = ['4. START TIME', '5. END TIME', '140. RTCP MOS(v5)',
                   'E2. svc_cont_id', 'E3. Call_ID_edit', '10. RESULT', 'unused-source-evidence']
        book.active.append(headers)
        for values in rows:
            row = dict(zip(headers, [datetime(2026, 10, 26, 10), datetime(2026, 10, 26, 10, 1),
                                     2.5, '000123', 'same-edit', 'normal']))
            row.update(values)
            book.active.append([row.get(h) for h in headers])
        book.save(path)
        book.close()
        return path

    def test_discovers_all_eight_files_and_ignores_excel_locks(self):
        old_cdr = '261026_1030_SIP_Call_All_1.xlsx'
        old_mdt = '261026_1030_VoLTE+MDT.xlsx'
        for name in [old_cdr, old_mdt, 'notes.xlsx', '~$(261026) SIP_Call_All_1.xlsx',
                     'volte+mdt(new).xlsx', *[f'(2610{d}) SIP_Call_All_1.xlsx' for d in range(26, 31)]]:
            (self.root/name).touch()
        cdr, mdt = voice.discover_sources(self.root)
        self.assertEqual(len(cdr), 6)
        self.assertEqual(len(mdt), 2)
        self.assertEqual(cdr[0].name, old_cdr)
        self.assertEqual(mdt[0].name, old_mdt)

    def test_cross_file_duplicates_preserve_same_file_legs_and_original_id(self):
        first = self.cdr('old.xlsx', [{}, {}])
        second = self.cdr('new.xlsx', [{}, {'10. RESULT': 'different-leg'}])
        original, _ = voice.read_cdr(first, 'all')
        calls, audit, sources = voice.read_cdr_files([first, second], 'all')
        self.assertEqual(len(calls), 3)
        self.assertEqual([c['id'] for c in calls[:2]], [c['id'] for c in original])
        self.assertEqual(len({c['id'] for c in calls}), 3)
        self.assertTrue(all(c['contract'] == '000123' for c in calls))
        self.assertEqual(audit['inputRows'], 4)
        self.assertEqual(audit['excludedCrossFileDuplicates'], 1)
        self.assertEqual(audit['publishedCalls'], 3)
        self.assertEqual(len(sources), 2)

    def test_new_files_with_same_row_number_do_not_collide(self):
        first = self.cdr('first.xlsx', [{'10. RESULT': 'a'}])
        second = self.cdr('second.xlsx', [{'10. RESULT': 'b'}])
        third = self.cdr('third.xlsx', [{'10. RESULT': 'c'}])
        calls, _, _ = voice.read_cdr_files([first, second, third], 'all')
        self.assertEqual(len({c['id'] for c in calls}), 3)
        self.assertTrue(all(c['startDt'].hour == 10 and c['mos'] == 2.5 for c in calls))

    def test_duplicate_multiplicity_uses_the_largest_single_source_count(self):
        first = self.cdr('first.xlsx', [{}])
        second = self.cdr('second.xlsx', [{}, {}])
        calls, audit, _ = voice.read_cdr_files([first, second], 'all')
        self.assertEqual(len(calls), 2)
        self.assertEqual(audit['excludedCrossFileDuplicates'], 1)

    def test_deduplication_uses_columns_that_are_not_displayed(self):
        first = self.cdr('first.xlsx', [{'unused-source-evidence': 'one'}])
        second = self.cdr('second.xlsx', [{'unused-source-evidence': 'two'}])
        calls, _, _ = voice.read_cdr_files([first, second], 'all')
        self.assertEqual(len(calls), 2)

    def test_different_source_headers_are_not_falsely_deduplicated(self):
        first = self.cdr('first.xlsx', [{'unused-source-evidence': 'one'}])
        second = self.cdr('second.xlsx', [{'unused-source-evidence': 'one'}])
        from openpyxl import load_workbook
        book = load_workbook(second)
        book.active.cell(1, 7).value = 'different-source-evidence'
        book.save(second)
        book.close()
        calls, _, _ = voice.read_cdr_files([first, second], 'all')
        self.assertEqual(len(calls), 2)

    def test_excel_1904_epoch_and_leading_zero_identifiers_are_preserved(self):
        from openpyxl.utils.datetime import MAC_EPOCH
        path = self.cdr('mac.xlsx', [{}])
        from openpyxl import load_workbook
        book = load_workbook(path)
        book.epoch = MAC_EPOCH
        book.save(path)
        book.close()
        calls, _ = voice.read_cdr(path, 'all')
        self.assertEqual(calls[0]['startDt'].isoformat(), '2026-10-26T10:00:00+09:00')
        self.assertEqual(calls[0]['contract'], '000123')

    def test_invalid_text_timestamp_cannot_suppress_valid_numeric_timestamp(self):
        import zipfile
        import xml.etree.ElementTree as ET
        from openpyxl import load_workbook
        first = self.cdr('first.xlsx', [{}])
        second = self.cdr('second.xlsx', [{}])
        ns = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
        with zipfile.ZipFile(second) as archive:
            sheet = ET.fromstring(archive.read('xl/worksheets/sheet1.xml'))
            serial = next(c.findtext(ns+'v') for c in sheet.iter(ns+'c') if c.get('r') == 'A2')
        book = load_workbook(first)
        book.active.cell(2, 1).value = serial
        book.save(first)
        book.close()
        calls, audit, _ = voice.read_cdr_files([first, second], 'all')
        self.assertEqual(len(calls), 1)
        self.assertEqual(audit['excludedDifferentDateOrTime'], 1)
        self.assertEqual(audit['excludedCrossFileDuplicates'], 0)

    def test_mdt_missing_mos_is_supported_and_cross_file_events_merge(self):
        headers = ['base_date', 'svc_cont_id', 'lte_vc_div', 'occ_dt',
                   'svc_ctgry_st_ymd', 'svc_ctgry_st_hhmiss', 'rsrp']
        paths = []
        for name, stamps in [('old.xlsx', ['20261026100000', '20261026100001']),
                             ('new.xlsx', ['20261026100001', '20261026100002'])]:
            book = Workbook()
            book.active.append(headers)
            for stamp in stamps:
                book.active.append(['20261026', '000123', 'call-key', stamp, '20261026', '100000', -100])
            path = self.root/name
            book.save(path)
            book.close()
            paths.append(path)
        groups, audit, sources = voice.read_mdt_files(paths, 'all', {'000123'})
        self.assertEqual(len(groups), 1)
        self.assertEqual(len(groups[0]['events']), 3)
        self.assertEqual(audit['inputRows'], 4)
        self.assertEqual(audit['excludedCrossFileDuplicateEvents'], 1)
        self.assertEqual(len(sources), 2)


if __name__ == '__main__':
    unittest.main()
