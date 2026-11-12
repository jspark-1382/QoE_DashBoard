import json
from pathlib import Path
import tempfile
import unittest

from rebuild_voice_ui import promote, query_ready


class PublishTest(unittest.TestCase):
    def test_query_store_requires_revision_and_contained_existing_database(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            public = root/'public'
            public.mkdir()
            database = root/'outputs/voice-query-data/current.sqlite'
            database.parent.mkdir(parents=True)
            database.write_bytes(b'fixture')
            index = {'schemaVersion': 'voice-query-index-v1', 'databaseSchema': 'voice-query-db-v1',
                     'sourceRevision': 'one', 'database': 'outputs/voice-query-data/current.sqlite'}
            target = public/'voice-query-index.json'
            target.write_text(json.dumps(index), encoding='utf-8')
            self.assertTrue(query_ready(public, 'one', root))
            self.assertFalse(query_ready(public, 'two', root))
            index['database'] = '../outside.sqlite'
            target.write_text(json.dumps(index), encoding='utf-8')
            self.assertFalse(query_ready(public, 'one', root))

    def test_publication_preserves_previous_files_and_immutable_revisions(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            stage, public, backup = [root/name for name in ('stage', 'public', 'backup')]
            for folder in (stage, public):
                folder.mkdir()
            (public/'voice-1030.json').write_text('old', encoding='utf-8')
            (stage/'voice-1030.json').write_text('new', encoding='utf-8')
            (public/'voice-1030-data'/'old').mkdir(parents=True)
            (stage/'voice-1030-data'/'new').mkdir(parents=True)
            (stage/'voice-1030-data'/'new'/'detail.json').write_text('{}', encoding='utf-8')
            promote(stage, public, backup)
            self.assertEqual((public/'voice-1030.json').read_text(), 'new')
            self.assertEqual((backup/'voice-1030.json').read_text(), 'old')
            self.assertTrue((public/'voice-1030-data'/'old').is_dir())
            self.assertTrue((public/'voice-1030-data'/'new'/'detail.json').is_file())

    def test_overlapping_stage_and_public_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaises(ValueError):
                promote(root, root/'public', root/'backup')


if __name__ == '__main__':
    unittest.main()
