"""Stream the merged LTE+MDT workbook (English schema) as normalized row dicts.

One row dict per data row, keyed by header name, with '' and 'NULL'
normalized to None. Streaming iterparse keeps the ~100 MB source out of
memory, matching the pattern of the other extract_*.py scripts.
"""
import zipfile
from datetime import datetime
from xml.etree import ElementTree as ET

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def _shared_strings(zf):
    if "xl/sharedStrings.xml" not in zf.namelist():
        return []
    root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    return ["".join(t.text or "" for t in si.iter(NS + "t")) for si in root]


def read_merged_rows(path):
    """Yield {header: value} dicts; ''/NULL become None. path may be a Path or file-like."""
    with zipfile.ZipFile(path) as zf:
        shared = _shared_strings(zf)
        headers = {}
        for _, row in ET.iterparse(zf.open("xl/worksheets/sheet1.xml"), events=("end",)):
            if row.tag != NS + "row":
                continue
            values = {}
            for cell in row:
                col = "".join(c for c in cell.attrib.get("r", "") if c.isalpha())
                node = cell.find(NS + "v")
                raw = node.text if node is not None else ""
                if cell.get("t") == "s" and raw:
                    raw = shared[int(raw)]
                elif cell.get("t") == "inlineStr":
                    raw = "".join(t.text or "" for t in cell.iter(NS + "t"))
                values[col] = raw
            row.clear()
            if not headers:
                headers = values
                continue
            record = {headers.get(col, col): value for col, value in values.items()}
            yield {key: (None if value in (None, "", "NULL") else value) for key, value in record.items()}


def parse_timestamp(stamp):
    """Parse a 14-digit YYYYMMDDHHMMSS stamp; anything shorter/longer/broken is None."""
    if stamp is None or len(str(stamp)) != 14:
        return None
    try:
        return datetime.strptime(str(stamp), "%Y%m%d%H%M%S")
    except ValueError:
        return None


def second_of_day(at):
    """Seconds since local midnight; 24h-style stamps clamp inside the day."""
    return (at.hour * 3600 + at.minute * 60 + at.second) % 86400
