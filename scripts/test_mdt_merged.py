# -*- coding: utf-8 -*-
"""Tests for the merged lte+mdt ingestion pipeline.

Run from the repo root:
    py -3 scripts/test_mdt_merged.py -v
"""
import unittest
import zipfile
from io import BytesIO


def make_xlsx(rows):
    """Build a minimal xlsx (inline strings, single sheet1) from a list of row lists."""

    def esc(text):
        return str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    xml = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
           '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
           '<sheetData>']
    for r, row in enumerate(rows, 1):
        xml.append(f'<row r="{r}">')
        for c, value in enumerate(row):
            col = ""
            n = c + 1
            while n:
                n, rem = divmod(n - 1, 26)
                col = chr(65 + rem) + col
            xml.append(f'<c r="{col}{r}" t="inlineStr"><is><t>{esc(value)}</t></is></c>')
        xml.append('</row>')
    xml.append('</sheetData></worksheet>')

    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w") as book:
        book.writestr("xl/worksheets/sheet1.xml", "".join(xml))
    return buffer.getvalue()


from mdt_merged_source import parse_timestamp, read_merged_rows, second_of_day  # noqa: E402
from extract_mdt_merged import build_dataset, cell_centroids, main  # noqa: E402


class TestReader(unittest.TestCase):
    def test_headers_and_null_normalization(self):
        data = make_xlsx([["base_date", "rsrp", "pci"], ["20260915", "NULL", "447"]])
        (row,) = list(read_merged_rows(BytesIO(data)))
        self.assertEqual(row["base_date"], "20260915")
        self.assertIsNone(row["rsrp"])   # the literal string 'NULL' normalizes to None
        self.assertEqual(row["pci"], "447")
        self.assertNotIn("ghost_col", row)

    def test_empty_cells_become_none(self):
        data = make_xlsx([["a", "b"], ["", "x"]])
        (row,) = list(read_merged_rows(BytesIO(data)))
        self.assertIsNone(row["a"])
        self.assertEqual(row["b"], "x")

    def test_midnight_and_bad_stamp(self):
        self.assertEqual(second_of_day(parse_timestamp("20260915235959")), 23 * 3600 + 59 * 60 + 59)
        self.assertIsNone(parse_timestamp("202609151630"))   # incomplete stamp -> None
        self.assertIsNone(parse_timestamp(None))
        # a midnight stamp stays inside its own day via %86400, never rolling over
        self.assertEqual(second_of_day(parse_timestamp("20260916000000")), 0.0)


def sample_row(**over):
    base = {"base_date": "20260915", "svc_cont_id": "111", "rqt_timestamp": "20260915100000",
            "mdt_cell_id": "C1", "mdt_equip_cd": "E1", "dlearfcn": "1550", "pci": "447",
            "rsrp": "-80.0", "rsrq": "-10.0", "nsinr": "7.0", "out_in_div_cd": "0",
            "svc_ctgry_st_hhmiss": "163051", "svc_ctgry_fns_hhmiss": "163353"}
    return {**base, **over}


