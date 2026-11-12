"""Additional cohorts may contain accepted strict radio positions as well as GPS."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).parent/filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ReviewedRadioTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mixed = load('mixed_radio_fixture', 'build-quality-mixed-candidates.py')
        cls.models = load('mixed_models_radio_fixture', 'build-quality-models-mixed.py')

    def sources(self, path):
        if path.parent.name == 'three-site-rough':
            return {'sourceRevision': 'fixture', 'date': '2026-10-26', 'schemaVersion': 'coarse-three-site-v1',
                    'method': 'THREE_SITE_RSRP_CENTROID', 'notA90PercentAccuracyRegion': True, 'points': []}
        return {'sourceRevision': 'fixture', 'calls': [], 'administrativeDongs': [], 'callLocations': []}

    def test_mixed_candidates_retain_valid_reviewed_radio_and_conserve_inputs(self):
        module = self.mixed
        date, identity = '2026-10-26', '2026-10-26:customer:call'
        strict = {date: ({identity: {'callId': identity, 'kind': 'reviewed-radio'}}, {}, {})}
        with patch.object(module, 'REVISION', 'fixture'), \
                patch.object(module, 'REVISION_INDEX', {'availableDates': [date]}), \
                patch.object(module, 'read', side_effect=self.sources):
            result, counts = module.source_by_date(strict)
        self.assertIn(identity, result[date][0])
        self.assertEqual(counts['reviewedRadio'], 1)

    def test_mixed_models_retain_valid_reviewed_radio_without_mislabeling_gps(self):
        module = self.models
        date = '2026-10-26'
        original = {date: {'points': [{'callId': date+':customer:call', 'kind': 'reviewed-radio', 'mos': 2}],
                           'located': {'poor': 1, 'normal': 0}}}
        with patch.object(module, 'REVISION', 'fixture'), \
                patch.object(module.mixed, 'REVISION_INDEX', {'availableDates': [date]}), \
                patch.object(module, 'read', side_effect=self.sources), \
                patch.object(module.models, 'accepted_call_positions', return_value=original):
            result, counts = module.by_date()
        self.assertEqual(result[date]['points'][0]['kind'], 'reviewed-radio')
        self.assertEqual(counts['reviewedRadioPoor'], 1)
        self.assertEqual(counts['gnssPoor'], 0)


if __name__ == '__main__':
    unittest.main()
