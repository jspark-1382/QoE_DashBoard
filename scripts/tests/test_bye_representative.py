"""Regression tests for CDR-end (BYE proxy) position selection.

These synthetic tests contain no customer data. The original per-sample
MDT track is not touched by the selector.
"""
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from administrative_dong import select_bye_points

END = 1793404800000


def observation(call, lat, source, lag_seconds, idx=0, valid_radio=False):
    return {
        'callId': call,
        'lat': lat,
        'lon': 127.05,
        'source': source,
        'observedMs': END - lag_seconds * 1000,
        'cdrEndMs': END,
        'sampleIndex': idx,
        **({
            'estimationMethod':'MULTILATERATION','siteCount':3,
            'geometry':0.1,'estimatedAccuracyM':1200,
            'confidenceScore':75,'residualErrorM':300,
        } if valid_radio else {}),
    }


class ByeRepresentativeTest(unittest.TestCase):
    def test_latest_fresh_gnss_selected_over_older_gnss(self):
        original = [
            observation('call1', 37.48, 'gnss', 20, 1),
            observation('call1', 37.49, 'gnss', 3, 2),
            observation('call1', 37.47, 'gnss', 45, 0),
        ]
        selected, stats = select_bye_points(original)
        self.assertEqual(len(selected), 1)
        self.assertEqual(selected[0][4], 37.49)
        self.assertEqual(selected[0][8], 3)
        self.assertEqual(len(original), 3, 'original trajectory must remain intact')
        self.assertEqual(stats['chosenGnssCalls'], 1)

    def test_fresh_gnss_prioritized_over_newer_estimate(self):
        rows = [
            observation('mixed', 37.48, 'gnss', 10, 0),
            observation('mixed', 37.49, 'radio', 1, 1),
            observation('radio_only', 37.47, 'radio', 2, 0, valid_radio=True),
        ]
        selected, stats = select_bye_points(rows)
        by_call = {row[0]: row for row in selected}
        self.assertEqual(by_call['mixed'][3], 'gnss')
        self.assertEqual(by_call['mixed'][4], 37.48)
        self.assertEqual(by_call['radio_only'][3], 'radio')
        self.assertEqual(stats['chosenGnssCalls'], 1)
        self.assertEqual(stats['chosenReviewableMultilaterationCalls'], 1)

    def test_recent_gnss_60_to_180_seconds_used_before_radio_or_bye_site(self):
        rows = [
            observation('gnss_priority',37.48,'gnss',65,0),
            observation('gnss_priority',37.49,'radio',4,1,valid_radio=True),
            observation('stale_only',37.51,'gnss',181,0),
            observation('max_allowed',37.52,'gnss',180,0),
        ]
        selected, stats=select_bye_points(rows)
        by_call={row[0]:row for row in selected}
        self.assertEqual(set(by_call),{'gnss_priority','max_allowed'})
        self.assertEqual(by_call['gnss_priority'][3],'gnss')
        self.assertEqual(by_call['gnss_priority'][4],37.48)
        self.assertEqual(by_call['max_allowed'][8],180)
        self.assertEqual(stats['staleAtEndSamples'],1)
        self.assertEqual(stats['callsWithStaleOrNoEndPosition'],1)

    def test_two_site_and_weak_three_site_are_rejected_for_bye_cell_fallback(self):
        rows=[
            observation('two_sites',37.48,'radio',1,0),
            {**observation('weak_trilat',37.49,'radio',2,0,valid_radio=True),
             'geometry':0.005},
            observation('good_trilat',37.50,'radio',9,0,valid_radio=True),
            observation('good_trilat',37.51,'radio',1,1),
        ]
        selected,audit=select_bye_points(rows)
        self.assertEqual([p[0] for p in selected],['good_trilat'])
        self.assertEqual(selected[0][4],37.50)
        self.assertEqual(audit['noReviewableMultilaterationCalls'],2)

    def test_small_after_end_rounding_allowed_beyond_one_second_rejected(self):
        rows = [
            observation('boundary', 37.48, 'gnss', -0.3),
            observation('beyond', 37.49, 'gnss', -1.1),
            observation('within', 37.50, 'gnss', -1.0),
        ]
        selected, stats = select_bye_points(rows)
        self.assertEqual({p[0] for p in selected}, {'boundary', 'within'})
        self.assertEqual(stats['observationsAfterEndExcluded'], 1)
        self.assertAlmostEqual(next(p[8] for p in selected if p[0]=='boundary'),-0.3)

    def test_invalid_end_and_coordinates_not_assigned(self):
        rows = [
            {**observation('no_end',37.48,'gnss',1), 'cdrEndMs':None},
            {**observation('bad_lat',32.01,'gnss',1)},
            observation('good',37.49,'gnss',1),
        ]
        selected, stats = select_bye_points(rows)
        self.assertEqual(len(selected),1)
        self.assertEqual(selected[0][0],'good')
        self.assertEqual(stats['missingEndOrSampleTime'],1)
        self.assertEqual(stats['invalidGeoSamples'],1)

if __name__ == '__main__':
    unittest.main()
