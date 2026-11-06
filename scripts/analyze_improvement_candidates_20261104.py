"""Screen *existing* QoE source-derived CDR/MDT/GNSS for repeat poor-QoE improvement leads.

Does not edit original workbooks or the dashboard. Does not disclose customer IDs
or individual GNSS fixes. FDR and holdout diagnostics are exploratory only.

Source lineage:
  raw Excel -> project voice-1030.json/analyst-overview JSON (audit matched)
  source station inventory workbook -> strict unique cell site check
  published MDT partitions -> explicit same-call RU+Cell associations
"""
from __future__ import annotations
from collections import Counter, defaultdict
from pathlib import Path
import json
import math
import argparse
import os
import sys

import numpy as np
from scipy.stats import binomtest
from sklearn.cluster import DBSCAN
from sklearn.metrics.pairwise import haversine_distances

ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/"scripts"))
from lte_station_catalog import resolve_lte_master
from bye_station_catalog import load_bye_catalog, resolve_bye_site, resolve_manifest_nr_catalog
from inventory_provenance import verify_inventory_provenance

DATES=("2026-10-26","2026-10-27","2026-10-28","2026-10-29","2026-10-30")
R=6371008.8
SRC=Path(os.environ.get('QOE_PUBLIC_DIR',str(ROOT/"public")))

def newcell():
    return {"scored":0,"poor":0,"customers":defaultdict(list),
            "poor_days":set(),"poor_customers":set(),
            "train_n":0,"train_p":0,"train_poor_clients":set(),"train_all_clients":set(),"train_days":set(),
            "test_n":0,"test_p":0,"test_poor_clients":set()}

def bh_rows(records):
    sorted_items=sorted(records,key=lambda z:z[1])
    m=len(sorted_items)
    result={}
    best=1.
    for idx in range(m-1,-1,-1):
        key,p=sorted_items[idx]
        best=min(best,p*m/(idx+1))
        result[key]=float(best)
    return result

def geo_groups(geo,rad):
    poor=[x for x in geo if x["poor"]]
    normal=[x for x in geo if not x["poor"]]
    if len(poor)<2:return []
    positions=np.radians([(x["lat"],x["lon"]) for x in poor])
    labels=DBSCAN(eps=rad/R,metric="haversine",min_samples=2).fit_predict(positions)
    by=defaultdict(list)
    for i,label in enumerate(labels):
        if label>=0:by[int(label)].append(i)
    others=np.radians([(x["lat"],x["lon"]) for x in normal]) if normal else np.zeros((0,2))
    rows=[]
    for ids in by.values():
        members=[poor[i] for i in ids]
        independent={x["customer"] for x in members}
        dates={x["date"] for x in members}
        if len(independent)<3 or len(dates)<2:continue
        nrows=[]
        if len(others):
            nearest=haversine_distances(others,positions[ids]).min(axis=1)*R
            nrows=[normal[i] for i in np.where(nearest<=rad)[0]]
        cells=Counter(x["cell"] for x in members)
        rows.append({
            "poorCalls":len(ids),
            "uniquePoorCustomers":len(independent),
            "days":len(dates),
            "normalCallsNearby":len(nrows),
            "uniqueNormalCustomersNearby":len({x["customer"] for x in nrows}),
            "poorEndCells":dict(cells.most_common(5)),
        })
    return sorted(rows,key=lambda x:(-x["uniquePoorCustomers"],-x["days"]))



def spatial_holdout(geo,rad):
    train=[x for x in geo if x["poor"] and x["date"]<"2026-10-30"]
    test=[x for x in geo if x["poor"] and x["date"]=="2026-10-30"]
    if len(train)<2:return {"trainingClusters":0,"testOneNewCustomer":0,"testTwoNewCustomers":0}
    a=np.radians([(p["lat"],p["lon"]) for p in train])
    labels=DBSCAN(eps=rad/R,metric="haversine",min_samples=2).fit_predict(a)
    groups=defaultdict(list)
    for i,label in enumerate(labels):
        if label>=0:groups[int(label)].append(i)
    selected=[indices for indices in groups.values()
        if len({train[i]["customer"] for i in indices})>=3
        and len({train[i]["date"] for i in indices})>=2]
    result=[]
    for indices in selected:
        known={train[i]["customer"] for i in indices}
        pos=a[indices]
        new=set()
        for fix in test:
            if fix["customer"] in known:continue
            if haversine_distances(np.radians([[fix["lat"],fix["lon"]]]),pos).min()*R<=rad:
                new.add(fix["customer"])
        result.append(len(new))
    return {"trainingClusters":len(selected),
       "testOneNewCustomer":sum(n>=1 for n in result),
       "testTwoNewCustomers":sum(n>=2 for n in result)}

