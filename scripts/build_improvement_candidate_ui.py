"""Publish source-traceable improvement *investigation* candidates.

5-day fixed historical discovery: train 2026-10-26..29, verify only on
2026-10-30 previously unseen customers. Location is GNSS-associated call
representative, never RTP impairment onset; cell-only inventory location is
a tower, not a handset. No custom model confidence is fabricated.
"""
from __future__ import annotations
from collections import Counter,defaultdict
from pathlib import Path
import json, math, statistics, os, sys

import numpy as np
from sklearn.cluster import DBSCAN
from sklearn.metrics.pairwise import haversine_distances

ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/"scripts"))
from lte_station_catalog import load_unique_bye_cells
PUBLIC=ROOT/"public"
R=6371008.8
DATES=["2026-10-26","2026-10-27","2026-10-28","2026-10-29","2026-10-30"]
TRAIN_DATES=set(DATES[:-1])
TEST_DATE=DATES[-1]
CANDIDATE_CELLS=["3470091","788228"]
SPATIAL_RADIUS_M=100

def sip_reason_group(reason):
    """Original SIP CDR 11. REASON; mixed H-coded reasons count as Drop."""
    import re
    value=(reason or "").strip()
    if re.search(r"(?:^|[\^\s\/;,])H\s*(?::\s*Drop\b|(?=\^|$))",value,re.I) or re.search(
            r"(?:^|[\s:;/])Drop\b",value,re.I):
        return "drop"
    if re.fullmatch(r"A\s*:\s*Normal",value,re.I):
        return "normal"
    return "other"

def distance(a,b):
    return float(haversine_distances(np.radians([[a["lat"],a["lon"]]]),
             np.radians([[b["lat"],b["lon"]]])).item()*R)

