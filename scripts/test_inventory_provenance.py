"""Inventory refresh must never relabel sidecars built from another workbook."""
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

from inventory_provenance import verify_inventory_provenance


class InventoryProvenanceTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='qoe-inventory-provenance-')
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.inventory = self.directory/'inventory.xlsx'
        self.inventory.write_bytes(b'fixture inventory bytes')
        self.manifest = {'meta': {'stationInventory': {
            'file': self.inventory.name,
            'sha256': hashlib.sha256(self.inventory.read_bytes()).hexdigest(),
        }}}

    def test_legacy_manifest_without_inventory_metadata_remains_supported(self):
        self.assertFalse(verify_inventory_provenance({'meta': {}}, None))

    def test_matching_file_and_content_are_verified(self):
        self.assertTrue(verify_inventory_provenance(self.manifest, self.inventory))

    def test_same_bytes_under_another_filename_are_rejected(self):
        other = self.directory/'another.xlsx'
        other.write_bytes(self.inventory.read_bytes())
        with self.assertRaisesRegex(ValueError, 'file'):
            verify_inventory_provenance(self.manifest, other)

    def test_same_filename_with_wrong_content_is_rejected(self):
        self.inventory.write_bytes(b'updated without rebuilding the manifest')
        with self.assertRaisesRegex(ValueError, 'sha256'):
            verify_inventory_provenance(self.manifest, self.inventory)

    def test_present_but_incomplete_metadata_is_rejected(self):
        for metadata in (None, {}, {'file': self.inventory.name},
                         {'file': self.inventory.name, 'sha256': 'invalid'}):
            with self.subTest(metadata=metadata), self.assertRaises(ValueError):
                verify_inventory_provenance({'meta': {'stationInventory': metadata}}, self.inventory)

    def test_present_metadata_requires_a_selected_inventory(self):
        with self.assertRaisesRegex(ValueError, 'selected'):
            verify_inventory_provenance(self.manifest, None)

    def test_overview_cli_rejects_wrong_file_and_hash_before_output(self):
        public = self.directory/'public'
        public.mkdir()
        root = Path(__file__).resolve().parent.parent
        for field, value in (('file', 'different.xlsx'), ('sha256', '0'*64)):
            with self.subTest(field=field):
                manifest = json.loads(json.dumps(self.manifest))
                manifest['meta'].update({'dates': [], 'qoeBasis': 'rtcp-mos-v5'})
                manifest['meta']['stationInventory'][field] = value
                manifest['days'] = []
                (public/'voice-1030.json').write_text(json.dumps(manifest), encoding='utf8')
                result = subprocess.run([
                    'node', str(root/'scripts/build-analyst-overview.cjs'), 'MDT',
                    '--public-dir', str(public), '--bye-catalog', str(self.inventory),
                ], cwd=root, capture_output=True, encoding='utf8')
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('Inventory provenance', result.stderr)
                self.assertFalse((public/'analyst-overview').exists())


if __name__ == '__main__':
    unittest.main()
