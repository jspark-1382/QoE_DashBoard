"""Convert the merged LTE+MDT workbook (English schema) into the ExecutiveDataset
shape consumed by the existing /qoe/?source=MDT dashboard.

Import-safe: pure conversion here; main() is the CLI entry point. Follows the
tuple schema of extract_mdt_data.py (see sampleFields). The virtual base
station master is bootstrapped from GNSS cell centroids when the projection
gate resolved a coordinate system (see gnss_utm.CHOSEN); otherwise the
pipeline runs in degraded mode with site representative coordinates.
"""
import argparse
import hashlib
import json
import math
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

from gnss_utm import CHOSEN, to_latlon
from mdt_merged_source import parse_timestamp, read_merged_rows, second_of_day

POOR_QOE_THRESHOLD = 2.5
SITE = "개포4동"
FALLBACK_COORD = (37.5, 127.05)
MAX_JSON_BYTES = 80_000_000
MIN_SAMPLES_PER_CONTRACT = 100
ESTIMATED_BYTES_PER_SAMPLE = 260

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


def _row_xy(row):
    try:
        x, y = float(row.get("gnss_utmkx") or 0), float(row.get("gnss_utmky") or 0)
    except (TypeError, ValueError):
        return None, None
    if x <= 0 or y <= 0:
        return None, None
    return x, y


def cell_centroids(pairs):
    """Median lat/lon per cellId from valid GNSS projected pairs; cells with <3 rows drop out."""
    groups = defaultdict(list)
    for cell_id, lat, lon in pairs:
        groups[cell_id].append((lat, lon))
    centroids = {}
    for cell_id, values in groups.items():
        if len(values) < 3:
            continue
        lats = sorted(v[0] for v in values)
        lons = sorted(v[1] for v in values)
        mid = len(values) // 2
        lat = lats[mid] if len(values) % 2 else (lats[mid - 1] + lats[mid]) / 2
        lon = lons[mid] if len(values) % 2 else (lons[mid - 1] + lons[mid]) / 2
        centroids[cell_id] = (lat, lon)
    return centroids


def write_master_csv(centroids, meta_by_cell, path):
    """Legacy-header master (load_master legacy branch): base_station_id first, is_virtual true."""
    lines = ["base_station_id,cell_id,frequency,pci,latitude,longitude,is_virtual"]
    for cell_id in sorted(centroids):
        lat, lon = centroids[cell_id]
        meta = meta_by_cell.get(cell_id, {})
        frequency = meta.get("frequency")
        pci = meta.get("pci")
        lines.append("%s,%s,%s,%s,%.6f,%.6f,true" % (
            meta.get("baseStationId") or cell_id, cell_id,
            "" if frequency is None else int(frequency),
            "" if pci is None else int(pci), lat, lon))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


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


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--src", default=None, help="workbook to ingest (defaults to data/*lte+mdt*.xlsx)")
    parser.add_argument("--out", default="public/mdt-data.json")
    parser.add_argument("--master", default="data/BaseStation/virtual_base_station.csv")
    parser.add_argument("--min-samples", type=int, default=None,
                        help="contract sample threshold; defaults to size-estimate guard")
    args = parser.parse_args(argv)

    src = Path(args.src) if args.src else next(p for p in Path("data").glob("*lte+mdt*.xlsx")
                                               if not p.name.startswith("~$"))
    out, master = Path(args.out), Path(args.master)

    gnss_valid = 0
    total_rows = 0
    projected = []
    meta_by_cell = {}
    contracts = Counter()
    for row in read_merged_rows(src.open("rb")):
        total_rows += 1
        contracts[row.get("svc_cont_id") or ""] += 1
        cell = (row.get("mdt_cell_id") or "").strip()
        x, y = _row_xy(row)
        if x is not None:
            gnss_valid += 1
        if CHOSEN:
            if x is None or not cell:
                continue
            projected_xy = to_latlon(x, y, CHOSEN)
        else:
            # Degraded mode: every MDT cell gets a virtual station at the site
            # representative coordinate so the estimation layer (and its
            # harness contract over public/mdt-data.json) keeps working,
            # mirroring the legacy fixed-location MDT behaviour.
            if not cell:
                continue
            projected_xy = FALLBACK_COORD
        if projected_xy is None:
            continue
        projected.append((cell, projected_xy[0], projected_xy[1]))
        if cell not in meta_by_cell:
            meta_by_cell[cell] = {"baseStationId": (row.get("mdt_equip_cd") or "").strip(),
                                  "frequency": numeric(row.get("dlearfcn")),
                                  "pci": numeric(row.get("pci"))}

    # Size guard: tiny contracts (mostly test/noise rows) blow the single JSON up.
    estimate = total_rows * ESTIMATED_BYTES_PER_SAMPLE
    guarded = estimate > MAX_JSON_BYTES
    threshold = args.min_samples if args.min_samples is not None else (MIN_SAMPLES_PER_CONTRACT if guarded else 0)

    centroids = cell_centroids(projected)
    master_errors = []
    base_stations = []
    if centroids:
        write_master_csv(centroids, meta_by_cell, master)
        from base_station_master import load_master
        base_stations, master_errors = load_master(master)
        if not CHOSEN:
            master_errors.append("좌표계 미결정 — 가상 기지국 위치는 사이트 대표 좌표(개포4동) 사용")
    else:
        master_errors.append("좌표계 미결정 또는 GNSS 유효 행 부족 — 위치추정 및 기지국 Master 부트스트랩 비활")

    def coords(row):
        """Cell centroid when bootstrapped, else None so build_dataset applies the site fallback.
        Direct per-row GNSS use stays gated on CHOSEN inside the projection pass above."""
        return centroids.get((row.get("mdt_cell_id") or "").strip())

    kept = (row for row in read_merged_rows(src.open("rb"))
            if not threshold or contracts.get(row.get("svc_cont_id") or "", 0) >= threshold)
    filtered_contracts = sum(1 for name, count in contracts.items() if name and count < threshold) if threshold else 0
    dataset = build_dataset(kept, coords, site_name=SITE, source_stats={src.name: total_rows})
    dataset["meta"]["baseStations"] = base_stations
    dataset["meta"]["masterErrors"] = master_errors
    dataset["meta"]["filteredContracts"] = filtered_contracts

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(dataset, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    size = out.stat().st_size
    print(json.dumps({"rows": total_rows, "events": sum(d["sampleCount"] for d in dataset["days"]),
                      "source_calls": len(dataset["meta"]["callMeta"]),
                      "unscored_calls": dataset["meta"]["unscoredCalls"],
                      "gnss_valid_rows": gnss_valid, "stations": len(base_stations),
                      "filtered_contracts": filtered_contracts,
                      "threshold": threshold, "json_bytes": size,
                      "projection": CHOSEN or "unresolved"}, ensure_ascii=False))
    return dataset


if __name__ == "__main__":
    main()
