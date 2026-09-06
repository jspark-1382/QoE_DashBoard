from __future__ import annotations

import json
import math
import statistics
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from xml.etree import ElementTree as ET

BOOK = next(Path("data").glob("*행정동*.xlsx"))
OUTPUT = Path("public/qoe-data.json")
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


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def score_range(value: float | None, low: float, high: float) -> float | None:
    if value is None:
        return None
    return 1 + 4 * clamp((value - low) / (high - low), 0, 1)


def excel_time(value: float | None) -> str:
    if value is None:
        return "--:--:--"
    return (datetime(1899, 12, 30) + timedelta(days=value)).strftime("%H:%M:%S")


with zipfile.ZipFile(BOOK) as book:
    shared_root = ET.parse(book.open("xl/sharedStrings.xml")).getroot()
    strings = ["".join(node.text or "" for node in item.iter(f"{NS}t")) for item in shared_root]

    def value(cell: ET.Element) -> str:
        node = cell.find(f"{NS}v")
        if node is None:
            return ""
        raw = node.text or ""
        return strings[int(raw)] if cell.attrib.get("t") == "s" else raw

    records: list[dict] = []
    headers: list[str] = []
    with book.open("xl/worksheets/sheet1.xml") as stream:
        for _, row in ET.iterparse(stream, events=("end",)):
            if row.tag != f"{NS}row":
                continue
            values = {column_index(cell.attrib.get("r", "A1")): value(cell) for cell in row.findall(f"{NS}c")}
            if not headers:
                width = max(values, default=-1) + 1
                headers = [values.get(index, "") for index in range(width)]
                row.clear()
                continue

            lat, lon = number(values.get(8)), number(values.get(9))
            nr_pci, lte_pci = number(values.get(11)), number(values.get(15))
            if lat is None or lon is None or (nr_pci is None and lte_pci is None):
                row.clear()
                continue
            rat = "NR5G" if nr_pci is not None else "LTE"
            pci = int(nr_pci if nr_pci is not None else lte_pci or 0)
            rsrp = number(values.get(12 if rat == "NR5G" else 16))
            rsrq = number(values.get(13 if rat == "NR5G" else 17))
            sinr = number(values.get(14 if rat == "NR5G" else 18))
            mos_candidates = [number(values.get(index)) for index in (27, 45, 55)]
            mos_values = [item for item in mos_candidates if item is not None and 0 < item <= 5]
            mos = statistics.fmean(mos_values) if mos_values else None
            jitter = number(values.get(21)) or number(values.get(39))
            delay = number(values.get(24)) or number(values.get(42))
            components = [item for item in (score_range(rsrp, -120, -70), score_range(rsrq, -20, -5), score_range(sinr, -5, 25)) if item is not None]
            radio = statistics.fmean(components) if components else 2.5
            qoe = radio * .78 + (mos if mos is not None else radio) * .22
            if jitter is not None and jitter > 30:
                qoe -= min(.8, (jitter - 30) / 80)
            if delay is not None and delay > 150:
                qoe -= min(.7, (delay - 150) / 400)
            qoe = round(clamp(qoe, 1, 5), 2)
            if rsrp is not None and rsrp < -105:
                cause = "coverage"
            elif sinr is not None and sinr < 3 and (rsrp or -120) >= -105:
                cause = "interference"
            elif mos is not None and mos < 2.8 and (rsrp or -120) >= -100:
                cause = "core"
            elif jitter is not None and jitter > 30:
                cause = "transport"
            else:
                cause = "healthy"
            records.append({
                "id": int(number(values.get(0)) or len(records) + 1), "time": excel_time(number(values.get(2))),
                "session": values.get(3, ""), "morphology": values.get(4, ""), "location": values.get(5, ""),
                "lat": lat, "lon": lon, "rat": rat, "pci": pci, "rsrp": rsrp, "rsrq": rsrq,
                "sinr": sinr, "mos": round(mos, 2) if mos is not None else None, "jitter": jitter,
                "delay": delay, "qoe": qoe, "cause": cause, "callResult": values.get(56, ""),
            })
            row.clear()


def avg(items: list[float | None]) -> float | None:
    usable = [item for item in items if item is not None]
    return round(statistics.fmean(usable), 2) if usable else None


grid: dict[tuple, dict] = {}
for record in records:
    key = (round(record["lat"], 4), round(record["lon"], 4), record["pci"])
    bucket = grid.setdefault(key, {"lat": key[0], "lon": key[1], "pci": key[2], "count": 0, "qoe": [], "rsrp": [], "rsrq": [], "sinr": [], "mos": [], "rat": record["rat"], "location": record["location"]})
    bucket["count"] += 1
    for field in ("qoe", "rsrp", "rsrq", "sinr", "mos"):
        if record[field] is not None:
            bucket[field].append(record[field])

