from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import build_quality_ui as pipeline
from build_quality_ui import merge_coverage, sparse_document
from build_voice_improvement_1 import coverage


class QualityUiBuildTest(unittest.TestCase):
    def document(self, day):
        calls = [dict(callId=day+str(i), date=day, mos=mos, mdtLinkStatus=status)
                 for i, (mos, status) in enumerate([(2, 'unique'), (4, 'none'), (None, 'ambiguous')])]
        decisions = [dict(callId=c['callId'], status='accepted' if i == 0 else 'excluded',
                          kind='gnss' if i == 0 else None, reasons=[] if i == 0 else ['no-location'])
                     for i, c in enumerate(calls)]
        return dict(calls=calls, decisions=decisions, coverage=coverage(calls, decisions),
                    inputFiles=[], provenance={}, inputHash=day)

    def test_aggregated_coverage_matches_full_original_census(self):
        docs = [self.document('2026-10-26'), self.document('2026-10-27')]
        expected = coverage([c for d in docs for c in d['calls']], [r for d in docs for r in d['decisions']])
        self.assertEqual(merge_coverage([d['coverage'] for d in docs]), expected)

    def test_sparse_ranges_retain_ambiguous_and_all_original_coverage(self):
        document = self.document('2026-10-26')
        original = deepcopy(document)
        slim = sparse_document(document)
        self.assertEqual(document, original)
        self.assertEqual([c['mdtLinkStatus'] for c in slim['calls']], ['unique', 'ambiguous'])
        self.assertEqual(len(slim['decisions']), 2)
        self.assertEqual(slim['coverage']['N'], 3)

    def test_incomplete_census_is_rejected_before_sparse_export(self):
        document = self.document('2026-10-26')
        document['decisions'].pop()
        with self.assertRaises(ValueError):
            sparse_document(document)

    def test_cache_after_publication_rebuilds_missing_stage_report(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            public, work = root/'public', root/'work'
            public.mkdir()
            work.mkdir()
            date = '2026-10-26'
            (public/'voice-1030.json').write_text(json.dumps({'meta': {'revision': 'rev', 'dates': [date]}}))
            doc = {**self.document(date), 'sourceRevision': 'rev', 'scopeKey': 'scope'}
            (work/('rev-'+date+'.json')).write_text(json.dumps(doc))
            def regenerate(*args, **kwargs):
                (work/'input.json').write_text(json.dumps(doc))
            with patch.object(pipeline.subprocess, 'run', side_effect=regenerate) as command, \
                    patch.object(pipeline, 'publish_reports'), \
                    patch.object(pipeline, 'sparse_document', side_effect=lambda d: d):
                pipeline.build(public, work)
            self.assertEqual(command.call_count, 1)


if __name__ == '__main__':
    unittest.main()