class TestBuildDataset(unittest.TestCase):
    coords = staticmethod(lambda row: (37.5, 127.05))

    def test_good_and_bad_contract(self):
        rows = ([sample_row()] * 5 +
                [sample_row(svc_cont_id="222", rsrp="-118.0", rsrq="-19.0", nsinr="-4.0")] * 5)
        ds = build_dataset(rows, self.coords)
        call_qoe = {s[19]: s[16] for d in ds["days"] for s in d["samples"]}
        self.assertTrue(any(v >= 3.0 for v in call_qoe.values()))
        self.assertTrue(any(v < 2.5 for v in call_qoe.values()))

    def test_same_second_rows_stable_order(self):
        rows = [sample_row() for _ in range(50)]
        ds = build_dataset(rows, self.coords)
        secs = [s[0] for d in ds["days"] for s in d["samples"]]
        self.assertEqual(secs, sorted(secs))
        self.assertEqual(len(secs), 50)

    def test_frequency_passthrough(self):
        rows = [sample_row(dlearfcn="475")]
        ds = build_dataset(rows, self.coords)
        self.assertEqual(ds["days"][0]["samples"][0][21]["frequency"], 475.0)
        self.assertEqual(ds["meta"]["frequencyEncoding"], "lte-earfcn")

    def test_mdt_gnss_flag(self):
        row_g = sample_row(gnss_utmkx="960230.0", gnss_utmky="1941498.0")
        row_n = sample_row(rqt_timestamp="20260915100001", svc_ctgry_st_hhmiss="163052")
        ds = build_dataset([row_g, row_n], self.coords)
        flags = sorted(s[21]["gnss"] for d in ds["days"] for s in d["samples"])
        self.assertEqual(flags, [False, True])
        self.assertEqual(ds["customers"][0]["gnssSampleCount"], 1)
        self.assertEqual(ds["customers"][0]["sampleCount"], 2)

    def test_tuple_shape_and_masks(self):
        rows = [sample_row(), sample_row(svc_ctgry_st_hhmiss="170000")]
        ds = build_dataset(rows, self.coords)
        for day in ds["days"]:
            for sample in day["samples"]:
                self.assertEqual(len(sample), 22)
                self.assertEqual(sample[4], "개포4동")
                self.assertEqual(sample[8], "LTE")
                self.assertIn(sample[5], ("indoor", "outdoor"))
                self.assertTrue(sample[19] and sample[20])
        self.assertTrue(all(c["maskedPhone"].startswith("계약 ") for c in ds["customers"]))

    def test_day_samples_sorted_across_calls(self):
        rows = ([sample_row(svc_ctgry_st_hhmiss="163051", rqt_timestamp="20260915110000")] * 3 +
                [sample_row(svc_ctgry_st_hhmiss="164051", rqt_timestamp="20260915100000")] * 3)
        ds = build_dataset(rows, self.coords)
        secs = [s[0] for d in ds["days"] for s in d["samples"]]
        self.assertEqual(secs, sorted(secs))


class TestBootstrap(unittest.TestCase):
    def test_median_and_min_count(self):
        rows = [("C1", 37.50, 127.05), ("C1", 37.51, 127.05), ("C1", 37.52, 127.06),
                ("C2", 37.40, 127.10), ("C2", 37.41, 127.10)]   # C2 has only 2 rows -> excluded
        centroids = cell_centroids(rows)
        self.assertEqual(set(centroids), {"C1"})
        lat, lon = centroids["C1"]
        self.assertAlmostEqual(lat, 37.51, delta=1e-9)
        self.assertAlmostEqual(lon, 127.05, delta=1e-9)


class TestChosenCoords(unittest.TestCase):
    def test_row_gnss_used_when_projection_chosen(self):
        import extract_mdt_merged
        from gnss_utm import to_latlon
        row = sample_row(gnss_utmkx="960230.0278558573", gnss_utmky="1941498.7794222839")
        expected = to_latlon(960230.0278558573, 1941498.7794222839, "utm52-fe1e6-fn0")
        saved = extract_mdt_merged.CHOSEN
        extract_mdt_merged.CHOSEN = "utm52-fe1e6-fn0"
        try:
            self.assertEqual(extract_mdt_merged.resolve_coords(row, {"C1": (37.5, 127.05)}), expected)
        finally:
            extract_mdt_merged.CHOSEN = saved


    def test_calibration_used_before_centroid(self):
        import extract_mdt_merged
        from gnss_utm import calib_latlon
        row = sample_row(gnss_utmkx="960230.0278558573", gnss_utmky="1941498.7794222839")
        expected = calib_latlon(960230.0278558573, 1941498.7794222839)
        self.assertIsNotNone(expected)
        self.assertEqual(extract_mdt_merged.resolve_coords(row, {"C1": (37.5, 127.05)}), expected)

    def test_station_fallback_for_rows_without_gnss(self):
        import extract_mdt_merged
        stations = {"E1": (37.477, 127.044)}
        self.assertEqual(extract_mdt_merged.resolve_coords(sample_row(), {}, stations), (37.477, 127.044))

    def test_cell_centroid_when_no_station_match(self):
        import extract_mdt_merged
        self.assertEqual(extract_mdt_merged.resolve_coords(sample_row(), {"C1": (37.5, 127.05)}, {}),
                         (37.5, 127.05))
        self.assertIsNone(extract_mdt_merged.resolve_coords(sample_row(), {}, {}))


