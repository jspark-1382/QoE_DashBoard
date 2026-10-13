# -*- coding: utf-8 -*-
"""Tests for the UTM inverse projection and the projection decision gate.

Run from the repo root:
    py -3 scripts/test_gnss_utm.py -v
"""
import math
import unittest

from gnss_utm import CANDIDATES, CHOSEN, calib_latlon, forward, korea_bbox, to_latlon

# First 24 valid (x, y) pairs from the raw Gaepo workbook (see probe ledger).
REAL_SAMPLE_PAIRS = [
    [960230.0278558573, 1941498.7794222839], [960230.0278558573, 1941498.7794222839],
    [960181.9449059871, 1941363.3128181316], [960155.2728271428, 1941340.824143107],
    [960155.2728271428, 1941340.824143107], [960317.1989485647, 1941475.747324952],
    [960197.9858560886, 1941940.5391969532], [959669.7829210183, 1942177.574710807],
    [959690.5535767284, 1942548.8529161487], [959690.5535767284, 1942548.8529161487],
    [959690.5535767284, 1942548.8529161487], [959585.2676911826, 1941573.3026562291],
    [959585.2676911826, 1941573.3026562291], [959585.2676911826, 1941573.3026562291],
    [960108.0173633016, 1942170.701599955], [960119.4067323515, 1942171.837483052],
    [960121.2690666727, 1942164.6869895656], [960119.4067323515, 1942171.837483052],
    [960108.0173633016, 1942170.701599955], [960119.4067323515, 1942171.837483052],
    [960108.0173633016, 1942170.701599955], [960121.2690666727, 1942164.6869895656],
    [960111.8236202633, 1942173.0642574532], [960121.2690666727, 1942164.6869895656],
]


class TestGnssUtm(unittest.TestCase):
    def test_zero_placeholder_rejected(self):
        self.assertIsNone(to_latlon(0.0, 0.0, "utm52-fe1e6-fn0"))
        self.assertIsNone(to_latlon(-1.0, 1_941_498.0, "utm52-fe1e6-fn0"))
        self.assertIsNone(to_latlon(960_230.0, 0.0, "utm52-fe1e6-fn0"))

    def test_roundtrip(self):
        for name, cfg in CANDIDATES.items():
            east, north = forward(37.49, 127.06, cfg)
            back = to_latlon(east, north, name)
            self.assertIsNotNone(back)
            self.assertLessEqual(abs(back[0] - 37.49), 1e-7, name)
            self.assertLessEqual(abs(back[1] - 127.06), 1e-7, name)

    def test_unknown_candidate_rejected(self):
        self.assertIsNone(to_latlon(960_230.0, 1_941_498.0, "no-such-zone"))

    def test_projection_decision_gate(self):
        passing = set()
        for name in CANDIDATES:
            pts = [to_latlon(x, y, name) for x, y in REAL_SAMPLE_PAIRS]
            usable = [p for p in pts if p]
            if usable and sum(1 for p in usable if korea_bbox(*p)) / len(usable) >= 0.95:
                passing.add(name)
        # CHOSEN must equal the gate-computed passing set (empty set encoded as "").
        self.assertEqual(passing or {""}, {CHOSEN})
        self.assertIn(CHOSEN, set(CANDIDATES) | {""})


# GNSS cluster medians joined to BaseStation_new master coordinates
# (fitted by _analysis/calibrate_master.py over 364 equip clusters).
CALIB_MASTER_PAIRS = [
    [958988.6373, 1942557.0431, 37.47708889, 127.04385], [960032.5226, 1942069.3509, 37.47551944, 127.04890278],
    [959775.5154, 1942025.4353, 37.47512167, 127.04676944], [959663.2091, 1942383.2445, 37.4803075, 127.04329167],
    [959728.7754, 1942221.8446, 37.47846667, 127.04473056], [959482.5423, 1942885.5102, 37.48590833, 127.04025028],
    [960036.1695, 1941658.3876, 37.473125, 127.04717778], [959665.6017, 1943075.1642, 37.477, 127.043875],
    [960679.0664, 1942507.6127, 37.48116389, 127.05586722], [960108.8584, 1941390.8004, 37.47136111, 127.04839722],
    [959669.6445, 1942158.5751, 37.47758056, 127.044075], [960999.3148, 1942021.6438, 37.47701361, 127.0594125],
]


class TestCalibration(unittest.TestCase):
    def test_median_residual_under_400m(self):
        residuals = []
        for x, y, lat, lon in CALIB_MASTER_PAIRS:
            point = calib_latlon(x, y)
            self.assertIsNotNone(point)
            dlat = (point[0] - lat) * 111_320.0
            dlon = (point[1] - lon) * 111_320.0 * math.cos(math.radians(lat))
            residuals.append(math.hypot(dlat, dlon))
        residuals.sort()
        median = residuals[len(residuals) // 2]
        self.assertLess(median, 400.0)

    def test_all_predictions_in_korea_bbox(self):
        for x, y, _lat, _lon in CALIB_MASTER_PAIRS:
            self.assertTrue(korea_bbox(*calib_latlon(x, y)))

    def test_placeholder_rejected(self):
        self.assertIsNone(calib_latlon(0.0, 0.0))
        self.assertIsNone(calib_latlon(-1.0, 1_941_498.0))
        self.assertIsNone(calib_latlon(None, 1.0))


if __name__ == "__main__":
    unittest.main()
