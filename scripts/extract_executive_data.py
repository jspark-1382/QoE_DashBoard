from __future__ import annotations

import hashlib
import json
import math
import re
import statistics
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from xml.etree import ElementTree as ET

DATA_DIR = Path("data")
OUTPUT = Path("public/executive-data.json")
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


def normalize_phone(value: str) -> str:
    digits = "".join(char for char in value if char.isdigit())
    if digits.startswith("82") and len(digits) >= 11:
        digits = "0" + digits[2:]
    if digits.startswith("10") and len(digits) == 10:
        digits = "0" + digits
    return digits if len(digits) >= 10 else ""


def phone_from_measure(measure: str) -> str:
    match = re.search(r"_(010\d{8})_", measure)
    return match.group(1) if match else ""


def masked_phone(phone: str) -> str:
    if len(phone) < 11:
        return "식별번호 없음"
    return f"{phone[:3]}-{phone[3:5]}**-{phone[-4:]}"


def average(values: list[float | None]) -> float | None:
    usable = [value for value in values if value is not None]
    return round(statistics.fmean(usable), 2) if usable else None


def qoe_score(rsrp: float | None, rsrq: float | None, sinr: float | None, mos: float | None, jitter: float | None, delay: float | None) -> float:
    radio_parts = [part for part in (
        score_range(rsrp, -120, -70),
        score_range(rsrq, -20, -5),
        score_range(sinr, -5, 25),
    ) if part is not None]
    radio = statistics.fmean(radio_parts) if radio_parts else 2.5
    score = radio * .78 + (mos if mos is not None else radio) * .22
    if jitter is not None and jitter > 30:
        score -= min(.8, (jitter - 30) / 80)
    if delay is not None and delay > 150:
        score -= min(.7, (delay - 150) / 400)
    return round(clamp(score, 1, 5), 2)


def sample_cause(rsrp: float | None, sinr: float | None, mos: float | None, jitter: float | None, delay: float | None) -> str:
    if rsrp is not None and rsrp < -105:
        return "coverage"
    if sinr is not None and sinr < 3 and (rsrp is None or rsrp >= -105):
        return "interference"
    if jitter is not None and jitter > 30 or delay is not None and delay > 150:
        return "transport"
    if mos is not None and mos < 2.8 and (rsrp is None or rsrp >= -100):
        return "voice"
    return "healthy"


def read_rows(path: Path):
    with zipfile.ZipFile(path) as archive:
        names = set(archive.namelist())
        strings: list[str] = []
        if "xl/sharedStrings.xml" in names:
            root = ET.parse(archive.open("xl/sharedStrings.xml")).getroot()
            strings = ["".join(node.text or "" for node in item.iter(f"{NS}t")) for item in root]

        def value(cell: ET.Element) -> str:
            node = cell.find(f"{NS}v")
            if node is None:
                return ""
            raw = node.text or ""
            return strings[int(raw)] if raw and cell.attrib.get("t") == "s" else raw

        sheet = sorted(name for name in names if name.startswith("xl/worksheets/sheet") and name.endswith(".xml"))[0]
        with archive.open(sheet) as stream:
            first = True
            for _, row in ET.iterparse(stream, events=("end",)):
                if row.tag != f"{NS}row":
                    continue
                values = {column_index(cell.attrib.get("r", "A1")): value(cell) for cell in row.findall(f"{NS}c")}
                row.clear()
                if first:
                    first = False
                    continue
                yield values


records: dict[tuple[str, str], list[dict]] = defaultdict(list)
customer_phones: dict[str, str] = {}
source_rows: dict[str, int] = {}