def main():
    manifest=json.loads((PUBLIC/"voice-1030.json").read_text("utf8"))
    report=json.loads((ROOT/"outputs/improvement-point-screening-20261104.json").read_text("utf8"))
    revision=manifest["meta"]["revision"]
    assert revision=="557c39d2c6a9a5b4c69b"
    assert report["source_counts"]=={"allCdr":184232,"unscored":53292,"scored":130940,"poor":1403}
    assert report["gnssNewCustomerDateHoldout"]["100"]["testTwoNewCustomers"]==3
    assert set(report["holdoutTrainFirst4DaysTestLastDay"]["2"]["newCustomerValidationCells"])==set(CANDIDATE_CELLS)

    gnss=[]
    by_cell=defaultdict(list)
    all_calls={}
    for date in DATES:
        source=json.loads((PUBLIC/"analyst-overview"/"MDT"/(date+".json")).read_text("utf8"))
        if source["sourceRevision"]!=revision:raise RuntimeError("Overview revision mismatch")
        calls={c["id"]:c for c in source["calls"]}
        for call in source["calls"]:
            all_calls[call["id"]]=(date,call)
            if call.get("endCellId") in CANDIDATE_CELLS and isinstance(call.get("mos"),(float,int)) and 1<=call["mos"]<=5:
                by_cell[call["endCellId"]].append((date,call))
        for pos in source["callLocations"]:
            if pos["evidence"]!="gnss":continue
            call=calls.get(pos["callId"])
            if call is None or not isinstance(call.get("mos"),(float,int)) or not 1<=call["mos"]<=5:
                continue
            gnss.append({"date":date,"customer":call["customerId"],"callId":call["id"],
                "lat":pos["lat"],"lon":pos["lon"],
                "poor":call["mos"]<3,"mos":call["mos"],"sipReason":call.get("sipCause"),
                "endCell":str(call.get("endCellId") or ""),
                "start":call["start"],"startTimestamp":call.get("startTimestamp"),
                "positionQuality":pos.get("positionQuality"),
                "locationObservedAt":pos.get("observedAt"),"referenceAgeSec":pos.get("gnssReferenceAgeSec")})
    all_gnss_poor=[c for c in gnss if c["poor"]]
    train=[c for c in all_gnss_poor if c["date"] in TRAIN_DATES]
    test=[c for c in all_gnss_poor if c["date"]==TEST_DATE]
    normal_gnss=[c for c in gnss if not c["poor"]]
    coords=np.radians([[c["lat"],c["lon"]] for c in train])
    labels=DBSCAN(eps=SPATIAL_RADIUS_M/R,metric="haversine",min_samples=2).fit_predict(coords)
    groups=defaultdict(list)
    for idx,label in enumerate(labels):
        if label>=0:groups[int(label)].append(idx)

    def ref(c):
        return {"date":c["date"],"customerId":c["customer"],"callId":c["callId"],
            "mos":round(float(c["mos"]),3),"endCellId":c["endCell"],"start":c["start"]}
    sites,audit=load_unique_bye_cells(
        ROOT/"data"/"BaseStation"/"수도권_LTE_261103.xlsx",CANDIDATE_CELLS
    )
    candidates=[]
    for ids in groups.values():
        samples=[train[i] for i in ids]
        train_clients={p["customer"] for p in samples}
        train_dates={p["date"] for p in samples}
        if len(train_clients)<3 or len(train_dates)<2:continue
        all_pos=coords[ids]
        holdout=[p for p in test if p["customer"] not in train_clients and
                 (haversine_distances(np.radians([[p["lat"],p["lon"]]]),all_pos).min()*R)<=SPATIAL_RADIUS_M]
        novel={p["customer"] for p in holdout}
        if len(novel)<2:continue
        dist=haversine_distances(all_pos)*R
        center_index=int(np.argmin(np.max(dist,axis=1)))
        medoid=samples[center_index]
        radius=int(math.ceil(max(100,float(dist[center_index].max())+20)/10)*10)
        near_normal=[p for p in normal_gnss
                     if (haversine_distances(np.radians([[p["lat"],p["lon"]]]),all_pos).min()*R)<=SPATIAL_RADIUS_M]
        member_calls=samples+holdout
        cells=Counter(p["endCell"] for p in member_calls if p["endCell"])
        representative=sorted(holdout,key=lambda x:(x["date"],x["customer"]))[:2]
        representative += sorted(samples,key=lambda x:(x["date"],x["customer"]),reverse=True)[:2]
        candidates.append({
          "id":"spatial-"+str(len(candidates)+1),"kind":"spatial",
          "label":"MOS 저하고객 중복 위치 "+chr(65+len(candidates)),
          "location":{"lat":round(medoid["lat"],7),"lon":round(medoid["lon"],7),
            "radiusM":radius,"source":"TRAINING_GNSS_CLUSTER_MEDOID",
            "meaning":"반복 저MOS 통화에 연결된 실제 GNSS 관측들의 대표점; 품질이 나빠진 시점 좌표가 아님"},
          "discovery":{"distinctPoorCustomers":len(train_clients),"poorCalls":len(samples),
            "dropCalls":sum(sip_reason_group(p["sipReason"])=="drop" for p in samples),
            "days":len(train_dates),"trainStart":DATES[0],"trainEnd":DATES[-2]},
          "_relatedCallKeys":[(p["date"],p["customer"],p["callId"]) for p in member_calls],
          "_uniquePoorCustomerIds":list({p["customer"] for p in member_calls}),
          "validation":{"newPoorCustomers":len(novel),"newPoorCalls":len(holdout),"date":TEST_DATE,
            "definition":"탐색 군집에서 사용하지 않은 고객의 저MOS GNSS 연관 위치를 100m 이내에서 재확인"},
          "normalReference":{"nearbyCalls":len(near_normal),
            "distinctCustomers":len({p["customer"] for p in near_normal}),
            "caution":"GNSS 연계 모집단의 정상 표본으로, 통화 전체의 지역 불량률 분모가 아님"},
          "relatedEndCells":[{"id":cell,"poorCalls":n} for cell,n in cells.most_common(6)],
          "representativeCalls":[ref(p) for p in representative],
          "evidence":"GNSS_CDR_ASSOCIATION","verification":"INDEPENDENT_NEXT_DAY_CUSTOMER_REPEAT",
          "hypotheses":["약전계·간섭·HO 등 무선 원인 후보(원인 미확정)",
            "전송망·코어망·단말 및 MOS 산출 영향도 배제되지 않음"],
          "fieldChecks":["후보 조사 권역 및 인접 정상 구역에서 왕복 VoLTE 품질 측정",
            "Serving/Neighbor RSRP·RSRQ·SINR 및 HO 이벤트 시간 동기화",
            "관련 셀별 기지국 PM(PRB·BLER·HO 실패)과 RTP/RTCP 손실 기록 확보"],
        })
    if len(candidates)!=3:raise RuntimeError("Expected three independent-customer GNSS cluster leads")
    # Sort for stable candidate names, then assign IDs; map coordinates never use verification truth.
    candidates.sort(key=lambda item:(item["location"]["lat"],item["location"]["lon"]))
    for idx,c in enumerate(candidates):
        c["id"]="spatial-"+str(idx+1)
        c["label"]="MOS 저하고객 중복 위치 "+chr(65+idx)

    key_to_report={c["cellId"]:c for c in report["topAtLeastDoubleRateEndCells"]}
    for cellid in CANDIDATE_CELLS:
        raw=key_to_report[cellid]
        events=by_cell[cellid]
        train_all={c["customerId"] for d,c in events if d in TRAIN_DATES}
        new_test_poor={c["customerId"] for d,c in events if d==TEST_DATE and c["mos"]<3}-train_all
        if len(new_test_poor)<2:raise RuntimeError("new-customer reproducibility condition failed")
        good=[(d,c) for d,c in events if c["mos"]>=3]
        poor=[(d,c) for d,c in events if c["mos"]<3]
        validation=[(d,c) for d,c in poor if d==TEST_DATE and c["customerId"] in new_test_poor]
        representatives=(validation[:3]+[(d,c) for d,c in poor if d!=TEST_DATE][:2])
        def cellref(d,c):
            return {"date":d,"customerId":c["customerId"],"callId":c["id"],
              "mos":round(float(c["mos"]),3),"endCellId":cellid,"start":c["start"]}
        tower=sites.get(cellid)
        candidates.append({
          "id":"cell-"+cellid,"kind":"cell",
          "label":"종료 Cell "+cellid,
          "location":({"lat":tower["lat"],"lon":tower["lon"],"radiusM":None,
            "source":"UNIQUE_INVENTORY_CELL_RU_SITE",
            "ruId":tower["ruId"],"meaning":"인벤토리의 기지국 참고 좌표로서 실제 단말 불량 위치가 아님"}
            if tower else None),
          "locationUnknownReason":None if tower else
            "CDR 종료 Cell ID 단독으로 인벤토리의 RU·좌표를 유일하게 결정할 수 없음. 지도에는 표시하지 않음",
          "discovery":{"distinctPoorCustomers":len({c["customerId"] for _,c in poor}),
            "poorCalls":len(poor),
            "dropCalls":sum(sip_reason_group(c.get("sipCause"))=="drop" for _,c in poor),
            "days":len({d for d,_ in poor}),"scoredCalls":len(events),
            "normalCalls":len(good),"observedPoorAmongScoredPct":round(100*len(poor)/len(events),2),
            "ratioToOverallObserved":round(raw["relativeToAllScoredRate"],2)},
          "_relatedCallKeys":[(d,c["customerId"],c["id"]) for d,c in poor],
          "_uniquePoorCustomerIds":list({c["customerId"] for _,c in poor}),
          "validation":{"newPoorCustomers":len(new_test_poor),
            "newPoorCalls":len(validation),"date":TEST_DATE,
            "definition":"26~29일 동일 셀의 유효 MOS 통화에 없던 신규 고객 2명 이상이 30일에도 해당 종료 Cell과 저MOS로 관측"},
          "normalReference":{"nearbyCalls":None,"distinctCustomers":None,
            "caution":"전체 CDR 중 동일 종료 Cell의 MOS >=3 통화 수는 제공되지만 위치가 같다고 볼 수 없음"},
          "relatedEndCells":[{"id":cellid,"poorCalls":len(poor)}],
          "representativeCalls":[cellref(d,c) for d,c in representatives],
          "evidence":"SIP_CDR_END_CELL_REPEAT",
          "verification":"INDEPENDENT_NEXT_DAY_CUSTOMER_REPEAT",
          "clientFdrQ":raw["customerBasedFdrQ"],
          "hypotheses":["셀 자체의 커버리지·간섭·HO·부하 또는 공통 전송 경로 문제 가능성",
            "실제 RTP 품질 저하 시각 및 위치가 없어 종료 Cell이 원인이라고 확정 불가"],
          "fieldChecks":["해당 셀/RU가 실제로 서비스한 통화 구간 확인(RRC/Serving Cell 타임라인)",
            "같은 시간대 정상 통화와 SINR·RSRQ·RSRP·HO·PRB·BLER 비교",
            "송수신 RTP/RTCP 손실·지터와 코어·전송망 구간 분리 측정"],
        })
    assert len(candidates)==5

    spatial=[c for c in candidates if c["kind"]=="spatial"]
    for i,a in enumerate(spatial):
        for b in spatial[i+1:]:
            if distance(a["location"],b["location"])<=500:
                a.setdefault("nearbyCandidateIds",[]).append(b["id"])
                b.setdefault("nearbyCandidateIds",[]).append(a["id"])

    # Raw GNSS locations for ALL associated low-MOS calls, not just map medoids.
    # Origin and time are preserved. Never substitute a BTS for missing UE GNSS.
    entries={(d["date"],d["customerId"]):d for d in manifest["days"] if d.get("sampleCount")}
    partition_cache={}
    all_unique_clients=set()
    for candidate in candidates:
        related_refs=set(tuple(k) for k in candidate.pop("_relatedCallKeys"))
        all_unique_clients.update(candidate.pop("_uniquePoorCustomerIds"))
        points=[]
        dedup=set()
        candidate["relatedGnss"]=[]
        for date,customer,callId in sorted(related_refs):
            entry=entries.get((date,customer))
            if entry is None:continue
            if (date,customer) not in partition_cache:
                partition_cache[(date,customer)]=json.loads((PUBLIC/entry["dataPath"]).read_text("utf8"))
            detail=partition_cache[(date,customer)]
            short=callId[len(customer)+1:]
            for row in detail["samples"]:
                if str(row[19])!=short or not isinstance(row[2],(float,int)) or not isinstance(row[3],(float,int)):
                    continue
                meta=row[21] if isinstance(row[21],dict) else {}
                if meta.get("locationSource")!="gnss" or meta.get("gnssCrs")!="EPSG:5179":
                    continue
                lat,lon=float(row[2]),float(row[3])
                if not (math.isfinite(lat) and math.isfinite(lon) and 33<=lat<=39.8 and 124<=lon<=132):
                    continue
                observed=meta.get("timestamp")
                ident=(date,customer,short,observed,round(lat,7),round(lon,7))
                if ident in dedup:continue
                dedup.add(ident)
                points.append({"date":date,"callId":callId,"customerId":customer,
                  "lat":round(lat,7),"lon":round(lon,7),"observedAt":observed,
                  "phase":meta.get("phase") or None,
                  "source":"RAW_MDT_GNSS","validationDay":date==TEST_DATE})
        candidate["relatedGnss"]=sorted(points,key=lambda x:(x["date"],x["observedAt"] or "",x["callId"]))
        candidate["relatedGnssCallCount"]=len({p["callId"] for p in points})
        values={"rsrp":[],"rsrq":[],"sinr":[]}
        matched=0
        for refentry in candidate["representativeCalls"]:
            entry=entries.get((refentry["date"],refentry["customerId"]))
            if not entry:continue
            detail=partition_cache.get((refentry["date"],refentry["customerId"]))
            if detail is None:
                detail=json.loads((PUBLIC/entry["dataPath"]).read_text("utf8"))
                partition_cache[(refentry["date"],refentry["customerId"])]=detail
            short_id=refentry["callId"].split(":",1)[1]
            call=next((c for c in detail["calls"] if c["id"]==short_id and c.get("matchStatus")=="MATCHED"),None)
            if not call:continue
            matched+=1
            for k in values:
                v=call.get(k)
                if isinstance(v,(float,int)) and math.isfinite(v):values[k].append(float(v))
        candidate["radioReference"]={
            "linkedCdrMdtRepresentativeCalls":matched,
            "rsrpMedianDbm":round(statistics.median(values["rsrp"]),1) if values["rsrp"] else None,
            "rsrqMedianDb":round(statistics.median(values["rsrq"]),1) if values["rsrq"] else None,
            "sinrMedianDb":round(statistics.median(values["sinr"]),1) if values["sinr"] else None,
            "warning":"대표 통화에서 확보된 MDT 연계 참고값; 시간 동기화된 MOS 저하 구간의 무선 원인 근거가 아님",
        }

    output={
      "schemaVersion":"qoe-improvement-candidates-v1","sourceRevision":revision,
      "analysisDates":DATES,"trainingDates":DATES[:-1],"verificationDate":TEST_DATE,
      "analysisWindowNote":"선택한 1~3일 품질 현황 필터와 독립적인 5일 원본 고정 분석",
      "sourceBasis":"SIP CDR MOS(v5), GNSS representative MDT locations, LTE RU/Cell inventory; no packet-level impairment onset",
      "algorithm":"100m DBSCAN train 4 days + held-out-new-customer GNSS repeat; independently recurring CDR END Cell",
      "summary":{"cdrCalls":184232,"mosScored":130940,"poorCalls":1403,
        "candidateCount":5,"spatialCandidateCount":3,"cellCandidateCount":2,
        "distinctAffectedCustomers":len(all_unique_clients),
        "mappedCandidates":sum(c.get("location") is not None for c in candidates),
        "independentlyConfirmedRootCauses":0},
      "limitations":[
        "모든 통화의 실제 MOS 저하 시점을 알고 있지 않으므로 GNSS 군집은 저품질 통화 연관 위치이지 저하 시작 위치가 아닙니다.",
        "5일간 선별된 GNSS 표본이므로 인구 전체의 지역 불량률과 통계적 원인 인과관계를 나타내지 않습니다.",
        "고객 단위 다중 비교 검정 통과 Cell은 0개이므로 2개 Cell은 재현된 조사 후보이지 유의한 이상 Cell로 확정된 것은 아닙니다.",
        "3개 GNSS 군집 중 일부는 가까워 동일 현장 조사 구역으로 중복될 수 있습니다.",
        "이 지도에 표시된 기지국 위치는 실제 단말 위치가 아닙니다.",
      ],
      "candidates":candidates,
    }
    dest=PUBLIC/"improvement-candidates"/"2026-10-26_2026-10-30.json"
    dest.parent.mkdir(parents=True,exist_ok=True)
    temp=dest.with_suffix(".json.tmp")
    temp.write_text(json.dumps(output,ensure_ascii=False,separators=(",",":")),encoding="utf8")
    os.replace(temp,dest)
    print(json.dumps({
       "path":str(dest),"summary":output["summary"],
       "detail":[{"id":c["id"],"location":c["location"],"discovery":c["discovery"],
         "validation":c["validation"],"radio":c["radioReference"],
         "examples":len(c["representativeCalls"])} for c in candidates],
    },ensure_ascii=False,indent=2))

if __name__=="__main__":
 main()