heat_points = [{**{key: item[key] for key in ("lat", "lon", "pci", "count", "rat", "location")}, **{field: avg(item[field]) for field in ("qoe", "rsrp", "rsrq", "sinr", "mos")}} for item in grid.values()]
heat_points.sort(key=lambda item: (-item["count"], item["lat"], item["lon"]))
if len(heat_points) > 2600:
    heat_points = heat_points[:1200] + heat_points[1200::max(1, len(heat_points) // 1400)]
heat_points = heat_points[:2600]

pci_groups: dict[tuple, list[dict]] = defaultdict(list)
for record in records:
    pci_groups[(record["rat"], record["pci"])].append(record)
pci_summary = []
for (rat, pci), items in pci_groups.items():
    pci_summary.append({
        "rat": rat, "pci": pci, "samples": len(items), "mosSamples": sum(item["mos"] is not None for item in items), "location": Counter(item["location"] for item in items if item["location"]).most_common(1)[0][0],
        "lat": avg([item["lat"] for item in items]), "lon": avg([item["lon"] for item in items]),
        "qoe": avg([item["qoe"] for item in items]), "rsrp": avg([item["rsrp"] for item in items]),
        "rsrq": avg([item["rsrq"] for item in items]), "sinr": avg([item["sinr"] for item in items]),
        "mos": avg([item["mos"] for item in items]), "poorRate": round(100 * sum(item["qoe"] < 2.5 for item in items) / len(items), 1),
    })
pci_summary.sort(key=lambda item: (-item["samples"], item["pci"]))

hour_groups: dict[int, list[dict]] = defaultdict(list)
for record in records:
    if record["time"] != "--:--:--":
        hour_groups[int(record["time"][:2])].append(record)
hourly = [{"hour": hour, "samples": len(items), "qoe": avg([item["qoe"] for item in items]), "rsrp": avg([item["rsrp"] for item in items]), "sinr": avg([item["sinr"] for item in items]), "mos": avg([item["mos"] for item in items])} for hour, items in sorted(hour_groups.items())]

sessions: dict[str, list[dict]] = defaultdict(list)
for record in records:
    sessions[record["session"]].append(record)
journey_source = max(sessions.values(), key=lambda items: (len(items), len({item["pci"] for item in items})))
step = max(1, len(journey_source) // 12)
journey = [{key: item[key] for key in ("time", "location", "lat", "lon", "rat", "pci", "rsrp", "rsrq", "sinr", "mos", "qoe", "cause")} for item in journey_source[::step][:12]]

valid_mos = [item["mos"] for item in records if item["mos"] is not None]
overall_qoe = avg([item["qoe"] for item in records]) or 0
overall_rsrp = avg([item["rsrp"] for item in records]) or -120
overall_sinr = avg([item["sinr"] for item in records]) or -5
voice = avg(valid_mos) or overall_qoe
services = [
    {"key": "voice", "label": "Voice", "score": round(clamp(voice, 1, 5), 2), "basis": "MOS 실측"},
    {"key": "video", "label": "Video", "score": round(clamp(overall_qoe - max(0, 8 - overall_sinr) * .035, 1, 5), 2), "basis": "무선품질 추정"},
    {"key": "web", "label": "Web", "score": round(clamp(overall_qoe + .18, 1, 5), 2), "basis": "무선품질 추정"},
    {"key": "gaming", "label": "Gaming", "score": round(clamp(overall_qoe - .22, 1, 5), 2), "basis": "지연·무선품질 추정"},
]

cause_counts = Counter(item["cause"] for item in records)
locations = Counter(item["location"] for item in records if item["location"])
output = {
    "meta": {
        "source": BOOK.name, "sheet": "20260821_행정동", "totalRows": 48287, "validGeoRows": len(records),
        "measurementDate": "2026-08-21", "locations": [{"name": key, "samples": value} for key, value in locations.most_common()],
        "center": {"lat": avg([item["lat"] for item in records]), "lon": avg([item["lon"] for item in records])},
        "ratCounts": dict(Counter(item["rat"] for item in records)), "mosSamples": len(valid_mos),
    },
    "kpis": {
        "overallQoe": overall_qoe, "averageRsrp": overall_rsrp, "averageSinr": overall_sinr,
        "averageMos": avg(valid_mos), "poorSamples": sum(item["qoe"] < 2.5 for item in records),
        "uniquePci": len(pci_groups), "causeCounts": dict(cause_counts),
    },
    "services": services, "heatPoints": heat_points, "pciSummary": pci_summary[:80], "hourly": hourly, "journey": journey,
}
OUTPUT.parent.mkdir(exist_ok=True)
OUTPUT.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(json.dumps({"meta": output["meta"], "kpis": output["kpis"], "services": services, "heatPoints": len(heat_points), "topPci": pci_summary[:8], "hourly": hourly}, ensure_ascii=False, indent=2))
