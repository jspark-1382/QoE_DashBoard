"""Read-only source Excel GNSS completeness audit; aggregate counts only, no subscriber IDs."""
from __future__ import annotations
import collections,json,math
from pathlib import Path
from openpyxl import load_workbook

ROOT=Path(__file__).resolve().parent.parent
PATH=next((ROOT/"data/MDT_New").glob("261026_1030_VoLTE+MDT*.xlsx"))
REVISION=json.loads((ROOT/"public/voice-1030.json").read_text("utf8"))["meta"]["revision"]

def number(v):
    if v is None or isinstance(v,bool):return None
    try:
        val=float(v)
        return val if math.isfinite(val) else None
    except (ValueError,TypeError):return None

def run():
    book=load_workbook(PATH,read_only=True,data_only=True)
    try:
        sheet=book.active
        header=list(next(sheet.iter_rows(max_row=1,values_only=True)))
        pos={name:header.index(name) for name in ["base_date","mdt_div","gnss_utmkx","gnss_utmky",
              "gnss_metric_id","rsrp","rsrq","nsinr","rpt_type","trigr_ev"]}
        overall=collections.Counter()
        by_day=collections.defaultdict(collections.Counter)
        by_phase=collections.defaultdict(collections.Counter)
        by_rpt=collections.defaultdict(collections.Counter)
        for row in sheet.iter_rows(min_row=2,values_only=True):
            day=str(row[pos["base_date"]] or "")
            phase=str(row[pos["mdt_div"]] or "unknown")
            rpt=str(row[pos["rpt_type"]] or "unknown")
            x,y=number(row[pos["gnss_utmkx"]]),number(row[pos["gnss_utmky"]])
            if x is None and y is None:status="MISSING_XY"
            elif x==0 and y==0:status="ZERO_ZERO"
            elif x is not None and y is not None and x>0 and y>0:status="POSITIVE_PAIR"
            else:status="INVALID_OR_PARTIAL"
            for counter in (overall,by_day[day],by_phase[phase],by_rpt[rpt]):
                counter["rows"]+=1;counter[status]+=1
            if number(row[pos["rsrp"]]) is not None:
                overall["hasRsrp"]+=1
                overall["rsrpAnd_"+status]+=1
            if number(row[pos["nsinr"]]) is not None:overall["hasSinr"]+=1
            if status=="ZERO_ZERO" and str(row[pos["gnss_metric_id"]] or "").strip()=="0.0_0.0":
                overall["zero_pair_marker_0_0"]+=1
    finally:book.close()
    report={"sourceFilename":PATH.name,"sourceRevision":REVISION,
            "rows":dict(overall),
            "byDay":{day:dict(ct) for day,ct in sorted(by_day.items())},
            "byPhaseTop25":{name:dict(ct) for name,ct in sorted(by_phase.items(),key=lambda item:-item[1]["rows"])[:25]},
            "byReportType":{name:dict(ct) for name,ct in sorted(by_rpt.items(),key=lambda item:-item[1]["rows"])[:20]},
            "meaning":"0,0 is missing GNSS placeholder, NOT WGS84 latitude/longitude; positive pairs need CRS verification and accuracy metadata"}
    target=ROOT/"outputs"/"gnss-gap-supplement"/REVISION/"raw-source-audit.json"
    target.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf8")
    print(json.dumps({"rows":report["rows"],"byDay":report["byDay"],"byReportType":report["byReportType"]},ensure_ascii=False,indent=2))
if __name__=="__main__":run()
