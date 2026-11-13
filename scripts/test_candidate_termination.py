"""Exact published-call joins must fail closed, with no first-match behavior."""
import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.find_spec('build_candidate_termination')
term=__import__('build_candidate_termination') if spec else None

class SidecarJoinTest(unittest.TestCase):
    def test_exact_identity_preserves_raw_fields(self):
        self.assertIsNotNone(term,'Current candidate termination builder is required')
        target={'published-call':{'rawCallId':'call-raw','customerId':'fixture','date':'2026-10-30'}}
        calls=[{'id':'call-raw','customerId':'fixture','date':'2026-10-30','termination':{'fcRaw':'9563','byeReasonRaw':'102^RTP timeout','releaseCauseRaw':'0: Tx Bye'}}]
        actual=term.join_terminations(target,calls)
        self.assertEqual(list(actual),['published-call'])
        self.assertEqual(actual['published-call']['fcRaw'],'9563')
        self.assertEqual(actual['published-call']['releaseCauseRaw'],'0: Tx Bye')
    def test_missing_and_ambiguous_identity_never_first_match(self):
        self.assertIsNotNone(term,'Current candidate termination builder is required')
        targets={'p':{'rawCallId':'call-raw','customerId':'fixture','date':'2026-10-30'}}
        c={'id':'call-raw','customerId':'fixture','date':'2026-10-30','termination':{}}
        for calls in ([],[c,c],[{**c,'date':'2026-10-29'}]):
            with self.subTest(calls=len(calls)),self.assertRaises(ValueError):
                term.join_terminations(targets,calls)
    def test_semantic_presence_keeps_zero_but_excludes_raw_null_sentinels(self):
        self.assertTrue(hasattr(term,'field_presence'),'Raw preservation and semantic availability must differ')
        self.assertTrue(term.field_presence('0'))
        self.assertTrue(term.field_presence('9563'))
        for value in [None,'',' ','Null','NULL','_','N/A']:
            self.assertFalse(term.field_presence(value))
    def test_public_targets_bind_raw_id_to_date_and_customer(self):
        self.assertIsNotNone(term,'Current candidate termination builder is required')
        targets={}
        term.add_target(targets,{'callId':'2026-10-30:fixture:call-raw','customerId':'fixture','date':'2026-10-30'})
        self.assertEqual(targets['2026-10-30:fixture:call-raw']['rawCallId'],'call-raw')
        with self.assertRaises(ValueError):
            term.add_target(targets,{'callId':'2026-10-30:fixture:call-raw','customerId':'different','date':'2026-10-30'})

if __name__=='__main__':unittest.main()
