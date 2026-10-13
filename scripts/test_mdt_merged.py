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
        return (str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))

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


if __name__ == "__main__":
    unittest.main()
