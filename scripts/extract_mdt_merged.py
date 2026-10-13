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
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

from gnss_utm import CHOSEN, calib_latlon, korea_bbox, to_latlon
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


def resolve_coords(row, centroids, stations_by_equip=None):
    """Per-row customer position: projected GNSS (CHOSEN candidate first, then the
    master-calibrated affine), else the row's real base station coordinate, else
    cell centroid, else None so build_dataset applies the site fallback."""
    x, y = _row_xy(row)
    if x is not None:
        if CHOSEN:
            point = to_latlon(x, y, CHOSEN)
            if point is not None:
                return point
        point = calib_latlon(x, y)
        if point is not None and korea_bbox(*point):
            return point
    equip = (row.get("mdt_equip_cd") or "").strip()
    if stations_by_equip and equip in stations_by_equip:
        return stations_by_equip[equip]
    return centroids.get((row.get("mdt_cell_id") or "").strip())


def load_real_stations(path):
    """Parse BaseStation_new.txt (`base_station_id,lat,lon` lines, WGS84).

    cellId is set to the station id: MDT rows carry numeric cell ids that never
    collide with it, so the estimator joins via baseStationId fallback."""
    stations, by_equip, errors = [], {}, []
    if not path.exists():
        return stations, by_equip, ["기지국 Master 파일 없음: %s" % path]
    for line in path.read_text(encoding="utf-8").splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 3 or not parts[0]:
            continue
        try:
            lat, lon = float(parts[1]), float(parts[2])
        except ValueError:
            continue
        by_equip.setdefault(parts[0], (lat, lon))
    for station_id, (lat, lon) in by_equip.items():
        stations.append({"baseStationId": station_id, "cellId": station_id, "frequency": None,
                         "latitude": lat, "longitude": lon, "pci": None, "txPowerDbm": None,
                         "txPowerType": "", "isVirtual": False, "provenanceUnknown": False})
    if not stations:
        errors.append("기지국 Master 파싱 결과 없음")
    return stations, by_equip, errors


