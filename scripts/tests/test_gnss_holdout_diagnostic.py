"""Safety and arithmetic tests for the GNSS holdout evaluator."""
import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parent.parent))
from gnss_holdout_diagnostic import (
    great_circle_m, collapse_duplicates, velocity_prediction, metrics,
    point_from_row,
)

class GnssHoldoutSafetyTests(unittest.TestCase):
    def test_constant_position_is_not_movement(self):
        a={"t":100,"pos":(37.5,127.0)}
        b={"t":110,"pos":(37.5,127.0)}
        c={"t":120,"pos":(37.5,127.0)}
        self.assertEqual(velocity_prediction(a,b,c),(37.5,127.0))
        self.assertAlmostEqual(great_circle_m(a["pos"],b["pos"]),0)

    def test_future_gnss_cannot_predict_past(self):
        a={"t":110,"pos":(37.5,127.0)}
        b={"t":120,"pos":(37.5001,127.0)}
        self.assertIsNone(velocity_prediction(a,b,{"t":115}))

    def test_implausible_speed_rejected(self):
        a={"t":100,"pos":(37.5,127.0)}
        b={"t":103,"pos":(37.6,127.0)}
        self.assertIsNone(velocity_prediction(a,b,{"t":110}))

    def test_duplicate_fix_collapsed(self):
        x={"t":100,"pos":(37.5,127.0)}
        y={"t":100.2,"pos":(37.5,127.0)}
        z={"t":110,"pos":(37.5001,127.0)}
        self.assertEqual(len(collapse_duplicates([z,x,y])),2)

    def test_missing_crs_or_source_never_counts_as_truth(self):
        row=[None]*22
        row[2],row[3]=37.5,127.0
        row[21]={"timestamp":"2026-10-29T10:00:00+09:00","gnssCrs":"unknown","locationSource":"gnss"}
        self.assertIsNone(point_from_row(row))
        row[21]["gnssCrs"]="EPSG:5179"
        row[21]["locationSource"]="estimated"
        self.assertIsNone(point_from_row(row))

    def test_percentiles_do_not_impute_missing(self):
        stats=metrics([{"e":10},{"e":20},{"e":None}],"e")
        self.assertEqual(stats["count"],2)
        self.assertEqual(stats["p50_m"],15)
        self.assertEqual(stats["p90_m"],19)

if __name__=="__main__":
    unittest.main()
