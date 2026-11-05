import math
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from qoe_spatiotemporal_core import (
    RtcpInterval,GnssFix,estimate_clock_offset,detect_impairment_intervals,
    infer_position,expected_uncertainty_scenarios,compare_radio_evidence,
    haversine_m
)

def r(s,e,mos=None,loss=None,jitter=None,source="rtcp_interval",verified=True):
    return RtcpInterval(s,e,mos,loss,jitter,source,verified)

class TimeEventTests(unittest.TestCase):
    def test_no_rtcp_has_no_onset(self):
        self.assertEqual(detect_impairment_intervals([])["status"],"NO_INTERVAL_RTCP")
    def test_call_aggregate_repeated_not_onset(self):
        vals=[r(i,i+1,2.4,source="mdt_repeated_call_aggregate") for i in range(6)]
        self.assertEqual(detect_impairment_intervals(vals)["status"],"AGGREGATED_OR_INVALID_TIME")
    def test_normal_then_two_bad_detects_bounded_onset(self):
        vals=[r(i,i+1,mos=4.1 if i<4 else 2.7) for i in range(10)]
        x=detect_impairment_intervals(vals)
        self.assertEqual(x["status"],"DETECTED_INTERVAL")
        self.assertEqual(x["onset_interval_s"],(4,5))
        self.assertFalse(x["episodes"][0]["onset_is_exact_second"])
    def test_single_spike_not_called_onset(self):
        vals=[r(i,i+1,mos=2.2 if i==4 else 4.0) for i in range(10)]
        self.assertEqual(detect_impairment_intervals(vals)["episodes"],[])
    def test_no_baseline_is_not_detectable(self):
        vals=[r(i,i+1,mos=2.4) for i in range(10)]
        self.assertEqual(detect_impairment_intervals(vals)["status"],"NO_PRECEDING_HEALTHY_ANCHOR")
    def test_mos_loss_jitter_independent_indicators(self):
        vals=[r(0,1,4),r(1,2,4),r(2,3,4,loss=.08),r(3,4,4,loss=.12)]
        self.assertEqual(detect_impairment_intervals(vals)["onset_interval_s"],(2,3))
    def test_bad_rtcp_clock_overlaps_are_rejected(self):
        self.assertEqual(detect_impairment_intervals([r(1,3,4),r(2,4,2),r(4,5,2)])["status"],"OVERLAPPING_REPORTS")
    def test_fraction_0_255_not_wrongly_used_as_ratio(self):
        vals=[r(0,1,4),r(1,2,4),r(2,3,4,loss=25),r(3,4,4,loss=25)]
        self.assertEqual(detect_impairment_intervals(vals)["episodes"],[])
    def test_detect_multiple_episodes_with_recovery(self):
        vals=[r(i,i+1,2 if i in (3,4,8,9) else 4) for i in range(12)]
        self.assertEqual(len(detect_impairment_intervals(vals)["episodes"]),2)
    def test_synthetic_detection_metrics(self):
        # Explicitly synthetic interval truth only. NOT real-world Precision/Recall.
        truth=[0,0,0,0,1,1,0,0,0,1,1,0,0,0]
        obs=[r(i,i+1,2.5 if v else 4.2) for i,v in enumerate(truth)]
        out=detect_impairment_intervals(obs)
        predicted=[int(e["first_bad_report_s"][0]) for e in out["episodes"]]
        self.assertEqual(predicted,[4,9])
        self.assertEqual(len(set(predicted)&{4,9})/len(predicted),1)
    def test_unanchored_time_does_not_claim_offset(self):
        x=estimate_clock_offset([(0,3600),(1,3601),(2,3602),(3,3603)])
        self.assertEqual(x.status,"UNVERIFIED")
        self.assertIsNone(x.offset_s)
    def test_matched_clock_robust_outlier(self):
        a=[(i*10,i*10+2.0) for i in range(7)]+[(80,10000)]
        c=estimate_clock_offset(a,independent_clock_anchors=True)
        self.assertEqual(c.status,"ESTIMATED_NOT_CERTIFIED")
        self.assertAlmostEqual(c.offset_s,2.0,places=4)
    def test_clock_requires_four_anchors(self):
        self.assertEqual(estimate_clock_offset([(0,1),(1,2),(2,3)],independent_clock_anchors=True).status,"INSUFFICIENT")
    def test_unsynchronized_cause_rejected(self):
        self.assertEqual(compare_radio_evidence([{"t":4,"rsrp":-115}],(3,5))["status"],"UNSYNCHRONIZED_RADIO")