for book in sorted(DATA_DIR.glob("*.xlsx")):
    row_count = 0
    for values in read_rows(book):
        row_count += 1
        measure = values.get(3, "")
        phone = normalize_phone(values.get(10, "")) or phone_from_measure(measure)
        if not phone:
            continue
        excel_value = number(values.get(2))
        if excel_value is None:
            continue
        measured_at = datetime(1899, 12, 30) + timedelta(days=excel_value)
        date = measured_at.strftime("%Y-%m-%d")
        lat, lon = number(values.get(8)), number(values.get(9))
        nr_pci, lte_pci = number(values.get(11)), number(values.get(15))
        if lat is None or lon is None or (nr_pci is None and lte_pci is None):
            continue
        rat = "NR5G" if nr_pci is not None else "LTE"
        pci = int(nr_pci if nr_pci is not None else lte_pci or 0)
        rsrp = number(values.get(12 if rat == "NR5G" else 16))
        rsrq = number(values.get(13 if rat == "NR5G" else 17))
        sinr = number(values.get(14 if rat == "NR5G" else 18))
        mos_values = [value for value in (number(values.get(27)), number(values.get(45)), number(values.get(55))) if value is not None and 0 < value <= 5]
        mos = round(statistics.fmean(mos_values), 2) if mos_values else None
        jitter = number(values.get(21)) or number(values.get(39))
        delay = number(values.get(24)) or number(values.get(42))
        qoe = qoe_score(rsrp, rsrq, sinr, mos, jitter, delay)
        customer_id = hashlib.sha256(phone.encode("utf-8")).hexdigest()[:12]
        customer_phones[customer_id] = masked_phone(phone)
        records[(customer_id, date)].append({
            "second": measured_at.hour * 3600 + measured_at.minute * 60 + measured_at.second + measured_at.microsecond / 1_000_000,
            "time": measured_at.strftime("%H:%M:%S"),
            "lat": lat,
            "lon": lon,
            "site": values.get(5, "") or "장소 정보 없음",
            "areaType": "indoor" if "인빌딩" in measure or "RTCP" in book.name.upper() else "outdoor",
            "floorCode": values.get(6, ""),
            "floorName": values.get(7, ""),
            "rat": rat,
            "pci": pci,
            "rsrp": rsrp,
            "rsrq": rsrq,
            "sinr": sinr,
            "mos": mos,
            "jitter": jitter,
            "delay": delay,
            "qoe": qoe,
            "cause": sample_cause(rsrp, sinr, mos, jitter, delay),
        })
    source_rows[book.name] = row_count


days = []
customer_dates: dict[str, set[str]] = defaultdict(set)
customer_samples: Counter[str] = Counter()
for (customer_id, date), samples in sorted(records.items()):
    samples.sort(key=lambda item: item["second"])
    customer_dates[customer_id].add(date)
    customer_samples[customer_id] += len(samples)
    sites = Counter(sample["site"] for sample in samples)
    rats = Counter(sample["rat"] for sample in samples)
    area_types = Counter(sample["areaType"] for sample in samples)
    # Compact tuples keep the local generated file small. Field order is declared in meta.sampleFields.
    compact = [[
        round(sample["second"], 3), sample["time"], round(sample["lat"], 7), round(sample["lon"], 7),
        sample["site"], sample["areaType"], sample["floorCode"], sample["floorName"], sample["rat"], sample["pci"],
        sample["rsrp"], sample["rsrq"], sample["sinr"], sample["mos"], sample["jitter"], sample["delay"],
        sample["qoe"], sample["cause"],
    ] for sample in samples]
    days.append({
        "key": f"{customer_id}:{date}",
        "customerId": customer_id,
        "date": date,
        "service": "Voice",
        "sampleCount": len(samples),
        "sites": [name for name, _ in sites.most_common()],
        "rats": [name for name, _ in rats.most_common()],
        "areaTypes": [name for name, _ in area_types.most_common()],
        "samples": compact,
    })

customers = [{
    "id": customer_id,
    "maskedPhone": customer_phones[customer_id],
    "displayName": f"측정 고객 {index + 1:02d}",
    "dates": sorted(customer_dates[customer_id]),
    "sampleCount": customer_samples[customer_id],
    "hasName": False,
} for index, customer_id in enumerate(sorted(customer_phones, key=lambda key: customer_phones[key]))]

output = {
    "meta": {
        "sourceFiles": list(source_rows),
        "sourceRows": source_rows,
        "dates": sorted({date for _, date in records}),
        "poorQoeThreshold": 2.5,
        "sampleFields": ["second", "time", "lat", "lon", "site", "areaType", "floorCode", "floorName", "rat", "pci", "rsrp", "rsrq", "sinr", "mos", "jitter", "delay", "qoe", "cause"],
        "classification": {
            "measured": ["time", "latitude", "longitude", "site", "floor", "RAT", "PCI", "RSRP", "RSRQ", "SINR", "MOS", "jitter", "delay"],
            "derived": ["QoE", "Poor Episode", "Journey Event", "Rule 기반 원인", "Rule 기반 권장 조치"],
            "estimated": [],
        },
    },
    "customers": customers,
    "days": days,
}

OUTPUT.parent.mkdir(exist_ok=True)
OUTPUT.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(json.dumps({
    "output": str(OUTPUT),
    "sizeMb": round(OUTPUT.stat().st_size / 1024 / 1024, 2),
    "customers": len(customers),
    "days": len(days),
    "samples": sum(day["sampleCount"] for day in days),
    "dates": output["meta"]["dates"],
}, ensure_ascii=False, indent=2))