def radio_ru_screening(manifest,public_dir,inventory):
    """Matched CDR/MDT; one vote per CALL per exact RU+Cell, not per MDT row."""
    stats=Counter()
    pairs=defaultdict(lambda:{"scored":0,"poor":0,"poor_customers":set(),"dates":set()})
    for entry in manifest["days"]:
        if not entry.get("sampleCount"):continue
        detail=json.loads((public_dir/entry["dataPath"]).read_text("utf8"))
        if detail.get('customerId')!=entry['customerId'] or detail.get('date')!=entry['date']:
            raise RuntimeError('MDT partition identity mismatch')
        by_call=defaultdict(set)
        for row in detail["samples"]:
            md=row[21] or {}
            if md.get("baseStationMatched") is not True or md.get("masterInventorySource")!=inventory:
                continue
            site=str(md.get("baseStationId") or "").strip()
            cell=str(md.get("cellId") or "").strip()
            if site and cell:by_call[row[19]].add((site,cell))
        for call in detail["calls"]:
            if call.get("matchStatus")!="MATCHED":continue
            mos=call.get("mos")
            if not isinstance(mos,(int,float)) or not 1<=mos<=5:continue
            stats["matchedScored"]+=1
            ispoor=mos<3
            stats["matchedPoor"]+=int(ispoor)
            if not by_call.get(call["id"]):continue
            stats["matchedScoredWithExactRu"]+=1
            stats["matchedPoorWithExactRu"]+=int(ispoor)
            for key in by_call[call["id"]]:
                item=pairs[key]
                item["scored"]+=1
                item["poor"]+=int(ispoor)
                if ispoor:
                    item["poor_customers"].add(entry["customerId"])
                    item["dates"].add(entry["date"])
    selected=[(key,item) for key,item in pairs.items()
      if item["scored"]>=20 and len(item["poor_customers"])>=3 and len(item["dates"])>=2]
    top=sorted(selected,key=lambda z:-len(z[1]["poor_customers"]))[:10]
    return {
      "scope":"CDR calls uniquely linked to MDT; exact RU+Cell observed, one call counted once per observed pair",
      "sampleTotals":dict(stats),
      "observedRuCellPairs":len(pairs),
      "recurringWith20Scored3DistinctPoorCustomers2Days":len(selected),
      "topExploratoryRuCells":[{
          "ru":key[0],"cell":key[1],"scoredCallAssociations":v["scored"],
          "poorCallAssociations":v["poor"],
          "uniquePoorCustomers":len(v["poor_customers"]),
          "days":len(v["dates"]),
      } for key,v in top],
      "warning":"MDT-linked scored calls are strongly enriched for MOS-poor calls; their rates must not be extrapolated to all users",
    }