class PositionTests(unittest.TestCase):
    def setUp(self):
        self.fixes=[GnssFix(0,37.4,127.1,crs_verified=True),
                    GnssFix(10,37.4001,127.1001,crs_verified=True),
                    GnssFix(20,37.4002,127.1002,crs_verified=True)]
    def test_last_fix_causal(self):
        x=infer_position(self.fixes,15,"last_gnss")
        self.assertEqual(x.basis_times_s,(10,))
        self.assertIsNone(x.confidence_radius_90_m)
        self.assertFalse(x.confidence_calibrated)
        self.assertGreater(x.assumed_motion_bound_m,0)
    def test_interpolation_retrospective(self):
        x=infer_position(self.fixes,15,"time_interpolation")
        self.assertEqual(x.basis_times_s,(10,20))
        self.assertAlmostEqual(x.lat,37.40015,places=7)
        self.assertIn("RETROSPECTIVE",x.status)
    def test_velocity_extrapolation(self):
        x=infer_position(self.fixes,15,"constant_velocity")
        self.assertEqual(x.basis_times_s,(0,10))
        self.assertAlmostEqual(x.lon,127.10015,places=7)
    def test_invalid_gnss_crs_is_not_used(self):
        x=infer_position([GnssFix(10,37.4,127.1,crs_verified=False)],15,"last_gnss")
        self.assertEqual(x.status,"NO_VERIFIABLE_POSITION")
    def test_future_fix_only_not_usable_for_causal(self):
        x=infer_position([self.fixes[-1]],15,"last_gnss")
        self.assertIsNone(x.lat)
    def test_impossible_speed_rejected(self):
        x=infer_position([GnssFix(0,37,127,crs_verified=True),
                          GnssFix(5,37.8,127,crs_verified=True),
                          GnssFix(15,37.8,127.1,crs_verified=True)],10,"time_interpolation")
        self.assertEqual(x.status,"NO_VERIFIABLE_POSITION")
    def test_assumed_uncertainty_is_never_90pct_confidence(self):
        x=expected_uncertainty_scenarios(2,15,3)
        self.assertFalse(x["is_calibrated_confidence"])
        self.assertIsNotNone(x["scenario_bound_m"])
        self.assertEqual(expected_uncertainty_scenarios(None,15,3)["status"],"UNKNOWN")
    def test_no_time_alignment_no_radio_cause(self):
        x=compare_radio_evidence([{"t":4,"rsrp":-118,"rsrq":-19,"sinr":-2}],None,0.5)
        self.assertIsNone(x["causal_root_cause"])
    def test_radio_is_hypothesis_not_root_cause(self):
        x=compare_radio_evidence([{"t":4,"rsrp":-118,"rsrq":-19,"sinr":-2}],(3,5),.5)
        self.assertEqual(len(x["hypotheses"]),3)
        self.assertTrue(all(not h["causal"] for h in x["hypotheses"]))
    def test_geo_distance(self):
        self.assertAlmostEqual(haversine_m((37.5,127),(37.5,127)),0)
        self.assertTrue(100<haversine_m((37.5,127),(37.501,127))<120)

if __name__=="__main__":
    unittest.main(verbosity=2)

class ProbabilisticFusionTests(unittest.TestCase):
    def test_uncalibrated_sources_cannot_generate_fused_coordinates(self):
        from qoe_spatiotemporal_core import fuse_calibrated_position_observations as fuse
        x=fuse([],target_s=30)
        self.assertEqual(x["status"],"UNAVAILABLE_UNCALIBRATED_FUSION")
        self.assertIsNone(x["lat"])
    def test_two_sensors_without_independent_rf_calibration_refused(self):
        from qoe_spatiotemporal_core import fuse_calibrated_position_observations as fuse
        a=[{"family":"gnss","lat":37.4,"lon":127.1,"t_s":30,"sigma_position_m":10,
           "sigma_clock_s":1,"motion_process_sigma_mps":1,"evidence_id":"GNSS-A"},
          {"family":"radio","lat":37.4001,"lon":127.1001,"t_s":30,"sigma_position_m":100,
           "sigma_clock_s":1,"motion_process_sigma_mps":2,"evidence_id":"RADIO-B"}]
        self.assertIsNone(fuse(a,target_s=30,clocks_independently_anchored=True)["lat"])
        self.assertIsNone(fuse(a,target_s=30,radio_model_independently_validated=True)["lat"])
    def test_same_source_evidence_double_counting_refused(self):
        from qoe_spatiotemporal_core import fuse_calibrated_position_observations as fuse
        a=[{"family":"gnss","lat":37.4,"lon":127.1,"t_s":30,"sigma_position_m":10,
           "sigma_clock_s":1,"motion_process_sigma_mps":1,"evidence_id":"DUP"},
          {"family":"radio","lat":37.4001,"lon":127.1001,"t_s":30,"sigma_position_m":100,
           "sigma_clock_s":1,"motion_process_sigma_mps":2,"evidence_id":"DUP"}]
        self.assertEqual(fuse(a,target_s=30,clocks_independently_anchored=True,
            radio_model_independently_validated=True)["status"],"UNAVAILABLE_UNCALIBRATED_FUSION")
    def test_conditional_math_not_true_calibrated_coverage(self):
        from qoe_spatiotemporal_core import fuse_calibrated_position_observations as fuse
        a=[{"family":"gnss","lat":37.4,"lon":127.1,"t_s":30,"sigma_position_m":10,
           "sigma_clock_s":.1,"motion_process_sigma_mps":1,"evidence_id":"GNSS"},
          {"family":"radio","lat":37.4001,"lon":127.1001,"t_s":30,"sigma_position_m":100,
           "sigma_clock_s":.1,"motion_process_sigma_mps":1,"evidence_id":"RADIO"}]
        x=fuse(a,target_s=30,clocks_independently_anchored=True,
            radio_model_independently_validated=True)
        self.assertEqual(x["status"],"MODEL_CONDITIONAL_ONLY")
        self.assertTrue(37.4<x["lat"]<37.4001)
        self.assertFalse(x["field_certified_90pct_coverage"])
        self.assertGreater(x["model_conditional_radius90_m"],0)

