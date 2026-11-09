import importlib.util
import math
import pathlib
import unittest
import numpy as np

PATH=pathlib.Path(__file__).resolve().parents[1]/"build-quality-model-alternatives.py"
spec=importlib.util.spec_from_file_location("quality_model_alternatives",PATH)
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

def p(x,y,date,customer,mos=2.7,kind="gnss",hour=12):
 return {"callId":f"{date}:{customer}:{x}:{y}:{mos}","date":date,"customerId":customer,
         "lat":37.47+y/111320,"lon":127.04+x/(111320*math.cos(math.radians(37.47))),
         "mos":mos,"kind":kind,"startSecond":hour*3600}
class TestModelAlternatives(unittest.TestCase):
 def setUp(self):
  self.a=[p(0,0,"2026-10-26","A"),p(20,0,"2026-10-26","B"),
          p(30,15,"2026-10-27","C"),p(35,30,"2026-10-27","D"),
          p(45,20,"2026-10-27","E"),p(50,40,"2026-10-26","F")]
  self.b=[p(800,0,"2026-10-26","G"),p(825,0,"2026-10-27","H"),
          p(840,5,"2026-10-27","I"),p(810,20,"2026-10-27","J"),
          p(815,15,"2026-10-26","K"),p(845,10,"2026-10-26","L")]
  self.norm=[p(-500+i*20,300,"2026-10-27",f"N{i}",mos=4.2) for i in range(24)]
 def test_geodesic_distance_meters(self):
  m=mod.matrix_dist(self.a[:2])
  self.assertAlmostEqual(m[0,1],20,delta=.15)
  self.assertAlmostEqual(m[1,0],m[0,1],places=7)
 def test_hdbscan_not_dbscan_alias(self):
  groups=mod.hdbscan_model(sorted(self.a+self.b,key=lambda p:p["callId"]))
  self.assertGreaterEqual(len(groups),1)
  self.assertTrue(all(len(g[0])>=3 for g in groups))
 def test_st_dbscan_spatial_time_joint_gating(self):
  train=sorted(self.a+self.b,key=lambda p:p["callId"])
  groups=mod.st_dbscan_model(train)
  self.assertEqual(len(groups),2)
  self.assertEqual(sorted(len(g[0]) for g in groups),[6,6])
  # Same locations, far-apart times: cannot join across temporal threshold
  late=[dict(x,callId=x["callId"]+"late",date="2026-10-30",customerId="Late"+x["customerId"]) for x in self.a]
  groups=mod.st_dbscan_model(sorted(self.a+late,key=lambda p:p["callId"]))
  self.assertEqual(len(groups),2)
 def test_adaptive_kde_uses_observation_kind_specific_bandwidth(self):
  train=sorted(self.a+self.b,key=lambda p:p["callId"])
  groups=mod.adaptive_kde_model(train)
  self.assertGreaterEqual(len(groups),2)
  self.assertTrue(any(x[3]["bandwidthGnssM"]==70 for x in groups))
  self.assertTrue(all(x[2]==180 for x in groups))
 def test_scan_and_empirical_bayes_are_exploratory_labeled(self):
  train=sorted(self.a+self.b,key=lambda p:p["callId"])
  normal=sorted(self.norm,key=lambda p:p["callId"])
  for method in ("spatial_scan","bayesian"):
   report=mod.model_entry(method,train,normal,[])
   self.assertEqual(report["status"],"exploratory-located-only")
   self.assertGreaterEqual(len(report["candidates"]),1)
   self.assertTrue(all(c["poorCalls"]==len(c["members"]) for c in report["candidates"]))
  s=mod.model_entry("spatial_scan",train,normal,[])["candidates"]
  self.assertTrue(all(0.01<=c["metric"]["conditionalPermutationP"]<=1 for c in s))
 def test_holdout_is_never_used_for_candidate_fitting(self):
  base=sorted(self.a+self.b,key=lambda p:p["callId"])
  validation=[p(8,0,"2026-10-28","NEW1"),p(15,10,"2026-10-28","NEW2")]
  result=mod.model_entry("st_dbscan",base,[],validation)
  self.assertTrue(result["candidates"])
  for c in result["candidates"]:
   self.assertTrue(all(m["date"]!="2026-10-28" for m in c["members"]))
  self.assertTrue(any(c["validationNewCustomers"]>=2 for c in result["candidates"]))
if __name__=="__main__":unittest.main()
