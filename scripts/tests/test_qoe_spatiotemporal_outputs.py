"""Output-level evidence and anti-overclaim gates (real source-derived outputs)."""
import json
import sys
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/"outputs/spatiotemporal-research-v1"

class RealDataEvidenceContracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.study=json.loads((OUT/"report.json").read_text("utf8"))
        cls.cases=json.loads((OUT/"evaluation-cases.json").read_text("utf8"))
        cls.radio=json.loads((OUT/"candidate_radio_context.json").read_text("utf8"))
        cls.selection=json.loads((OUT/"model_selection_review.json").read_text("utf8"))
    def test_provenance_matches_version(self):
        self.assertEqual(self.study["sourceRevision"],"557c39d2c6a9a5b4c69b")
        self.assertEqual(self.radio["sourceRevision"],self.study["sourceRevision"])
        self.assertEqual(self.study["sourceAudit"]["mdtEventRows"],541811)
        self.assertEqual(self.study["sourceAudit"]["groupsWithVaryingRtcpMos"],0)
    def test_impairment_onset_is_unverifiable_not_fabricated(self):
        a=self.study["sourceAudit"]
        self.assertFalse(a["rtcpIntervalReportsAvailable"])
        self.assertIsNone(a["rtcpDegradationPrecisionRecall"])
        self.assertIsNone(a["clockAlignmentErrorP90Seconds"])
        self.assertIsNone(self.study["groundTruth"]["temporalDetectionPrecision"])
        self.assertIsNone(self.study["groundTruth"]["trueLocation90pctCoverage"])
        self.assertEqual(self.study["groundTruth"]["unverifiableImpairmentOnsetPct"],100)
    def test_split_excludes_customers_and_cells(self):
        dev=[x for x in self.cases if x["date"]<="2026-10-28"]
        late=[x for x in self.cases if x["date"]>="2026-10-29"]
        customers={x["opaqueCustomer"] for x in dev}
        cells={x["cell"] for x in dev}
        strict=[x for x in late if x["opaqueCustomer"] not in customers and
                x["cell"] not in cells and x["cell"]]
        self.assertEqual(len(strict),self.study["strictHeldOutCustomerAndCellCases"])
        self.assertGreater(len(strict),0)
        self.assertTrue(all(x["opaqueCustomer"] not in customers and x["cell"] not in cells for x in strict))
    def test_no_raw_identifiers_or_original_location_truth_exported(self):
        for entry in self.cases:
            self.assertNotIn("imsi",str(entry).lower())
            self.assertNotIn("msisdn",str(entry).lower())
            self.assertNotIn("lat",entry)
            self.assertNotIn("lon",entry)
            self.assertNotIn("phone",str(entry).lower())
            self.assertTrue(entry["opaqueCustomer"].startswith("mdt-"))
            self.assertTrue(entry["opaqueCall"].startswith("call-"))
    def test_original_21_representatives_have_single_source_matches_or_are_rejected(self):
        z=self.radio["summary"]
        self.assertEqual(z["representativeCDRCalls"],21)
        self.assertEqual(z["matchedCalls"],20)
        self.assertEqual(z["unmatchedCalls"],1)
        self.assertEqual(z["ambiguousCalls"],0)
        self.assertEqual(z["confirmedRootCauses"],0)
        for x in self.radio["calls"]:
            self.assertIn(x["sourceCallJoinStatus"],{"UNIQUE_END_AND_START_BRACKET",
                         "AMBIGUOUS_SOURCE_CALLS","NO_SOURCE_CALL_END_START_MATCH"})
            self.assertIsNone(x["rootCause"])
            self.assertIsNone(x["rtcpImpairmentOnset"])
            self.assertIsNone(x["clockOffset"])
            self.assertLessEqual(x["distinctRtcpMosInOriginal"],1)
    def test_complex_method_not_promoted_after_strict_test_worsened(self):
        x=self.selection
        self.assertTrue(x["noTargetOrTestLeakage"])
        self.assertEqual(x["strictTestPairedCount"],13)
        self.assertFalse(x["promoteToProduction"])
        self.assertFalse(x["empiricalBetterThanBaseline"])
        self.assertGreater(x["strictTestSelectedGate"]["meanM"],
                           x["strictTestLastGNSS"]["meanM"])
    def test_stationary_cases_cannot_certify_accuracy(self):
        strict=self.study["methods"]["strictTestDisjointCustomerAndCell"]
        self.assertGreater(strict["last"]["all"]["stationaryFractionPct"],80)
        self.assertFalse(self.study["groundTruth"]["surveyedLocationAvailable"])
        for x in self.study["empiricalHeldoutGnssQuantileStudy"].values():
            for method in x.values():
                self.assertFalse(method["certifiedHandsetAccuracy90Pct"])

if __name__=="__main__":
    unittest.main(verbosity=2)
