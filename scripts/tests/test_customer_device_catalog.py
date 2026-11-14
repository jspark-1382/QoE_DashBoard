"""Customer-side device evidence must never borrow the other party's handset."""
import json
import sqlite3
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

from openpyxl import Workbook
from openpyxl.utils.datetime import MAC_EPOCH, to_excel

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import build_customer_device_catalog as catalog


class CustomerDeviceCatalogTests(unittest.TestCase):
    def row(self, **changes):
        value = {
            '4. START TIME': datetime(2026, 10, 26, 9, 25, 59),
            '9. CALL DIR': '10: 5G 음성 발신',
            'E2. svc_cont_id': 'test-contract',
            '126. DEVICE INVITE': 'SM-S916N',
            '127. DEVICE 200OK': 'SM-PEER',
            '20. USER AGENT Invite': '',
            '21. USER AGENT 200OK': 'iPhone/1.0',
        }
        value.update(changes)
        return value

    def test_outgoing_and_incoming_choose_the_local_device(self):
        self.assertEqual(catalog.model_for_row(self.row()), 'SM-S916N')
        self.assertEqual(catalog.model_for_row(self.row(**{'9. CALL DIR': '11: 5G 음성 착신'})), 'SM-PEER')

    def test_direction_code_and_label_must_agree(self):
        for direction in ['', '10', '10: 5G 음성 착신', '11: 5G 음성 발신',
                          '12: 기타', '12: 5G 음성 발신', '99: 착신', '10: 발신/착신', '발신 착신']:
            with self.subTest(direction=direction):
                self.assertIsNone(catalog.model_for_row(self.row(**{'9. CALL DIR': direction})))

    def test_other_observed_sip_voice_and_video_labels_keep_the_customer_side(self):
        outgoing = ['1: VoLTE To VoLTE(발신)', '3: VoLTE To MGW(발신)',
                    '5: PSVT To PSVT(발신)', '14: 5G 영상 발신', '16: 5G to 3G 영상 발신']
        incoming = ['2: VoLTE To VoLTE(착신)', '4: MGW To VoLTE(착신)',
                    '6: PSVT To PSVT(착신)', '15: 5G 영상 착신']
        for direction in outgoing:
            self.assertEqual(catalog.model_for_row(self.row(**{'9. CALL DIR': direction})), 'SM-S916N')
        for direction in incoming:
            self.assertEqual(catalog.model_for_row(self.row(**{'9. CALL DIR': direction})), 'SM-PEER')
        self.assertIsNone(catalog.model_for_row(self.row(**{'9. CALL DIR': '1: VoLTE To VoLTE(착신)'})))
        self.assertIsNone(catalog.model_for_row(self.row(**{'9. CALL DIR': '9: ETC'})))

    def test_empty_local_device_never_borrows_peer_device_or_ua(self):
        self.assertIsNone(catalog.model_for_row(self.row(**{'126. DEVICE INVITE': ''})))
        incoming = self.row(**{'9. CALL DIR': '11: 5G 음성 착신', '127. DEVICE 200OK': '',
                               '21. USER AGENT 200OK': '', '20. USER AGENT Invite': 'iPhone/1.0'})
        self.assertIsNone(catalog.model_for_row(incoming))

    def test_iphone_fallback_is_local_and_does_not_invent_generation(self):
        self.assertEqual(catalog.model_for_row(self.row(**{'126. DEVICE INVITE': '',
            '20. USER AGENT Invite': 'TTA-VoLTE/2.0 iOS/27.0.1 iPhone/1.0/KT'})), 'iPhone')
        self.assertIsNone(catalog.model_for_row(self.row(**{'126. DEVICE INVITE': '',
            '20. USER AGENT Invite': 'TTA-VoLTE/3.0 Device_Type/Android_Phone KT'})))

    def test_placeholders_and_identifiers_are_not_models(self):
        for value in ['', '_', '-', 'NULL', 'NaN', 'unknown', 'N/A', 'Android', '123456789012345',
                      'TTA-VoLTE/3.0 SM-S916N/ZI1 Device_Type/Android_Phone KT']:
            with self.subTest(value=value):
                self.assertIsNone(catalog.model_for_row(self.row(**{'126. DEVICE INVITE': value})))

    def test_scope_dates_minutes_and_existing_customer_identity(self):
        from build_voice_1030 import sha_key
        record = catalog.observation(self.row(), {'2026-10-26'})
        self.assertEqual(record, ('mdt-' + sha_key('mdt', 'test-contract'), '2026-10-26', 565, 'SM-S916N'))
        self.assertIsNone(catalog.observation(self.row(), {'2026-10-27'}))
        self.assertIsNone(catalog.observation(self.row(**{'4. START TIME': 'bad'}), {'2026-10-26'}))
        self.assertIsNone(catalog.observation(self.row(**{'E2. svc_cont_id': 'NULL'}), {'2026-10-26'}))
        last = catalog.observation(self.row(**{'4. START TIME': datetime(2026, 10, 26, 23, 59, 59)}), {'2026-10-26'})
        self.assertEqual(last[2], 1439)

    def test_streaming_reader_converts_mac_excel_epoch(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'source.xlsx'
            workbook = Workbook()
            workbook.epoch = MAC_EPOCH
            workbook.active.append(list(self.row()))
            row = self.row(**{'4. START TIME': to_excel(datetime(2026, 10, 26, 14, 5), MAC_EPOCH)})
            workbook.active.append(list(row.values()))
            workbook.save(path)
            actual = list(catalog.projected_rows(path))
            self.assertEqual(actual[0]['4. START TIME'], datetime(2026, 10, 26, 14, 5))

    def test_catalog_preserves_multiple_models_and_deduplicates_same_minute(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'sources'
            source.mkdir()
            path = source / 'SIP_Call_sample.xlsx'
            workbook = Workbook()
            workbook.active.append(list(self.row()))
            rows = [self.row(), self.row(), self.row(**{'126. DEVICE INVITE': 'SM-F731N'}),
                    self.row(**{'4. START TIME': datetime(2026, 10, 27, 9, 25)})]
            for row in rows:
                workbook.active.append(list(row.values()))
            workbook.save(path)
            result = catalog.build_catalog(root, [path], 'revision-a', ['2026-10-26'])
            db = sqlite3.connect(root / result['database'])
            self.assertEqual(db.execute('SELECT model FROM customer_devices ORDER BY model').fetchall(), [('SM-F731N',), ('SM-S916N',)])
            self.assertEqual(json.loads(db.execute("SELECT json FROM meta WHERE key='schema'").fetchone()[0]), 'customer-device-db-v1')
            self.assertEqual(json.loads(db.execute("SELECT json FROM meta WHERE key='sourceRevision'").fetchone()[0]), 'revision-a')
            self.assertEqual({r[1] for r in db.execute('PRAGMA table_info(customer_devices)')}, {'customer_id', 'date', 'minute', 'model'})
            db.close()
            self.assertEqual(result['audit']['inputRows'], 4)
            self.assertEqual(result['audit']['observations'], 2)
            self.assertFalse((root / 'public/customer-device-index.json').exists())

    def test_publish_rechecks_revision_before_replacing_pointer(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'public').mkdir()
            (root / 'public/voice-query-index.json').write_text(json.dumps({'sourceRevision': 'revision-b'}))
            original = root / 'public/customer-device-index.json'
            original.write_text('{"old":true}')
            with self.assertRaisesRegex(ValueError, 'revision'):
                catalog.publish_index(root, {'sourceRevision': 'revision-a', 'database': 'outputs/missing.sqlite'})
            self.assertEqual(original.read_text(), '{"old":true}')

    def test_source_files_are_bound_to_the_current_voice_revision(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'SIP_Call_current.xlsx').touch()
            (root / '~$SIP_Call_current.xlsx').touch()
            meta = {'sourceFiles': ['SIP_Call_current.xlsx', 'other-mdt.xlsx']}
            self.assertEqual([p.name for p in catalog.source_paths(root, meta)], ['SIP_Call_current.xlsx'])
            (root / 'SIP_Call_extra.xlsx').touch()
            with self.assertRaisesRegex(ValueError, 'revision'):
                catalog.source_paths(root, meta)

    def test_source_fingerprint_detects_same_size_content_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'SIP_Call.xlsx'
            path.write_bytes(b'original')
            expected = catalog.source_fingerprint([path], {'pipeline': 'test'})
            path.write_bytes(b'changed!')
            self.assertNotEqual(catalog.source_fingerprint([path], {'pipeline': 'test'}), expected)


if __name__ == '__main__':
    unittest.main()