class TestMainRealMaster(unittest.TestCase):
    def test_main_uses_real_stations_and_station_fallback(self):
        import json
        import tempfile
        from pathlib import Path

        tmp = Path(tempfile.mkdtemp())
        headers = list(sample_row().keys())
        one_row = [sample_row()[h] for h in headers]
        src = tmp / "src.xlsx"
        src.write_bytes(make_xlsx([headers] + [one_row] * 3))
        stations_file = tmp / "BaseStation_new.txt"
        stations_file.write_text("E1,37.4770,127.0440\n", encoding="utf-8")
        out = tmp / "out.json"
        main(["--src", str(src), "--out", str(out), "--stations", str(stations_file)])
        ds = json.loads(out.read_text(encoding="utf-8"))
        self.assertEqual(len(ds["days"]), 1)
        self.assertEqual(len(ds["days"][0]["samples"]), 3)
        stations = ds["meta"]["baseStations"]
        self.assertEqual([s["baseStationId"] for s in stations], ["E1"])
        self.assertFalse(stations[0]["isVirtual"])
        sample = ds["days"][0]["samples"][0]
        self.assertAlmostEqual(sample[2], 37.477, places=3)
        self.assertAlmostEqual(sample[3], 127.044, places=3)
        self.assertTrue(ds["meta"]["masterErrors"])   # station-coordinate disclosure present


class TestSizeGuard(unittest.TestCase):
    def test_estimate_switch_and_min_samples_override(self):
        import json
        import tempfile
        from pathlib import Path

        import extract_mdt_merged

        tmp = Path(tempfile.mkdtemp())
        headers = list(sample_row().keys())
        one_row = [sample_row()[h] for h in headers]
        src = tmp / "src.xlsx"
        src.write_bytes(make_xlsx([headers] + [one_row] * 3))
        stations_file = tmp / "BaseStation_new.txt"
        stations_file.write_text("E1,37.5,127.05\n", encoding="utf-8")
        out = tmp / "out.json"
        base_args = ["--src", str(src), "--out", str(out), "--stations", str(stations_file)]

        saved_max, saved_min = extract_mdt_merged.MAX_JSON_BYTES, extract_mdt_merged.MIN_SAMPLES_PER_CONTRACT
        extract_mdt_merged.MAX_JSON_BYTES = 100
        extract_mdt_merged.MIN_SAMPLES_PER_CONTRACT = 4
        try:
            main(base_args)
            ds = json.loads(out.read_text(encoding="utf-8"))
            self.assertEqual(ds["days"], [])          # 3-row contract below threshold 4
            self.assertEqual(ds["meta"]["filteredContracts"], 1)
        finally:
            extract_mdt_merged.MAX_JSON_BYTES, extract_mdt_merged.MIN_SAMPLES_PER_CONTRACT = saved_max, saved_min

        main(base_args + ["--min-samples", "4"])
        ds = json.loads(out.read_text(encoding="utf-8"))
        self.assertEqual(ds["days"], [])

        main(base_args)
        ds = json.loads(out.read_text(encoding="utf-8"))
        self.assertEqual(len(ds["days"]), 1)


if __name__ == "__main__":
    unittest.main()
