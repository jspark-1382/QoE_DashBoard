import hashlib
import importlib.util
import json
import math
import pathlib
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[2]
FOLDER=ROOT/"public"/"quality-model-simulations"/"v1"
SCRIPT=ROOT/"scripts"/"build-quality-model-simulations.py"
spec=importlib.util.spec_from_file_location("model_learning_fixtures",SCRIPT)
edu=importlib.util.module_from_spec(spec);spec.loader.exec_module(edu)

class TestDetailedModelSimulator(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.index=json.loads((FOLDER/"index.json").read_text(encoding="utf8"))
  cls.bundles={m:json.loads((FOLDER/(m+".json")).read_text(encoding="utf8")) for m in cls.index["models"]}
 def test_expected_model_scenarios_and_hashes(self):
  self.assertEqual(set(self.index["models"]),set(edu.CONTROLS))
  self.assertEqual(len(self.index["cases"]),3)
  for model in self.index["models"]:
   data=(FOLDER/(model+".json")).read_bytes()
   self.assertEqual(hashlib.sha256(data).hexdigest(),self.index[model]["sha256"])
   self.assertEqual(len(self.bundles[model]["states"]),self.index[model]["states"])
 def test_every_state_is_an_actual_python_calculation(self):
  for model,bundle in self.bundles.items():
   for key,state in bundle["states"].items():
    with self.subTest(model=model,state=key):
     self.assertEqual(key,state["case"]+"|"+edu.key_for(state["params"]))
     train,normal,validation=edu.scenario(state["case"])
     self.assertEqual([p["id"] for p in train],[p["id"] for p in state["points"]])
     self.assertEqual(len(state["normalPoints"]),len(normal))
     expected=edu.engine.finalize(model,edu.compute(model,train,normal,validation,state["params"]),validation)
     self.assertEqual(len(expected),len(state["candidates"]))
     for raw,candidate in zip(expected,state["candidates"]):
      self.assertEqual(raw["id"],candidate["id"])
      self.assertEqual(raw["poorCustomers"],candidate["customerCount"])
      self.assertEqual(raw["days"],candidate["dayCount"])
      self.assertEqual(raw["poorCalls"],candidate["callCount"])
      self.assertEqual(raw["validationNewCustomers"],candidate["newCustomers"])
      self.assertAlmostEqual(raw["rankingScore"],candidate["score"],places=5)
      self.assertEqual(len(raw["members"]),len(candidate["memberIds"]))
      self.assertEqual(len(set(candidate["memberIds"])),len(candidate["memberIds"]))
      self.assertEqual(raw["rangeReviewRequired"],candidate["rangeReview"])
      self.assertTrue(all(p["date"]!="2026-10-30" for p in raw["members"]))
      self.assertTrue(all(p["date"]=="2026-10-30" for p in raw["validationPoints"]))
      if model=="bayesian":
       curves=candidate["betaCurves"]
       self.assertEqual(len(curves["prior"]),61)
       self.assertEqual(len(curves["posterior"]),61)
       self.assertTrue(all(0<=v<=1 for v in curves["prior"]+curves["posterior"]))
      else:
       self.assertIsNone(candidate["betaCurves"])
 def test_models_are_meaningfully_interactive(self):
  for model,bundle in self.bundles.items():
   values=[(len(v["candidates"]),tuple(round(c["score"],4) for c in v["candidates"])) for v in bundle["states"].values()]
   self.assertGreater(len(set(values)),1,model+" parameter controls must change actual output")
   self.assertTrue(any(state["candidates"] for state in bundle["states"].values()),model)
   default="focused|"+edu.key_for(edu.DEFAULTS[model])
   self.assertIn(default,bundle["states"])
 def test_independent_validation_and_scan_limits(self):
  for model,bundle in self.bundles.items():
   for state in bundle["states"].values():
    ids={p["id"] for p in state["validationPoints"]}
    for candidate in state["candidates"]:
     self.assertTrue(set(candidate["validationIds"])<=ids)
     self.assertTrue(set(candidate["memberIds"]).isdisjoint(ids))
     self.assertGreaterEqual(candidate["customerCount"],3)
     self.assertGreaterEqual(candidate["dayCount"],2)
     if model=="spatial_scan":
      self.assertTrue(.01<=candidate["metrics"]["conditionalPermutationP"]<=1)
      self.assertIn(candidate["metrics"]["windowRadiusM"],(100,200,400))
      self.assertEqual(candidate["radiusM"],state["params"]["radius_m"])
if __name__=="__main__":unittest.main()