def build(public_dir=SRC,lte_master=None,out=None):
    public_dir=Path(public_dir).resolve()
    inventory=resolve_lte_master(lte_master)
    manifest=json.loads((public_dir/"voice-1030.json").read_text("utf8"))
    verify_inventory_provenance(manifest,inventory,'improvement screening')
    revision=manifest['meta']['revision']
    if not set(DATES).issubset(manifest['meta']['dates']):
        raise RuntimeError('The fixed five-day screening cohort is missing from the manifest')
    cells=defaultdict(newcell)
    geo=[]
    stats=Counter()
    hours_all=Counter()
    hours_poor=Counter()
    for date in DATES:
        obj=json.loads((public_dir/"analyst-overview"/"MDT"/(date+".json")).read_text("utf8"))
        if obj.get('sourceRevision')!=revision or obj.get('date')!=date or obj.get('source')!='MDT':
            raise RuntimeError('Overview source/date/revision mismatch')
        all_calls={call["id"]:call for call in obj["calls"]}
        for c in obj["calls"]:
            stats["allCdr"]+=1
            mos=c.get("mos")
            if not isinstance(mos,(int,float)) or not math.isfinite(mos) or not 1<=mos<=5:
                stats["unscored"]+=1
                continue
            stats["scored"]+=1
            poor=mos<3
            if poor:stats["poor"]+=1
            cell=str(c.get("endCellId") or "")
            if not cell:continue
            v=cells[cell]
            v["scored"]+=1
            v["poor"]+=int(poor)
            customer=c["customerId"]
            v["customers"][customer].append(bool(poor))
            if poor:
                v["poor_days"].add(date)
                v["poor_customers"].add(customer)
            if date<"2026-10-30":
                v["train_all_clients"].add(customer)
                v["train_n"]+=1
                v["train_p"]+=int(poor)
                if poor:v["train_poor_clients"].add(customer);v["train_days"].add(date)
            else:
                v["test_n"]+=1
                v["test_p"]+=int(poor)
                if poor:v["test_poor_clients"].add(customer)
            hour=c.get("startTimestamp","")[11:13]
            hours_all[hour]+=1
            if poor:hours_poor[hour]+=1
        for loc in obj.get("callLocations",[]):
            if loc.get("evidence")!="gnss":continue
            call=all_calls.get(loc["callId"])
            if not call or not isinstance(call.get("mos"),(float,int)) or not 1<=call["mos"]<=5:
                continue
            geo.append({
                "lat":loc["lat"],"lon":loc["lon"],
                "customer":call["customerId"],"date":date,
                "poor":call["mos"]<3,"cell":str(call.get("endCellId") or ""),
            })

    if (stats["allCdr"],stats["scored"],stats["poor"])!=(184232,130940,1403):
        raise AssertionError("source call totals mismatch; do not publish")
    baseline=stats["poor"]/stats["scored"]
    cell_scores=[]
    unique_customer_denominator=0
    unique_customer_poor=0
    for c in cells.values():
        unique_customer_denominator+=len(c["customers"])
        unique_customer_poor+=sum(any(v) for v in c["customers"].values())
    cust_baseline=unique_customer_poor/unique_customer_denominator
    row_pvals=[]
    client_pvals=[]
    for k,v in cells.items():
        if v["scored"]>=20:
            row_pvals.append((k,binomtest(v["poor"],v["scored"],baseline,alternative="greater").pvalue))
        cust_n=len(v["customers"])
        if cust_n>=20:
            cust_poor=sum(any(x) for x in v["customers"].values())
            client_pvals.append((k,binomtest(cust_poor,cust_n,cust_baseline,alternative="greater").pvalue))
    row_q=bh_rows(row_pvals)
    client_q=bh_rows(client_pvals)
    eligible={}
    for ratio in (1.5,2,3):
        selected=[
          k for k,v in cells.items()
          if v["scored"]>=30 and len(v["poor_customers"])>=3 and len(v["poor_days"])>=2
          and (v["poor"]/v["scored"])>=ratio*baseline
        ]
        eligible[str(ratio)]={
          "cells":len(selected),
          "callLevelFdrUnder005":sum(row_q.get(k,1)<.05 for k in selected),
          "customerLevelFdrUnder005":sum(client_q.get(k,1)<.05 for k in selected),
        }
    dev_base=sum(v["train_p"] for v in cells.values())/sum(v["train_n"] for v in cells.values())
    test_base=sum(v["test_p"] for v in cells.values())/sum(v["test_n"] for v in cells.values())
    holdouts={}
    for ratio in (1.5,2):
        development=[
            (k,v) for k,v in cells.items()
            if v["train_n"]>=25 and v["train_p"]>=3 and len(v["train_poor_clients"])>=3
            and len(v["train_days"])>=2 and v["train_p"]/v["train_n"]>=ratio*dev_base
        ]
        repeated=[(k,v) for k,v in development if v["test_n"]>=10 and v["test_p"]>=1]
        stricter=[(k,v) for k,v in repeated
                  if v["test_p"]>=2 and len(v["test_poor_clients"])>=2
                  and v["test_p"]/v["test_n"]>test_base]
        new_customer_test=[(k,v) for k,v in stricter
            if len(v["test_poor_clients"]-v["train_all_clients"])>=2]
        holdouts[str(ratio)]={
            "test2PoorClientsUnseenInDevelopment":len(new_customer_test),
            "newCustomerValidationCells":[k for k,v in new_customer_test],
            "developmentCandidates":len(development),
            "testAtLeastOnePoor":len(repeated),
            "testAtLeastTwoDistinctPoorCustomersAndAboveBaseline":len(stricter),
            "verifiedCells":[k for k,v in stricter],
        }
    nr_inventory=resolve_manifest_nr_catalog(manifest,inventory)
    bye_catalog,inventory_audit=load_bye_catalog(inventory,nr_inventory,set(cells))
    radio_sites={cell:site for cell in cells
                 if (site:=resolve_bye_site(bye_catalog,cell)) is not None}
    for ratio,info in eligible.items():
        selected=[k for k,v in cells.items() if v["scored"]>=30 and
          len(v["poor_customers"])>=3 and len(v["poor_days"])>=2 and
          v["poor"]/v["scored"]>=float(ratio)*baseline]
        info["exactUniqueCellToRuInventory"]=sum(k in radio_sites for k in selected)
    top=[]
    for k,v in cells.items():
        if not (v["scored"]>=30 and len(v["poor_customers"])>=3 and len(v["poor_days"])>=2 and
           v["poor"]/v["scored"]>=2*baseline):continue
        site=radio_sites.get(k)
        top.append({
          "cellId":k,"scoredCalls":v["scored"],"poorCalls":v["poor"],
          "poorRatePct":round(100*v["poor"]/v["scored"],2),
          "relativeToAllScoredRate":round(v["poor"]/v["scored"]/baseline,2),
          "distinctPoorCustomers":len(v["poor_customers"]),
          "distinctPoorDates":len(v["poor_days"]),
          "customerBasedFdrQ":round(client_q.get(k,1),5),
          "callBasedFdrQ":round(row_q.get(k,1),5),
          "validationDateScoredCalls":v["test_n"],
          "validationDatePoorCalls":v["test_p"],
          "validationDateUniquePoorCustomers":len(v["test_poor_clients"]),
          "exactSingleRuInventory":site["ruId"] if site else None,
        })
    top.sort(key=lambda x:(x["customerBasedFdrQ"],-x["distinctPoorCustomers"]))

    geo_by={}
    for radius in (50,100,200,300,500):
        groups=geo_groups(geo,radius)
        geo_by[str(radius)]={
          "clusters3DistinctPoorCustomers2Days":len(groups),
          "clusters5DistinctPoorCustomers2Days":sum(g["uniquePoorCustomers"]>=5 for g in groups),
          "clustersWith3OrMoreNormalCustomersNearby":sum(g["uniqueNormalCustomersNearby"]>=3 for g in groups),
          "top":groups[:10] if radius==100 else [],
        }
    rough=[]
    rough_combo=defaultdict(list)
    for date in DATES:
        obj=json.loads((public_dir/"three-site-rough"/(date+".json")).read_text("utf8"))
        if obj.get('sourceRevision')!=revision or obj.get('date')!=date:
            raise RuntimeError('Three-site source/date/revision mismatch')
        if obj.get('sourceInventory')!=inventory.name:
            raise RuntimeError('Three-site inventory mismatch')
        for point in obj["points"]:
            if not isinstance(point.get("mos"),(int,float)) or not 1<=point["mos"]<3:
                continue
            customer=point["callId"].split(":")[0]
            rough.append((date,customer,point))
            key=tuple(sorted(s["ruId"]+":"+s["cellId"] for s in point["usedStations"]))
            rough_combo[key].append((date,customer))
    repeated_combos=[
       v for v in rough_combo.values()
       if len({cust for date,cust in v})>=3 and len({date for date,cust in v})>=2
    ]
    report={
       "purpose":"Exploratory distinct-customer poor-VoLTE improvement-point screening; no confirmed root causes",
       "sourceRevision":revision,
       "sourceInventory":inventory.name,
       "sourceCdr":"original source Excel -> project analyst-overview per-day CDR source-revision "+revision,
       "dates":DATES,
       "source_counts":dict(stats),
       "overallPoorAmongValidMosPct":round(100*baseline,3),
       "scoredEndCells":len(cells),
       "cellsWithAnyPoor":sum(v["poor"]>0 for v in cells.values()),
       "repeatByPoorCustomers":{
         "min3Clients":sum(len(v["poor_customers"])>=3 for v in cells.values()),
         "min3ClientsAnd2Days":sum(len(v["poor_customers"])>=3 and len(v["poor_days"])>=2 for v in cells.values()),
       },
       "repeatWithRateFilters":eligible,
       "cellRateCallBasedFdrUnder005":sum(q<.05 for q in row_q.values()),
       "cellRateDistinctCustomerFdrUnder005":sum(q<.05 for q in client_q.values()),
       "sourceInventoryMappingAudit":inventory_audit,
       "distinctCustomerCellBaseline":{
         "uniqueCustomerCellPairs":unique_customer_denominator,
         "customerCellPairsWithAnyPoor":unique_customer_poor,
         "poorCustomerCellPct":round(100*cust_baseline,3),
         "note":"An ANY-poor per customer-cell unit is a screening outcome, not an unbiased subscriber risk estimate",
       },
       "holdoutTrainFirst4DaysTestLastDay":holdouts,
       "topAtLeastDoubleRateEndCells":top[:18],
       "gnssLinkedScoredCalls":len(geo),
       "gnssLinkedPoorCalls":sum(x["poor"] for x in geo),
       "gnssDistinctPoorCustomers":len({x["customer"] for x in geo if x["poor"]}),
       "gnssDbscanRadiusResults":geo_by,
       "gnssNewCustomerDateHoldout":{str(rad):spatial_holdout(geo,rad) for rad in (50,100,200)},
       "threeSiteApproximatePoorCalls":len(rough),
       "threeSiteExactThreeRadioSiteCombosWith3PoorCustomers2Days":len(repeated_combos),
       "mdtMatchedRuCellContext":radio_ru_screening(manifest,public_dir,inventory.name),
       "warnings":[
          "5-day single selected sampling frame, no true RTP/RTCP impairment onset",
          "GNSS linked MOS-poor calls are highly selected; cluster outputs are candidates not an area poor-call rate",
          "Each GNSS point is a source-derived call representative, not independently surveyed impairment location",
          "DBSCAN 300m+ chains most poor GNSS points into one area, showing radius instability",
          "Cell-only identity may refer to multiple RUs; do not assign unique site without inventory evidence",
          "Call-level binomial FDR independence assumption is violated by repeated customers; customer-unit FDR is primary",
          "Same sites underlying 3-site approximations can produce repeated centroid coordinates without independent GNSS verification",
          "Test date for holdout is only one day; exploratory not a causal validation",
       ],
    }
    default_output_root=ROOT if public_dir==(ROOT/'public').resolve() else public_dir.parent
    out=Path(out) if out is not None else default_output_root/"outputs/improvement-point-screening-20261104.json"
    out.parent.mkdir(parents=True,exist_ok=True)
    temporary=out.with_suffix(out.suffix+'.tmp')
    temporary.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf8")
    os.replace(temporary,out)
    print("REPORT",out)
    print(json.dumps({
      "source_counts":report["source_counts"],
      "repeat":report["repeatByPoorCustomers"],
      "rate_filters":eligible,
      "FDR_call":report["cellRateCallBasedFdrUnder005"],
      "FDR_customer":report["cellRateDistinctCustomerFdrUnder005"],
      "holdout":holdouts,
      "gnss":report["gnssDbscanRadiusResults"],
      "rough":report["threeSiteExactThreeRadioSiteCombosWith3PoorCustomers2Days"],
      "top":top[:10],
    },ensure_ascii=False,indent=2))

if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--public-dir',type=Path,default=SRC)
    parser.add_argument('--lte-master',type=Path,default=None)
    parser.add_argument('--out',type=Path,default=None)
    args=parser.parse_args()
    build(args.public_dir,args.lte_master,args.out)
