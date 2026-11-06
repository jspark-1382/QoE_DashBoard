"""BYE RAT must come from the selected original end PANI, never LTE MDT or start access."""
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from openpyxl import Workbook

import build_voice_1030 as voice


class VoiceByeRatTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.cdr = self.root/'cdr.xlsx'
        self.mdt = self.root/'mdt.xlsx'
        self.mdt.write_bytes(b'MDT fixture')
        self.lte = self.root/'수도권_LTE_261104.xlsx'
        book = Workbook()
        book.active.append(['cell_id', 'LTERU_ID', 'pci_no', 'latitude', 'longitude'])
        book.active.append(['001', 'LTE-RU', 0, 37.5, 127.0])
        book.save(self.lte)
        book.close()

    def write_cdr(self, rows):
        headers = ['4. START TIME', '5. END TIME', '140. RTCP MOS(v5)',
                   'E2. svc_cont_id', 'E3. Call_ID_edit', '76. BYE CELL ID',
                   '75. BYE 200OK CELL ID', '73. BYE P-Access-Network-Info',
                   '72. BYE 200OK P-Access Network-Info', '110. Start Access Type Flag']
        book = Workbook()
        sheet = book.active
        sheet.append(headers)
        for overrides in rows:
            row = {'4. START TIME': datetime(2026, 10, 30, 10),
                   '5. END TIME': datetime(2026, 10, 30, 10, 1),
                   '140. RTCP MOS(v5)': 2.125, 'E2. svc_cont_id': '0000123',
                   'E3. Call_ID_edit': 'original-edit', '76. BYE CELL ID': '001',
                   '110. Start Access Type Flag': '3: 5G', **overrides}
            sheet.append([row.get(key) for key in headers])
        book.save(self.cdr)
        book.close()

    def test_explicit_end_pani_preserves_nr_lte_unknown_and_not_start_access(self):
        self.write_cdr([
            {'73. BYE P-Access-Network-Info': '3GPP-NR-TDD;utran-cell-id-3gpp=private'},
            {'73. BYE P-Access-Network-Info': '3gpp-nr-fdd;utran-cell-id-3gpp=private'},
            {'73. BYE P-Access-Network-Info': '3GPP-E-UTRAN-FDD;utran-cell-id-3gpp=private'},
            {'73. BYE P-Access-Network-Info': '3GPP-E-UTRAN-TDD;utran-cell-id-3gpp=private'},
            {'73. BYE P-Access-Network-Info': '_'},
            {'73. BYE P-Access-Network-Info': 'IEEE-802.11;other=private'},
        ])
        calls, _audit = voice.read_cdr(self.cdr, 'all')
        self.assertEqual([call.get('endRat') for call in calls], ['NR', 'NR', 'LTE', 'LTE', None, None])
        self.assertTrue(all(call['mos'] == 2.125 for call in calls))
        self.assertTrue(all(call['contract'] == '0000123' and call['endCellId'] == '001' for call in calls))
        for row_number, call in enumerate(calls, 2):
            expected = 'call-'+voice.sha_key('cdr-leg', '0000123', call['startDt'].isoformat(),
                                            call['endDt'].isoformat(), 'original-edit', row_number)
            self.assertEqual(call['id'], expected)

    def test_end_pani_is_paired_with_chosen_bye_or_200ok_cell(self):
        self.write_cdr([
            {'73. BYE P-Access-Network-Info': '3GPP-NR-TDD;x=private',
             '72. BYE 200OK P-Access Network-Info': '3GPP-E-UTRAN-FDD;x=private',
             '75. BYE 200OK CELL ID': '002'},
            {'76. BYE CELL ID': '_', '75. BYE 200OK CELL ID': '002',
             '73. BYE P-Access-Network-Info': '3GPP-NR-TDD;x=private',
             '72. BYE 200OK P-Access Network-Info': '3GPP-E-UTRAN-FDD;x=private'},
            {'73. BYE P-Access-Network-Info': '_', '75. BYE 200OK CELL ID': '002',
             '72. BYE 200OK P-Access Network-Info': '3GPP-NR-TDD;x=private'},
        ])
        calls, _audit = voice.read_cdr(self.cdr, 'all')
        self.assertEqual([call['endCellId'] for call in calls], ['001', '002', '001'])
        self.assertEqual([call.get('endRat') for call in calls], ['NR', 'LTE', None])

    def test_partition_exports_end_rat_without_raw_pani_and_preserves_lte_metadata(self):
        self.write_cdr([{'73. BYE P-Access-Network-Info': '3GPP-NR-TDD;private-location=secret'}])
        calls, _audit = voice.read_cdr(self.cdr, 'all')
        calls[0]['matchStatus'] = 'UNMATCHED'
        output = self.root/'public/voice-1030.json'
        audit = {'cdrFile': self.cdr.name, 'mdtFile': self.mdt.name,
                 'lteMasterFile': self.lte.name, 'lteMasterSha256': 'lte-digest',
                 'lteMasterAudit': {'pciColumnPresent': True},
                 'nrMasterFile': '수도권_5G_261106.xlsx', 'nrMasterSha256': 'nr-digest'}
        voice.publish(calls, [], audit, output, 'fixture')
        manifest = json.loads(output.read_text(encoding='utf8'))
        self.assertEqual(manifest['meta']['stationInventory'], {'file': self.lte.name,
                         'sha256': 'lte-digest', 'pciColumnPresent': True})
        self.assertEqual(manifest['meta'].get('byeStationInventories'), [
            {'technology': 'LTE', 'file': self.lte.name, 'sha256': 'lte-digest'},
            {'technology': 'NR', 'file': '수도권_5G_261106.xlsx', 'sha256': 'nr-digest'},
        ])
        detail_text = (output.parent/manifest['days'][0]['dataPath']).read_text(encoding='utf8')
        detail = json.loads(detail_text)
        self.assertEqual(detail['calls'][0].get('endRat'), 'NR')
        self.assertEqual(detail['calls'][0]['id'], calls[0]['id'])
        self.assertNotIn('private-location', detail_text)
        self.assertNotIn('secret', detail_text)
        self.assertEqual(detail['rats'], ['LTE'], 'existing optional radio samples remain LTE-scoped')
        self.assertEqual(manifest['meta']['baseStations'], [])

    def run_empty_build(self, nr=None):
        self.cdr.write_bytes(b'CDR fixture')
        out = self.root/'public/voice-1030.json'
        audit_path = self.root/'audit.json'
        argv = ['build_voice_1030.py', '--cdr', str(self.cdr), '--mdt', str(self.mdt),
                '--lte-master', str(self.lte), '--master', str(self.root/'missing.txt'),
                '--out', str(out), '--audit', str(audit_path)]
        if nr is not None:
            argv += ['--nr-master', str(nr)]
        matching = {'cdrMatched': 0, 'cdrAmbiguous': 0, 'cdrUnmatched': 0}
        with patch.dict(os.environ, {}, clear=True), patch('sys.argv', argv), \
             patch.object(voice, 'read_cdr', return_value=([], {})), \
             patch.object(voice, 'read_mdt', return_value=([], {})), \
             patch.object(voice, 'build_candidate_maps', return_value=({}, matching)), \
             patch.object(voice, 'publish', return_value={}) as publish:
            voice.main()
        return json.loads(audit_path.read_text(encoding='utf8')), publish.call_args

    def test_nr_inventory_content_changes_revision_without_entering_lte_radio_master(self):
        nr = self.root/'수도권_5G_261106.xlsx'
        nr.write_bytes(b'NR version one')
        audit, first = self.run_empty_build(nr)
        self.assertEqual(audit['masterSources'], [self.lte.name, nr.name])
        self.assertEqual(audit.get('nrMasterFile'), nr.name)
        self.assertEqual(audit.get('nrMasterSha256'), hashlib.sha256(nr.read_bytes()).hexdigest())
        self.assertEqual(first.args[1], [], 'NR inventory is BYE lineage only, never LTE MDT matching')
        nr.write_bytes(b'NR version two')
        _audit, second = self.run_empty_build(nr)
        self.assertNotEqual(first.args[4], second.args[4])

    def test_optional_nr_auto_selection_is_local_to_selected_lte_inventory(self):
        self.assertTrue(hasattr(voice, 'resolve_optional_nr_master'))
        with patch.dict(os.environ, {}, clear=True):
            self.assertIsNone(voice.resolve_optional_nr_master(directory=self.root))
            older = self.root/'수도권_5G_261105.xlsx'
            latest = self.root/'수도권_5G_261106.xlsx'
            older.touch(); latest.touch()
            self.assertEqual(voice.resolve_optional_nr_master(directory=self.root), latest)
            self.assertEqual(voice.resolve_optional_nr_master(older, self.root), older)
        with patch.dict(os.environ, {'QOE_NR_MASTER': str(self.root/'missing.xlsx')}, clear=True):
            with self.assertRaises(FileNotFoundError):
                voice.resolve_optional_nr_master(directory=self.root)
        with self.assertRaises(FileNotFoundError):
            voice.resolve_optional_nr_master(self.root/'explicit-missing.xlsx', self.root)

    def test_legacy_lte_only_build_has_no_optional_nr_dependency(self):
        audit, _call = self.run_empty_build()
        self.assertEqual(audit['masterSources'], [self.lte.name])
        self.assertIsNone(audit.get('nrMasterFile'))

    def test_main_auto_discovers_nr_beside_the_selected_lte_workbook(self):
        nr = self.root/'수도권_5G_261106.xlsx'
        nr.write_bytes(b'optional NR inventory')
        audit, _call = self.run_empty_build()
        self.assertEqual(audit['nrMasterFile'], nr.name)
        self.assertEqual(audit['masterSources'], [self.lte.name, nr.name])

    def test_explicit_missing_nr_is_rejected_before_reading_sources(self):
        self.cdr.write_bytes(b'CDR fixture')
        argv = ['build_voice_1030.py', '--cdr', str(self.cdr), '--mdt', str(self.mdt),
                '--lte-master', str(self.lte), '--nr-master', str(self.root/'missing-nr.xlsx')]
        with patch.dict(os.environ, {}, clear=True), patch('sys.argv', argv), \
             patch.object(voice, 'read_cdr') as reader, self.assertRaises(SystemExit) as failure:
            voice.main()
        self.assertEqual(failure.exception.code, 2)
        reader.assert_not_called()


if __name__ == '__main__':
    unittest.main()
