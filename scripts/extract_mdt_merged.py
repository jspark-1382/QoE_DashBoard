"""Convert the merged LTE+MDT workbook (English schema) into the ExecutiveDataset
shape consumed by the existing /qoe/?source=MDT dashboard.

Import-safe: pure conversion here; the CLI entry point lands later. Follows
the tuple schema of extract_mdt_data.py (see sampleFields).
"""
import hashlib
import math
from collections import defaultdict
from datetime import datetime

from mdt_merged_source import parse_timestamp, second_of_day

POOR_QOE_THRESHOLD = 2.5
SITE = "개포4동"
FALLBACK_COORD = (37.5, 127.05)

SAMPLE_FIELDS = ["second", "time", "lat", "lon", "site", "areaType", "floorCode", "floorName",
                 "rat", "pci", "rsrp", "rsrq", "sinr", "mos", "jitter", "delay", "qoe",
                 "cause", "morphology", "callId", "ci", "mdt"]

_SCORE_WINDOWS = (("rsrp", -120, -70), ("rsrq", -20, -5), ("nsinr", -5, 25))


def numeric(value):
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def call_key(row):
    return (row.get("base_date") or "", row.get("svc_cont_id") or "", row.get("svc_ctgry_st_hhmiss") or "")


def score_records(records):
    parts = []
    for field, low, high in _SCORE_WINDOWS:
        values = [numeric(row.get(field)) for row in records]
        values = [v for v in values if v is not None]
        if values:
            parts.append(1 + 4 * max(0, min(1, (sum(values) / len(values) - low) / (high - low))))
    return round(sum(parts) / len(parts), 2) if parts else None


def _sha(text, length=16):
    return hashlib.sha256(text.encode()).hexdigest()[:length]


def _hhmmss(hhmiss):
    digits = str(hhmiss or "")
    if len(digits) != 6 or not digits.isdigit():
        return ""
    return digits[:2] + ":" + digits[2:4] + ":" + digits[4:]


def build_dataset(rows, coords, site_name=SITE, source_stats=None):
    """rows: normalized dicts from read_merged_rows. coords: dict -> (lat, lon) | None."""
    groups = defaultdict(list)
    for index, row in enumerate(rows):
        groups[call_key(row)].append((index, row))

    per_day = defaultdict(list)
    customers = {}
    call_meta = {}
    unscored = 0

    for index, (key, entries) in enumerate(sorted(groups.items()), 1):
        date_raw, contract, _hhmiss = key
        if not contract:
            continue
        records = [row for _, row in entries]
        qoe = score_records(records)
        if qoe is None:
            unscored += 1
            continue
        try:
            day = datetime.strptime(date_raw, "%Y%m%d")
        except ValueError:
            continue
        date = "%04d-%02d-%02d" % (day.year, day.month, day.day)

        customer_id = _sha(contract)
        call_id = _sha("|".join(key))
        ci = str(index)
        start = next((row.get("svc_ctgry_st_hhmiss") for _, row in entries if row.get("svc_ctgry_st_hhmiss")), "")
        end = next((row.get("svc_ctgry_fns_hhmiss") for _, row in entries if row.get("svc_ctgry_fns_hhmiss")), "")
        call_meta[call_id] = {"start": _hhmmss(start), "end": _hhmmss(end)}

        customer = customers.get(customer_id)
        if customer is None:
            customer = customers[customer_id] = {
                "id": customer_id,
                "maskedPhone": "계약 " + _sha(contract, 4),
                "displayName": "측정 계약 %d" % (len(customers) + 1),
                "dates": set(),
                "sampleCount": 0,
                "hasName": False,
            }

        samples = []
        for _order, row in sorted(entries, key=lambda entry: entry[0]):
            at = parse_timestamp(row.get("rqt_timestamp"))
            if at is None:
                continue
            rsrp = numeric(row.get("rsrp"))
            rsrq = numeric(row.get("rsrq"))
            sinr = numeric(row.get("nsinr"))
            if rsrp is None and rsrq is None and sinr is None:
                continue
            coord = coords(row) or FALLBACK_COORD
            samples.append([
                second_of_day(at), at.strftime("%H:%M:%S"), coord[0], coord[1],
                site_name, "indoor" if row.get("out_in_div_cd") == "1" else "outdoor",
                "", "", "LTE", numeric(row.get("pci")), rsrp, rsrq, sinr,
                None, None, None, qoe, "healthy", "측정구역", call_id, ci,
                {"timestamp": at.isoformat(timespec="milliseconds") + "+09:00",
                 "baseStationId": (row.get("mdt_equip_cd") or "").strip(),
                 "cellId": (row.get("mdt_cell_id") or "").strip(),
                 "frequency": numeric(row.get("dlearfcn")),
                 "streamId": customer_id},
            ])
        if not samples:
            continue
        samples.sort(key=lambda sample: sample[0])
        per_day[(customer_id, date)].extend(samples)
        customer["dates"].add(date)
        customer["sampleCount"] += len(samples)

    output_days = []
    for (customer_id, date), samples in sorted(per_day.items(), key=lambda item: (item[0][1], item[0][0])):
        output_days.append({"key": customer_id + ":" + date, "customerId": customer_id, "date": date,
                            "service": "Voice", "sampleCount": len(samples), "sites": [site_name],
                            "rats": ["LTE"], "areaTypes": sorted({sample[5] for sample in samples}),
                            "samples": samples})

    customers_list = sorted(
        [dict(customer, dates=sorted(customer["dates"])) for customer in customers.values()],
        key=lambda customer: (-customer["sampleCount"], customer["id"]))

    meta = {
        "sourceFiles": list(source_stats or {}),
        "sourceRows": dict(source_stats or {}),
        "dates": sorted({date for (_cid, date) in per_day}),
        "poorQoeThreshold": POOR_QOE_THRESHOLD,
        "qoeBasis": "call-radio-estimate",
        "source": "MDT",
        "fixedLocation": False,
        "unscoredCalls": unscored,
        "callMeta": call_meta,
        "baseStations": [],
        "masterErrors": [],
        "frequencyEncoding": "lte-earfcn",
        "sampleFields": SAMPLE_FIELDS,
        "classification": {"measured": ["rsrp", "rsrq", "sinr"], "derived": ["QoE"], "estimated": ["location"]},
    }
    return {"meta": meta, "customers": customers_list, "days": output_days}
