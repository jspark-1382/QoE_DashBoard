"""Tests for GNSS-missing data-only supplements (no synthetic handset position)."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parent.parent))
from enrich_missing_gnss_evidence import (
    aware_epoch, missing_reason, strict_stations, prior_gnss_observation,
    build_gnss_index, sample_evidence,
    INVENTORY_FILE
)

def sample(call="callA",timestamp="2026-10-30T12:00:10+09:00",xy=(0.0,0.0),pos=(None,None),source=None):
    r=[None]*22
    r[2],r[3]=pos
    r[10],r[11],r[12]=(-95,-10,12)
    r[19]=call
    r[21]={"timestamp":timestamp,"cellId":"1001","baseStationId":"RU1","gnssUtmkx":xy[0],"gnssUtmky":xy[1],
           "gnssCrs":"EPSG:5179"}
    if source:r[21]["locationSource"]=source
    return r

def station(lat=37.5,lon=127):
    return {"baseStationId":"RU1","cellId":"1001","latitude":lat,"longitude":lon,
            "inventorySource":INVENTORY_FILE}

class EnrichmentSafetyTest(unittest.TestCase):
    def test_zero_is_missing_not_gnss(self):
        self.assertEqual(missing_reason(sample()),"ZERO_ZERO_SENTINEL")
        self.assertEqual(missing_reason(sample(xy=(None,None))),"BOTH_GNSS_FIELDS_MISSING")

    def test_future_gnss_not_used(self):
        t=aware_epoch("2026-10-30T12:00:10+09:00")
        fixes=[{"epoch":t+1,"timestamp":"later","latitude":37.5,"longitude":127}]
        self.assertIsNone(prior_gnss_observation(fixes,t))

    def test_stale_gnss_not_used(self):
        t=aware_epoch("2026-10-30T12:00:10+09:00")
        fixes=[{"epoch":t-181,"timestamp":"old","latitude":37.5,"longitude":127}]
        self.assertIsNone(prior_gnss_observation(fixes,t))

    def test_exact_station_pair_only(self):
        idx=strict_stations([station(),station(37.6),{"baseStationId":"OTHER","cellId":"1001","latitude":37.5,"longitude":127,"inventorySource":INVENTORY_FILE}])
        self.assertNotIn(("RU1","1001"),idx)
        self.assertIn(("OTHER","1001"),idx)
        self.assertNotIn(("","1001"),idx)

    def test_enriched_row_is_reference_not_position(self):
        gnss=sample(timestamp="2026-10-30T12:00:00+09:00",xy=(953901,1952032),pos=(37.5,127),source="gnss")
        missing=sample()
        evidence=sample_evidence(
            missing,1,{"endCellId":"1001","endTimestamp":"2026-10-30T12:00:12+09:00"},
            strict_stations([station()]),build_gnss_index([gnss,missing]),
            {"1001":{"ruId":"RU1","lat":37.5,"lon":127}},
            "2026-10-30","data.json")
        self.assertIsNone(evidence["uePosition"])
        self.assertEqual(evidence["uePositionDetermination"],"NO_VALIDATED_UE_POSITION")
        self.assertEqual(evidence["priorGnssReference"]["ageSeconds"],10)
        self.assertFalse(evidence["priorGnssReference"]["scenarioIsCalibratedConfidenceRegion"])
        self.assertEqual(evidence["mdtCellSiteReference"]["referenceType"],"MDT_CELL_SITE_NOT_HANDSET")
        self.assertEqual(evidence["cdrEndCellSiteReference"]["referenceType"],"CDR_END_CELL_SITE_NOT_HANDSET")

    def test_non_gnss_row_never_becomes_past_fix(self):
        bad=sample(pos=(37.5,127),source="estimated")
        self.assertFalse(build_gnss_index([bad]))

    def test_invalid_naive_timestamp(self):
        self.assertIsNone(aware_epoch("2026-10-30T12:00:10"))

if __name__=="__main__":unittest.main()