def build_dataset(rows, coords, site_name=SITE, source_stats=None):
    """rows: normalized dicts from read_merged_rows. coords: dict -> (lat, lon) | None."""
    groups = defaultdict(list)
    for index, row in enumerate(rows):
        groups[call_key(row)].append((index, row))

    per_day = defaultdict(list)
    customers = {}
    call_meta = {}
    unscored = 0

    for index, key in enumerate(sorted(groups), 1):
        entries = groups.pop(key)
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
            gnss_x, gnss_y = _row_xy(row)
            samples.append([
                second_of_day(at), at.strftime("%H:%M:%S"), coord[0], coord[1],
                site_name, "indoor" if row.get("out_in_div_cd") == "1" else "outdoor",
                "", "", "LTE", numeric(row.get("pci")), rsrp, rsrq, sinr,
                None, None, None, qoe, "healthy", "측정구역", call_id, ci,
                {"timestamp": at.isoformat(timespec="milliseconds") + "+09:00",
                 "baseStationId": (row.get("mdt_equip_cd") or "").strip(),
                 "cellId": (row.get("mdt_cell_id") or "").strip(),
                 "frequency": numeric(row.get("dlearfcn")),
                 "gnss": gnss_x is not None,
                 "streamId": customer_id},
            ])
        if not samples:
            continue
        call_meta[call_id] = {"start": _hhmmss(start), "end": _hhmmss(end)}
        samples.sort(key=lambda sample: sample[0])
        per_day[(customer_id, date)].extend(samples)
        customer["dates"].add(date)
        customer["sampleCount"] += len(samples)

    output_days = []
    for (customer_id, date), samples in sorted(per_day.items(), key=lambda item: (item[0][1], item[0][0])):
        # Calls sharing a customer-day are appended in call order; re-sort the
        # merged series so time-dependent selectors (episode gaps, sampling
        # interval) see monotonic seconds. Stable, so same-second rows keep order.
        samples.sort(key=lambda sample: sample[0])
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
    parser.add_argument("--stations", default="data/BaseStation/BaseStation_new.txt",
                        help="real base station master: base_station_id,lat,lon per line")
    parser.add_argument("--min-samples", type=int, default=None,
                        help="contract sample threshold; defaults to size-estimate guard")
    args = parser.parse_args(argv)

    src = Path(args.src) if args.src else next((p for p in Path("data").glob("*lte+mdt*.xlsx")
                                                if not p.name.startswith("~$")), None)
    if src is None:
        raise SystemExit("No source workbook: pass --src or place data/*lte+mdt*.xlsx")
    out = Path(args.out)

    base_stations, stations_by_equip, master_errors = load_real_stations(Path(args.stations))

    gnss_valid = 0
    calibrated = 0
    total_rows = 0
    mdt_rows = 0
    master_hit_rows = 0
    equips = Counter()
    projected = []                 # valid GNSS rows -> (cellId, lat, lon)
    contracts = Counter()
    with src.open("rb") as source_handle:
        for row in read_merged_rows(source_handle):
            total_rows += 1
            contracts[row.get("svc_cont_id") or ""] += 1
            equip = (row.get("mdt_equip_cd") or "").strip()
            cell = (row.get("mdt_cell_id") or "").strip()
            if equip:
                equips[equip] += 1
                if equip in stations_by_equip:
                    master_hit_rows += 1
            if equip or cell:
                mdt_rows += 1
            x, y = _row_xy(row)
            if x is None:
                continue
            gnss_valid += 1
            point = to_latlon(x, y, CHOSEN) if CHOSEN else calib_latlon(x, y)
            if cell and point is not None and korea_bbox(*point):
                projected.append((cell, point[0], point[1]))
                calibrated += 1

    # Size guard: tiny contracts (mostly test/noise rows) blow the single JSON up.
    estimate = total_rows * ESTIMATED_BYTES_PER_SAMPLE
    guarded = estimate > MAX_JSON_BYTES
    threshold = args.min_samples if args.min_samples is not None else (MIN_SAMPLES_PER_CONTRACT if guarded else 0)

    centroids = cell_centroids(projected)
    if base_stations:
        master_errors.append(
            "고객 좌표: GNSS 유효 행(%d건)은 베이스스테이션 마스터로 캘리브레이션된 affine 좌표(중위 오프셋 약 210m), "
            "좌표 없는 행은 해당 기지국 좌표 사용 (equip 일치 %d/%d 건)"
            % (calibrated, master_hit_rows, mdt_rows))

    filtered_contracts = sum(1 for name, count in contracts.items() if name and count < threshold) if threshold else 0
    with src.open("rb") as source_handle:
        kept = (row for row in read_merged_rows(source_handle)
                if not threshold or contracts.get(row.get("svc_cont_id") or "", 0) >= threshold)
        dataset = build_dataset(kept,
                                lambda row: resolve_coords(row, centroids, stations_by_equip),
                                site_name=SITE, source_stats={src.name: total_rows})
    dataset["meta"]["baseStations"] = base_stations
    dataset["meta"]["masterErrors"] = master_errors
    dataset["meta"]["filteredContracts"] = filtered_contracts

    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8") as handle:
        json.dump(dataset, handle, ensure_ascii=False, separators=(",", ":"))
    size = out.stat().st_size
    print(json.dumps({"MDT_rows": total_rows, "events": sum(d["sampleCount"] for d in dataset["days"]),
                      "source_calls": len(dataset["meta"]["callMeta"]),
                      "unscored_calls": dataset["meta"]["unscoredCalls"],
                      "gnss_valid_rows": gnss_valid, "calibrated_rows": calibrated,
                      "stations": len(base_stations), "equips": len(equips),
                      "filtered_contracts": filtered_contracts,
                      "threshold": threshold, "json_bytes": size,
                      "projection": CHOSEN or "calibrated-affine"}, ensure_ascii=False))
    if size > MAX_JSON_BYTES:
        print("WARN: json_bytes %d exceeds MAX_JSON_BYTES %d; raise --min-samples" % (size, MAX_JSON_BYTES),
              file=sys.stderr)
    return dataset


if __name__ == "__main__":
    main()
