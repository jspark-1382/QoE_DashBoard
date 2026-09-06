from __future__ import annotations

import json
import math
import re
import statistics
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from xml.etree import ElementTree as ET

BOOK = next(Path("data").glob("*RTCP*.xlsx"))
OUTPUT = Path("public/indoor-data.json")
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def column_index(reference: str) -> int:
    value = 0
    for char in reference:
        if not char.isalpha():
            break
        value = value * 26 + ord(char.upper()) - 64
    return value - 1


def number(value: str | None) -> float | None:
    try:
        parsed = float(value or "")
        return parsed if math.isfinite(parsed) else None
    except ValueError:
        return None


def average(values: list[float]) -> float | None:
    return round(statistics.fmean(values), 2) if values else None


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def score_range(value: float | None, low: float, high: float) -> float | None:
    if value is None:
        return None
    return 1 + 4 * clamp((value - low) / (high - low), 0, 1)


def floor_order(code: str) -> int:
    match = re.search(r"(\d+)", code)
    level = int(match.group(1)) if match else 0
    return -level if code.upper().startswith("B") else level


def excel_hour(value: float | None) -> int | None:
    if value is None:
        return None
    return (datetime(1899, 12, 30) + timedelta(days=value)).hour


def bucket() -> dict:
    return {
        "samples": 0, "valid": 0, "names": Counter(), "categories": Counter(),
        "lat": [], "lon": [], "qoe": [], "rsrp": [], "rsrq": [], "sinr": [],
        "mos": [], "poor": 0, "rat": Counter(), "pcis": defaultdict(lambda: {
            "samples": 0, "qoe": [], "rsrp": [], "sinr": []
        })
    }


floors: dict[tuple[str, str], dict] = defaultdict(bucket)
total_rows = 0
observed_hours: Counter[int] = Counter()

with zipfile.ZipFile(BOOK) as book:
    shared_root = ET.parse(book.open("xl/sharedStrings.xml")).getroot()
    strings = ["".join(node.text or "" for node in item.iter(f"{NS}t")) for item in shared_root]

    def value(cell: ET.Element) -> str:
        node = cell.find(f"{NS}v")
        if node is None:
            return ""
        raw = node.text or ""
        return strings[int(raw)] if cell.attrib.get("t") == "s" else raw

    with book.open("xl/worksheets/sheet1.xml") as stream:
        for _, row in ET.iterparse(stream, events=("end",)):
            if row.tag != f"{NS}row" or row.attrib.get("r") == "1":
                continue
            values = {column_index(cell.attrib.get("r", "A1")): value(cell) for cell in row.findall(f"{NS}c")}
            building, code = values.get(5, "").strip(), values.get(6, "").strip()
            if not building or not code:
                row.clear()
                continue
            total_rows += 1
            hour = excel_hour(number(values.get(2)))
            if hour is not None:
                observed_hours[hour] += 1
            item = floors[(building, code)]
            item["samples"] += 1
            item["names"][values.get(7, "").strip()] += 1
            item["categories"][values.get(4, "").strip()] += 1
            for index, key in ((8, "lat"), (9, "lon")):
                parsed = number(values.get(index))
                if parsed is not None:
                    item[key].append(parsed)

            nr_pci, lte_pci = number(values.get(11)), number(values.get(15))
            rat = "NR5G" if nr_pci is not None else "LTE" if lte_pci is not None else None
            if rat is None:
                row.clear()
                continue
            pci = int(nr_pci if rat == "NR5G" else lte_pci or 0)
            rsrp = number(values.get(12 if rat == "NR5G" else 16))
            rsrq = number(values.get(13 if rat == "NR5G" else 17))
            sinr = number(values.get(14 if rat == "NR5G" else 18))
            candidates = [number(values.get(index)) for index in (27, 45, 55)]
            mos_values = [entry for entry in candidates if entry is not None and 0 < entry <= 5]
            mos = statistics.fmean(mos_values) if mos_values else None
            parts = [entry for entry in (score_range(rsrp, -120, -70), score_range(rsrq, -20, -5), score_range(sinr, -5, 25)) if entry is not None]
            radio = statistics.fmean(parts) if parts else 2.5
            qoe = round(clamp(radio * .78 + (mos if mos is not None else radio) * .22, 1, 5), 2)

            item["valid"] += 1
            item["rat"][rat] += 1
            item["qoe"].append(qoe)
            item["poor"] += qoe < 2.5
            for key, parsed in (("rsrp", rsrp), ("rsrq", rsrq), ("sinr", sinr), ("mos", mos)):
                if parsed is not None:
                    item[key].append(parsed)
            cell = item["pcis"][(rat, pci)]
            cell["samples"] += 1
            cell["qoe"].append(qoe)
            if rsrp is not None:
                cell["rsrp"].append(rsrp)
            if sinr is not None:
                cell["sinr"].append(sinr)
            row.clear()

buildings: dict[str, list[tuple[str, dict]]] = defaultdict(list)
for (building, code), item in floors.items():
    buildings[building].append((code, item))

building_output = []
valid_total = 0
for building, entries in buildings.items():
    floor_output = []
    for code, item in entries:
        valid_total += item["valid"]
        top_pcis = []
        ordered_cells = sorted(item["pcis"].items(), key=lambda entry: -entry[1]["samples"])
        for (rat, pci), cell in ordered_cells[:4]:
            top_pcis.append({
                "rat": rat, "pci": pci, "samples": cell["samples"],
                "qoe": average(cell["qoe"]), "rsrp": average(cell["rsrp"]),
                "sinr": average(cell["sinr"]),
            })
        floor_output.append({
            "code": code, "name": item["names"].most_common(1)[0][0],
            "order": floor_order(code), "samples": item["samples"], "validSamples": item["valid"],
            "mosSamples": len(item["mos"]),
            "qoe": average(item["qoe"]), "rsrp": average(item["rsrp"]),
            "rsrq": average(item["rsrq"]), "sinr": average(item["sinr"]),
            "mos": average(item["mos"]),
            "poorRate": round(100 * item["poor"] / max(1, item["valid"]), 1),
            "ratCounts": dict(item["rat"]), "topPcis": top_pcis,
        })
    floor_output.sort(key=lambda entry: -entry["order"])
    merged = [item for _, item in entries]
    building_output.append({
        "name": building,
        "category": Counter(value for item in merged for value, count in item["categories"].items() for _ in range(count)).most_common(1)[0][0],
        "samples": sum(item["samples"] for item in merged),
        "center": {"lat": average([value for item in merged for value in item["lat"]]), "lon": average([value for item in merged for value in item["lon"]])},
        "floors": floor_output,
    })

building_output.sort(key=lambda entry: (-len(entry["floors"]), entry["name"]))
output = {
    "meta": {
        "source": BOOK.name, "measurementDate": "2026-07-14", "totalRows": total_rows,
        "validSamples": valid_total, "buildingCount": len(building_output),
        "floorCount": sum(len(item["floors"]) for item in building_output),
        "hours": sorted(observed_hours),
    },
    "buildings": building_output,
}
OUTPUT.parent.mkdir(exist_ok=True)
OUTPUT.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(json.dumps(output["meta"], ensure_ascii=False, indent=2))
