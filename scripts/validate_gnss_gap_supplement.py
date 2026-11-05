"""Validate all generated GNSS-gap supplement rows before downstream use.

No external data is written. Fails when any UE coordinate was invented,
future GNSS was used, data is missing or output counts disagree.
"""
from __future__ import annotations
import collections,json,math
from datetime import datetime
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
PUBLIC=ROOT/"public"
manifest=json.loads((PUBLIC/"voice-1030.json").read_text("utf8"))
REV=manifest["meta"]["revision"]
FOLDER=ROOT/"outputs"/"gnss-gap-supplement"/REV
summary=json.loads((FOLDER/"summary.json").read_text("utf8"))
if summary["sourceRevision"]!=REV:raise ValueError("manifest/source revision mismatch")
if summary["sourceGnssFieldsAndMOSUnmodified"] is not True:raise ValueError("nonread-only source")
counts=collections.Counter()
per_day=collections.Counter()
key_set=set()
for day in manifest["meta"]["dates"]:
    with (FOLDER/(day+".jsonl")).open(encoding="utf8") as source:
        for line in source:
            if not line.strip():raise AssertionError("blank evidence record")
            item=json.loads(line)
            counts["rows"]+=1
            per_day[day]+=1
            key=(item["sourceDetailPath"],item["callId"],item["sampleIndex"])
            if key in key_set:raise AssertionError("duplicate sample identity")
            key_set.add(key)
            if item["date"]!=day or item["uePosition"] is not None:
                raise AssertionError("invalid output date or invented UE coordinates")
            if item["calibratedPositionUncertaintyM"] is not None or item["isQualityImpairmentLocation"]:
                raise AssertionError("unvalidated certainty/impairment")
            anchor=item.get("priorGnssReference")
            if anchor:
                counts["prior"]+=1
                if anchor.get("scenarioIsCalibratedConfidenceRegion") is not False:
                    raise AssertionError("scenario disguised as calibrated accuracy")
                if not 0<=anchor["ageSeconds"]<=180:
                    raise AssertionError("GNSS age outside policy")
                stamp=datetime.fromisoformat(item["observationTimestamp"].replace("Z","+00:00"))
                observed=datetime.fromisoformat(anchor["observedAt"].replace("Z","+00:00"))
                if observed>stamp:
                    raise AssertionError("future GNSS used")
            mdt=item.get("mdtCellSiteReference")
            if mdt:
                counts["mdt"]+=1
                if mdt["referenceType"]!="MDT_CELL_SITE_NOT_HANDSET" or mdt["matchedBy"]!="EXACT_UNIQUE_RU_AND_CELL_ID":
                    raise AssertionError("wrong station provenance")
            bye=item.get("cdrEndCellSiteReference")
            if bye:
                counts["bye"]+=1
                if bye["referenceType"]!="CDR_END_CELL_SITE_NOT_HANDSET" or not bye["notCurrentMdtObservation"]:
                    raise AssertionError("BYE tower incorrectly represented")
            if not any((anchor,mdt,bye)):counts["unlocated"]+=1
expected=summary["totals"]
if (counts["rows"]!=expected["missingGnssRows"]
    or counts["prior"]!=expected["hasPriorGnssReferenceWithin180s"]
    or counts["mdt"]!=expected["hasExactUniqueMdtCellSite"]
    or counts["bye"]!=expected["hasUniqueCdrEndCellSite"]
    or counts["unlocated"]!=expected["noLocationReferences"]):
    raise AssertionError("aggregate discrepancy: "+str(counts))
for day in manifest["meta"]["dates"]:
    if per_day[day]!=summary["byDate"][day]["missingGnssRows"]:
        raise AssertionError("date counts mismatch")
print("VALIDATION_OK",json.dumps(dict(counts),ensure_ascii=False),
      "days",dict(per_day),"sourceRevision",REV)
