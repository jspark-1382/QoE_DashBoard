"""Evidence-gated VoLTE impairment-time and handset-location inference.

No RTCP interval evidence -> no onset timestamp. A base-station is never UE
ground truth. No calibrated receiver horizontal accuracy -> no statistical
confidence radius. Functions are import-safe and do not access local files.

Input contracts: timestamps are epoch seconds in a *confirmed* common clock.
No hidden inferred timezone, offset, radio path-loss exponent or sensor noise.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
import math
from statistics import median
from typing import Sequence

EARTH_M=6371008.8

@dataclass(frozen=True)
class RtcpInterval:
    start_s: float
    end_s: float
    mos: float | None = None
    loss_fraction: float | None = None  # 0..1, NOT RFC3550 integer fraction (0..255)
    jitter_ms: float | None = None
    source: str = "rtcp_interval"
    interval_verified: bool = True

@dataclass(frozen=True)
class GnssFix:
    t_s: float
    lat: float
    lon: float
    accuracy_95_m: float | None = None  # native device metadata, never guessed
    crs_verified: bool = False
    source: str = "GNSS"

@dataclass(frozen=True)
class PositionEstimate:
    method: str
    lat: float | None
    lon: float | None
    assumed_motion_bound_m: float | None
    confidence_radius_90_m: float | None
    confidence_calibrated: bool
    basis_times_s: tuple[float, ...]
    status: str
    reason: str

@dataclass(frozen=True)
class ClockEstimate:
    status: str
    offset_s: float | None
    robust_residual_p90_s: float | None
    anchor_count: int
    reason: str

def finite(x):
    return isinstance(x,(int,float)) and not isinstance(x,bool) and math.isfinite(x)

def haversine_m(a, b):
    lat1,lon1=a
    lat2,lon2=b
    p1,p2=math.radians(lat1),math.radians(lat2)
    sinlat=math.sin((p2-p1)/2)
    sinlon=math.sin(math.radians(lon2-lon1)/2)
    return 2*EARTH_M*math.asin(min(1.,math.sqrt(sinlat*sinlat+math.cos(p1)*math.cos(p2)*sinlon*sinlon)))

def _xy(p,lat0):
    return ((p[1]*math.pi/180)*EARTH_M*math.cos(math.radians(lat0)),
            (p[0]*math.pi/180)*EARTH_M)

def _from_xy(xy,lat0):
    return (xy[1]/EARTH_M*180/math.pi,
            xy[0]/(EARTH_M*math.cos(math.radians(lat0)))*180/math.pi)

def _valid_gnss(p):
    return (p.crs_verified and finite(p.t_s) and finite(p.lat) and
            finite(p.lon) and 33<=p.lat<=39.8 and 124<=p.lon<=132 and
            (p.accuracy_95_m is None or (finite(p.accuracy_95_m) and 0<p.accuracy_95_m<10000)))

def _unknown(reason,method="UNAVAILABLE"):
    return PositionEstimate(method,None,None,None,None,False,(),"NO_VERIFIABLE_POSITION",reason)

def _q(data,p):
    if not data:return None
    a=sorted(data);j=(len(a)-1)*p;i=int(math.floor(j));k=int(math.ceil(j))
    return float(a[i]+(a[k]-a[i])*(j-i))

def estimate_clock_offset(anchors, *, independent_clock_anchors=False):
    """(source epoch, reference epoch) matched SAME physical event only.

    Never infer clock offset from CDR start vs first MDT sample or from
    timestamps of different events. Residual is measured scatter, not a
    certified absolute time error. Cross-validated anchor accuracy is needed
    before reporting it as an uncertainty distribution.
    """
    if not independent_clock_anchors:
        return ClockEstimate("UNVERIFIED",None,None,len(anchors),"No independent same-event clock anchors")
    clean=[(a,b) for a,b in anchors if finite(a) and finite(b)]
    if len(clean)<4 or len({a for a,b in clean})<4:
        return ClockEstimate("INSUFFICIENT",None,None,len(clean),"Need >=4 distinct same-event anchors")
    diffs=[b-a for a,b in clean]
    offset=median(diffs)
    absdiff=[abs(v-offset) for v in diffs]
    mad=median(absdiff)
    kept=[v for v in diffs if abs(v-offset)<=max(0.002,5*1.4826*mad)]
    if len(kept)<4:
        return ClockEstimate("UNSTABLE",None,None,len(clean),"Residual outlier concentration")
    corrected=median(kept)
    residual=_q([abs(v-corrected) for v in kept],.9)
    span=max(a for a,b in clean)-min(a for a,b in clean)
    if span<=0:
        return ClockEstimate("INSUFFICIENT",None,None,len(clean),"No time span")
    # Drift is not fitted unless physically matched independent events exist.
    return ClockEstimate("ESTIMATED_NOT_CERTIFIED",round(corrected,6),round(residual,6),len(clean),
                         "Robust matched-anchor offset; does not establish source clock hardware accuracy")

def detect_impairment_intervals(reports:Sequence[RtcpInterval], *,
                                mos_threshold=3.0,loss_threshold=0.05,jitter_threshold_ms=30.,
                                confirm_bad_reports=2,confirm_good_reports=2):
    """Detect time-local impairment only when RTCP reports cover verified intervals.

    A per-call aggregate repeated in MDT rows must not pass interval_verified.
    Onset is bounded by the previous GOOD interval end and first BAD interval end;
    never represented as a falsely precise single second. Intervals with no
    metrics remain UNKNOWN. Baseline healthy interval is mandatory.
    """
    if not reports:
        return {"status":"NO_INTERVAL_RTCP","episodes":[],"onset_interval_s":None}
    if any(not r.interval_verified or not finite(r.start_s) or not finite(r.end_s) or
           r.end_s<=r.start_s or r.source in ("cdr_aggregate","mdt_repeated_call_aggregate")
           for r in reports):
        return {"status":"AGGREGATED_OR_INVALID_TIME","episodes":[],"onset_interval_s":None}
    records=sorted(reports,key=lambda r:(r.start_s,r.end_s))
    if any(b.start_s < a.end_s-1e-6 for a,b in zip(records,records[1:])):
        return {"status":"OVERLAPPING_REPORTS","episodes":[],"onset_interval_s":None}
    if len(records)<1+confirm_bad_reports:
        return {"status":"INSUFFICIENT_INTERVALS","episodes":[],"onset_interval_s":None}
    state=[]
    for r in records:
        observations=[]
        if finite(r.mos) and 1<=r.mos<=5:
            observations.append(r.mos<mos_threshold)
        if finite(r.loss_fraction) and 0<=r.loss_fraction<=1:
            observations.append(r.loss_fraction>=loss_threshold)
        if finite(r.jitter_ms) and r.jitter_ms>=0:
            observations.append(r.jitter_ms>=jitter_threshold_ms)
        state.append(None if not observations else any(observations))
    episodes=[]
    last_good=None
    i=0
    while i<len(records):
        if state[i] is False:
            last_good=records[i]
            i+=1
            continue
        if state[i] is True and last_good is not None and i+confirm_bad_reports<=len(records) and all(
           state[j] is True for j in range(i,i+confirm_bad_reports)):
            first_bad=records[i]
            start_bounds=(round(last_good.end_s,6),round(first_bad.end_s,6))
            j=i+confirm_bad_reports
            recovery=None
            while j<len(records):
                if j+confirm_good_reports<=len(records) and all(
                        state[k] is False for k in range(j,j+confirm_good_reports)):
                    recovery=(round(records[j-1].end_s,6),round(records[j].end_s,6))
                    break
                j+=1
            episodes.append({"onset_interval_s":start_bounds,
                "recovery_interval_s":recovery,
                "first_bad_report_s":(first_bad.start_s,first_bad.end_s),
                "detector":"RTCP_INTERVAL_CHANGE_WITH_PRECEDING_GOOD",
                "evidence":"RTCP_INTERVAL",
                "onset_is_exact_second":False})
            if recovery is not None:
                last_good=records[j]
                i=j+confirm_good_reports
            else:
                break
        else:
            i+=1
    return {"status":"DETECTED_INTERVAL" if episodes else
            ("NO_PRECEDING_HEALTHY_ANCHOR" if any(state) and not any(s is False for s in state) else "NO_CONFIRMED_TRANSITION"),
            "episodes":episodes,"onset_interval_s":episodes[0]["onset_interval_s"] if episodes else None,
            "observed_intervals":len(records),"bad_interval_count":sum(s is True for s in state)}

def infer_position(fixes:Sequence[GnssFix], target_s:float, method:str, *,
                   max_speed_mps=33.3333, max_age_s=180, interpolation_max_gap_s=180):
    """Temporal GNSS-only estimators.

    interpolation: retrospective (future fix allowed and disclosed).
    last/velocity: causal (strictly earlier fixes only).
    Accuracy 90% radius is null until independently calibrated; an assumed
    motion bound is not a statistical CI.
    """
    if not finite(target_s):
        return _unknown("Target event clock not verified",method)
    fixes=sorted((p for p in fixes if _valid_gnss(p)),key=lambda p:p.t_s)
    if method not in ("last_gnss","constant_velocity","time_interpolation"):
        return _unknown("Unsupported GNSS algorithm",method)
    before=[p for p in fixes if p.t_s<target_s-1e-6]
    after=[p for p in fixes if p.t_s>target_s+1e-6]
    if not before or target_s-before[-1].t_s>max_age_s:
        return _unknown("No recent earlier real GNSS fix",method)
    a=before[-1]
    lag=target_s-a.t_s
    if method=="last_gnss":
        return PositionEstimate(method,a.lat,a.lon,round(max_speed_mps*lag,2),None,False,(a.t_s,),
             "REFERENCE_ONLY","Last measured GNSS; movement bound excludes unknown sensor error")
    if method=="time_interpolation":
        if not after:
            return _unknown("No future measured GNSS: interpolation not observable",method)
        b=after[0]
        dt=b.t_s-a.t_s
        if dt>interpolation_max_gap_s or dt<=0:
            return _unknown("GNSS bracket exceeds interpolation time gate",method)
        speed=haversine_m((a.lat,a.lon),(b.lat,b.lon))/dt
        if speed>max_speed_mps:
            return _unknown("GNSS bracket requires implausible speed",method)
        w=lag/dt
        lat=a.lat+(b.lat-a.lat)*w
        lon=a.lon+(b.lon-a.lon)*w
        # Without sensor accuracy and a validated motion process, this is a
        # conservative *kinematic scenario* bound, not accuracy coverage.
        reach=min(max_speed_mps*lag,max_speed_mps*(b.t_s-target_s))
        return PositionEstimate(method,lat,lon,round(reach,2),None,False,(a.t_s,b.t_s),
            "RETROSPECTIVE_GNSS_BRACKET","Both GNSS endpoints real; future endpoint makes method non-causal")
    if len(before)<2:
        return _unknown("Need two strictly earlier GNSS fixes for velocity",method)
    b=before[-2]
    dt=a.t_s-b.t_s
    if dt<3 or dt>180 or lag>180:
        return _unknown("Velocity baseline age or spacing outside gate",method)
    speed=haversine_m((b.lat,b.lon),(a.lat,a.lon))/dt
    if speed>max_speed_mps:
        return _unknown("Observed GNSS motion exceeds configured max speed",method)
    latitude=a.lat+(a.lat-b.lat)/dt*lag
    longitude=a.lon+(a.lon-b.lon)/dt*lag
    if not (33<=latitude<=39.8 and 124<=longitude<=132):
        return _unknown("Extrapolated position outside Korea gate",method)
    return PositionEstimate(method,latitude,longitude,round(2*max_speed_mps*lag,2),
           None,False,(b.t_s,a.t_s),"MOTION_EXTRAPOLATION",
           "Constant velocity hypothesis; no inertial sensors or verified motion state")

def expected_uncertainty_scenarios(clock_p90_s,GNSS_device_95_m,
                                   target_age_s,max_speed_mps=33.3333):
    """Scenario propagation; no confidence level obtained by adding unlike quantiles.

    Unknown device accuracy and unanchored clock => UNKNOWN.
    Return only physically interpretable worst-case scenario sum, never a 90% CI.
    """
    if not all(finite(x) and x>=0 for x in
               (clock_p90_s,GNSS_device_95_m,target_age_s,max_speed_mps)):
        return {"status":"UNKNOWN","scenario_bound_m":None,"is_calibrated_confidence":False}
    return {"status":"ASSUMPTION_BASED","scenario_bound_m":round(
        GNSS_device_95_m+max_speed_mps*(clock_p90_s+target_age_s),2),
        "is_calibrated_confidence":False}

def compare_radio_evidence(events, onset_interval_s,clock_residual_s=None):
    """Association hypotheses, NOT causal labels or completed attribution.

    Radio measurements must be signed, pre/post aligned and in-call.
    Missing time synchronization yields unverified temporal association.
    """
    if onset_interval_s is None:
        return {"status":"NO_VERIFIED_IMPAIRMENT_ONSET","causal_root_cause":None,
                "hypotheses":[]}
    if not finite(clock_residual_s):
        return {"status":"UNSYNCHRONIZED_RADIO","causal_root_cause":None,"hypotheses":[]}
    start,end=onset_interval_s
    nearby=[e for e in events if finite(e.get("t")) and
            start-10-clock_residual_s<=e["t"]<=end+10+clock_residual_s]
    hypotheses=[]
    if any(finite(e.get("rsrp")) and e["rsrp"]<=-110 for e in nearby):
        hypotheses.append({"name":"WEAK_COVERAGE","evidence":"RSRP <= -110 dBm near onset","causal":False})
    if any(finite(e.get("rsrq")) and e["rsrq"]<=-15 for e in nearby):
        hypotheses.append({"name":"INTERFERENCE_OR_LOAD","evidence":"RSRQ <= -15 dB near onset","causal":False})
    if any(finite(e.get("sinr")) and e["sinr"]<=0 for e in nearby):
        hypotheses.append({"name":"LOW_SINR","evidence":"SINR <= 0 dB near onset","causal":False})
    if any(str(e.get("trigger") or "").upper().startswith(("A3","HO")) for e in nearby):
        hypotheses.append({"name":"HANDOVER_REVIEW","evidence":"MDT handover-related trigger near onset","causal":False})
    return {"status":"TIME_ASSOCIATED_HYPOTHESIS_ONLY","causal_root_cause":None,
            "hypotheses":hypotheses,"nearby_samples":len(nearby)}


def fuse_calibrated_position_observations(observations, *, target_s,
                                          clocks_independently_anchored=False,
                                          radio_model_independently_validated=False):
    """Optional isotropic Gaussian precision fusion; unavailable on current corpus.

    Observation schema:
      {'family':'gnss'|'radio'|'inertial',
       'lat':float,'lon':float,'t_s':float,
       'sigma_position_m':float, # 1-axis standard deviation, NOT GPS 95% radius
       'sigma_clock_s':float,
       'motion_process_sigma_mps':float,
       'evidence_id':str}

    Source-specific sigma must come from independently documented calibration.
    Different row timestamps of the SAME GNSS fix are NOT independent. Caller
    explicitly verifies independent clock and radio path-loss calibration.

    Output model-conditional theoretical radial 90% is not a measured 90%
    coverage region. Do not publish as field-certified.
    """
    unavailable=lambda reason:{"status":"UNAVAILABLE_UNCALIBRATED_FUSION",
                                "reason":reason,"lat":None,"lon":None,
                                "model_conditional_radius90_m":None,
                                "field_certified_90pct_coverage":False}
    if not finite(target_s) or not clocks_independently_anchored:
        return unavailable("No independently anchored cross-sensor clock")
    if not radio_model_independently_validated:
        return unavailable("No independent RF propagation/residual calibration")
    if len(observations)<2:
        return unavailable("Need at least two independent sensors")
    ids=[str(o.get("evidence_id") or "") for o in observations]
    if any(not s for s in ids) or len(set(ids))!=len(ids):
        return unavailable("Correlated or duplicated evidence cannot be fused as independent")
    families={o.get("family") for o in observations}
    if not ("gnss" in families and "radio" in families):
        return unavailable("Need independently validated GNSS and radio sensor sources")
    for o in observations:
        if not (finite(o.get("lat")) and finite(o.get("lon")) and 33<=o["lat"]<=39.8 and
                124<=o["lon"]<=132 and finite(o.get("t_s"))):
            return unavailable("Invalid independent sensor position/time")
        for k in ("sigma_position_m","sigma_clock_s","motion_process_sigma_mps"):
            if not finite(o.get(k)) or o[k]<0:
                return unavailable("Missing independently calibrated "+k)
        if o["sigma_position_m"]<=0 or abs(target_s-o["t_s"])>180:
            return unavailable("Invalid device sigma or excessive observation age")
    lat0=sum(o["lat"] for o in observations)/len(observations)
    lon0=sum(o["lon"] for o in observations)/len(observations)
    weights=[]
    for o in observations:
        age=abs(target_s-o["t_s"])
        variance=(o["sigma_position_m"]**2+
                  (o["sigma_clock_s"]*o["motion_process_sigma_mps"])**2+
                  (age*o["motion_process_sigma_mps"])**2)
        weights.append(1/variance)
    den=sum(weights)
    lat=sum(o["lat"]*w for o,w in zip(observations,weights))/den
    lon=sum(o["lon"]*w for o,w in zip(observations,weights))/den
    sigma=math.sqrt(1/den)
    radius90=sigma*math.sqrt(-2*math.log(0.1))
    return {"status":"MODEL_CONDITIONAL_ONLY","lat":lat,"lon":lon,
            "model_conditional_radius90_m":round(radius90,2),
            "field_certified_90pct_coverage":False,
            "source_ids":ids,
            "assumptions":"Isotropic, Gaussian, unbiased, source-independent observation errors; NOT certified by these inputs"}

