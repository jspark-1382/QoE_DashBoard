# -*- coding: utf-8 -*-
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
from extract_mdt_merged import (  # noqa: E402
    build_dataset,
    cell_centroids,
    main,
    write_master_csv,
)


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
        # a 24h-style stamp stays inside the day via %86400, never rolling into tomorrow
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


class TestBootstrap(unittest.TestCase):
    def test_median_and_min_count(self):
        rows = [("C1", 37.50, 127.05), ("C1", 37.51, 127.05), ("C1", 37.52, 127.06),
                ("C2", 37.40, 127.10), ("C2", 37.41, 127.10)]   # C2 has only 2 rows -> excluded
        centroids = cell_centroids(rows)
        self.assertEqual(set(centroids), {"C1"})
        lat, lon = centroids["C1"]
        self.assertAlmostEqual(lat, 37.51, delta=1e-9)
        self.assertAlmostEqual(lon, 127.05, delta=1e-9)

    def test_generated_csv_loads_with_legacy_loader(self):
        import tempfile
        from pathlib import Path

        from base_station_master import load_master
        centroids = {"C1": (37.51, 127.05)}
        meta = {"C1": {"baseStationId": "E1", "frequency": 1550, "pci": 447}}
        out = Path(tempfile.mkdtemp()) / "m.csv"
        write_master_csv(centroids, meta, out)
        stations, errors = load_master(out)
        self.assertEqual(errors, [])
        self.assertEqual(stations[0]["cellId"], "C1")
        self.assertTrue(stations[0]["isVirtual"])


class TestMainDegraded(unittest.TestCase):
    def test_main_writes_dataset_without_master(self):
        import json
        import tempfile
        from pathlib import Path

        tmp = Path(tempfile.mkdtemp())
        headers = list(sample_row().keys())
        src = tmp / "src.xlsx"
        src.write_bytes(make_xlsx([headers, [sample_row()[h] for h in headers]] * 1 +
                                  [[sample_row()[h] for h in headers]] * 2))
        out = tmp / "out.json"
        master = tmp / "base.csv"
        main(["--src", str(src), "--out", str(out), "--master", str(master)])
        ds = json.loads(out.read_text(encoding="utf-8"))
        self.assertEqual(len(ds["days"]), 1)
        self.assertEqual(len(ds["days"][0]["samples"]), 3)
        self.assertTrue(ds["meta"]["masterErrors"])   # degraded: coordinate system unresolved
        self.assertFalse(master.exists())             # no bootstrap without coordinates


if __name__ == "__main__":
    unittest.main()
