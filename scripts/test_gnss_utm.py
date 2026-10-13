# -*- coding: utf-8 -*-
"""Tests for the UTM inverse projection and the projection decision gate.

Run from the repo root:
    py -3 scripts/test_gnss_utm.py -v
"""
import unittest

from gnss_utm import CANDIDATES, CHOSEN, forward, korea_bbox, to_latlon

# First 12 valid (x, y) pairs from the raw Gaepo workbook (see probe ledger).
REAL_SAMPLE_PAIRS = [
    [960230.0278558573, 1941498.7794222839], [960230.0278558573, 1941498.7794222839],
    [960181.9449059871, 1941363.3128181316], [960155.2728271428, 1941340.824143107],
    [960155.2728271428, 1941340.824143107], [960317.1989485647, 1941475.747324952],
    [960197.9858560886, 1941940.5391969532], [959669.7829210183, 1942177.574710807],
    [959690.5535767284, 1942548.8529161487], [959690.5535767284, 1942548.8529161487],
    [959690.5535767284, 1942548.8529161487], [959585.2676911826, 1941573.3026562291],
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


if __name__ == "__main__":
    unittest.main()
