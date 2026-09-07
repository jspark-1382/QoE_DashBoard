"""Adapt MDT event reports without inventing GPS tracks, PCI or MOS."""
import hashlib
import csv
import json
import math
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from statistics import fmean
import zipfile
from xml.etree import ElementTree as ET

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
SITE = "힐스테이트신용더리버아파트"
def numeric(value):
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (ValueError, TypeError):
        return None

def read_rows(path):
    with zipfile.ZipFile(path) as archive:
        strings = ["".join(item.itertext()) for item in ET.fromstring(archive.read("xl/sharedStrings.xml"))] if "xl/sharedStrings.xml" in archive.namelist() else []
        headers = {}
        for _, row in ET.iterparse(archive.open("xl/worksheets/sheet1.xml"), events=("end",)):
            if row.tag != NS + "row":
                continue
            values = {}
            for cell in row:
                col = "".join(filter(str.isalpha, cell.attrib.get("r", "")))
                node = cell.find(NS + "v")
                raw = node.text if node is not None else ""
                values[col] = strings[int(raw)] if raw and cell.attrib.get("t") == "s" else "".join(t.text or "" for t in cell.iter(NS + "t")) if cell.attrib.get("t") == "inlineStr" else raw
            row.clear()
            if not headers:
                headers = values
            else:
                yield {headers.get(col, col): value for col, value in values.items()}

def score(records):
    parts = []
    for field, low, high in (("rsrp", -120, -70), ("rsrq", -20, -5), ("nsinr", -5, 25)):
        values = [numeric(row.get(field)) for row in records]
        values = [v for v in values if v is not None]
        if values:
            parts.append(1 + 4 * max(0, min(1, (fmean(values) - low) / (high - low))))
    return round(fmean(parts), 2) if parts else None

groups = defaultdict(list)
source_rows = {}
for path in sorted(Path("data/MDT").glob("*.xlsx")):
    if path.name.startswith("~$"):
        continue
    rows = list(read_rows(path))
    source_rows[path.name] = len(rows)
    for row in rows:
        # ims_charge_id joins the originating/terminating reports of the same call.
        key = row.get("ims_charge_id") or row.get("통화호구분")
        if key and key != "_":
            groups[(row.get("기준년월일"), key)].append(row)

days = defaultdict(list)
unscored = 0
call_meta = {}
base_stations = []
master_errors = []
master_path = Path("data/BaseStation/virtual_base_station.csv")
if master_path.exists():
    with master_path.open(encoding="utf-8-sig", newline="") as stream:
        for line, row in enumerate(csv.DictReader(stream), 2):
            lat, lon = numeric(row.get("latitude")), numeric(row.get("longitude"))
            if lat is None or lon is None or not (-90 <= lat <= 90 and -180 <= lon <= 180) or not row.get("cell_id"):
                master_errors.append(f"Master {line}행: 좌표 또는 Cell ID 누락")
                continue
            base_stations.append({"baseStationId": row.get("base_station_id", "").strip(), "cellId": row["cell_id"].strip(),
                "frequency": numeric(row.get("frequency")), "latitude": lat, "longitude": lon,
                "txPowerDbm": numeric(row.get("tx_power_dbm")), "txPowerType": row.get("tx_power_type", "").upper(),
                "isVirtual": row.get("is_virtual", "").strip().lower() in ("true", "1", "yes")})
else:
    master_errors.append("기지국 Master 없음")
for index, ((date_raw, key), records) in enumerate(sorted(groups.items()), 1):
    qoe = score(records)
    if qoe is None:
        unscored += 1
        continue
    date = datetime.strptime(date_raw, "%Y%m%d").strftime("%Y-%m-%d")
    call_id = hashlib.sha256(key.encode()).hexdigest()[:16]
    ci = str(index)
    call_meta[call_id] = {"start": records[0].get("시작시간", "")[-8:], "end": records[0].get("종료시간", "")[-8:]}
    for row in records:
        stamp = row.get("MDT발생일시", "")
        try:
            at = datetime.strptime(stamp, "%Y%m%d%H%M%S.%f") if "." in stamp else datetime.strptime(stamp, "%Y%m%d%H%M%S")
        except ValueError:
            continue
        rsrp, rsrq, sinr = (numeric(row.get(field)) for field in ("rsrp", "rsrq", "nsinr"))
        if all(value is None for value in (rsrp, rsrq, sinr)):
            continue
        second = at.hour * 3600 + at.minute * 60 + at.second + at.microsecond / 1e6
        days[date].append([second, at.strftime("%H:%M:%S"), 35.2123, 126.8647, SITE, "indoor", "", "", "UNKNOWN", None,
            rsrp, rsrq, sinr, None, None, None, qoe, "healthy", "주거지역", call_id, ci,
            {"timestamp": at.isoformat(timespec="milliseconds") + "+09:00",
             "baseStationId": row.get("기지국ID(MDT)", "").strip().replace("_", ""),
             "cellId": row.get("Cell_ID(MDT)", "").strip().replace("_", ""),
             "frequency": numeric(row.get("주파수(MDT)")),
             "streamId": hashlib.sha256((row.get("서비스계약") if row.get("서비스계약") not in (None, "", "_") else key).encode()).hexdigest()[:16]}])

output_days = [{"key": "mdt-site:" + date, "customerId": "mdt-site", "date": date, "service": "Voice",
    "sampleCount": len(samples), "sites": [SITE], "rats": [], "areaTypes": ["indoor"],
    "samples": sorted(samples, key=lambda sample: sample[0])} for date, samples in sorted(days.items())]
output = {"meta": {"sourceFiles": list(source_rows), "sourceRows": source_rows, "dates": sorted(days),
    "poorQoeThreshold": 2.5, "qoeBasis": "call-radio-estimate", "source": "MDT",
    "fixedLocation": True, "unscoredCalls": unscored, "callMeta": call_meta,
    "baseStations": base_stations, "masterErrors": master_errors, "frequencyEncoding": "unknown",
    "sampleFields": ["second","time","lat","lon","site","areaType","floorCode","floorName","rat","pci","rsrp","rsrq","sinr","mos","jitter","delay","qoe","cause","morphology","callId","ci","mdt"],
    "classification": {"measured": ["rsrp","rsrq","sinr"], "derived": ["QoE"], "estimated": ["location"]}},
    "customers": [{"id": "mdt-site", "displayName": "MDT 사이트 전체", "maskedPhone": "사이트 단위 조회", "dates": sorted(days),
        "sampleCount": sum(len(s) for s in days.values()), "hasName": False}] if days else [], "days": output_days}
Path("public/mdt-data.json").write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(json.dumps({"MDT_rows": sum(source_rows.values()), "events": sum(len(s) for s in days.values()), "source_calls": len(groups), "unscored_calls": unscored}, ensure_ascii=False))
