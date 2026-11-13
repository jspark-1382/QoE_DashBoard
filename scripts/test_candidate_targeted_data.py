"""Targeted-data contracts: original aggregate columns, distinct dates and raw namespaces."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
import build_voice_1030 as voice

spec = importlib.util.spec_from_file_location('mdt_grid', Path(__file__).with_name('build-mdt-25m-grid.py'))
grid = importlib.util.module_from_spec(spec)
spec.loader.exec_module(grid)

def row(**changes):
    return {'A':'20261103','E':'pot','F':'960000','G':'1943000','H':'37.5','I':'127.0',
            'M':'900M (B8)','N':'3743(B8)','O':'10','P':'-95','Q':'-16','R':'0',
            'S':'80','T':'70','U':'20','V':'100','W':'95','X':'90','Y':'-101',**changes}

class GridAnalysisTest(unittest.TestCase):
    def merge(self, sources):
        return grid.merge_sources(sources)
    def test_two_sources_preserve_metric_columns_and_missingness(self):
        result=self.merge([('first.xlsx',[row()]),('second.xlsx',[row(E='new',Q='',R='',Y='',T='')])])
        self.assertEqual(result['analysisSchemaVersion'],'mdt-grid-analysis-v1')
        self.assertEqual(result['gridCells'],2)
        self.assertEqual(result['sourceRows'],2)
        a=next(c for c in result['records'] if c['pot']=='pot')['analysis'][0]
        self.assertEqual((a['rsrpMean'],a['rsrpMeanSumCnt'],a['rsrqMean'],a['phrMean']),(-95,-101,-16,0))
        self.assertEqual(a['belowPct']['-105'],70)
        b=next(c for c in result['records'] if c['pot']=='new')['analysis'][0]
        self.assertIsNone(b['rsrqMean']); self.assertIsNone(b['phrMean'])
        self.assertIsNone(b['belowPct']['-105']); self.assertEqual(b['metricSamples']['rsrqMean'],0)
    def test_exact_duplicates_count_once_and_record_both_sources(self):
        result=self.merge([('a.xlsx',[row()]),('b.xlsx',[row()])])
        self.assertEqual(result['measurements'],10)
        self.assertEqual(result['sources'][1]['duplicateRows'],1)
        self.assertEqual(result['records'][0]['analysis'][0]['sourceFiles'],['a.xlsx','b.xlsx'])
    def test_conflicting_duplicate_is_an_error(self):
        with self.assertRaisesRegex(ValueError,'Conflicting duplicate'):
            self.merge([('a.xlsx',[row()]),('b.xlsx',[row(Q='-12')])])
    def test_dates_remain_separate_and_display_uses_latest_date(self):
        result=self.merge([('a.xlsx',[row()]),('b.xlsx',[row(A='20261104',P='-110',O='2')])])
        c=result['records'][0]
        self.assertEqual(result['sourceDates'],['2026-11-03','2026-11-04'])
        self.assertEqual([a['samples'] for a in c['analysis']],[10,2])
        self.assertEqual((c['rsrp'],c['samples']),(-110,2))
    def test_grid_signature_tracks_both_input_files_independently(self):
        import tempfile
        self.assertTrue(hasattr(grid,'input_signature'),'Independent grid freshness signature is required')
        with tempfile.TemporaryDirectory() as t:
            a=Path(t)/'a.xlsx';b=Path(t)/'b.xlsx';a.write_bytes(b'first');b.write_bytes(b'second')
            before=grid.input_signature([a,b]);b.write_bytes(b'changed')
            self.assertNotEqual(before,grid.input_signature([a,b]))
    def test_display_is_thin_and_analysis_retains_the_full_observations(self):
        enriched=self.merge([('a.xlsx',[row()])])
        self.assertTrue(hasattr(grid,'display_grid'),'Separate display serializer is required')
        display=grid.display_grid(enriched)
        self.assertEqual(display['analysisSource'],'quality-improvement/mdt-grid-analysis-v1.json')
        self.assertNotIn('analysis',display['records'][0])
        self.assertEqual(enriched['records'][0]['analysis'][0]['belowPct']['-105'],70)
    def test_invalid_unknown_band_and_invalid_metric_are_explicit(self):
        for change in [dict(N='999(B99)'),dict(Q='unexpected'),dict(S='101')]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.merge([('a.xlsx',[row(**change)])])

class OriginalTerminationTest(unittest.TestCase):
    def test_raw_namespaces_and_zero_survive_without_vendor_decoding(self):
        source={'102. FC':9563,'11. REASON':'H : Drop/V : Rx_RTP_middle_Loss',
                '115. BYE REASON': '102^RTP timeout','13. Release Cause':'0: Tx Bye',
                '14. S Release Cause 1':0,'15. S Release Cause 2':'Null',
                '109. SIP Fail Response Code':'','9. CALL DIR':'MO'}
        self.assertTrue(hasattr(voice,'termination_fields'),'Original termination parser is required')
        actual=voice.termination_fields(source)
        self.assertEqual(actual['fcRaw'],'9563'); self.assertEqual(actual['byeReasonRaw'],'102^RTP timeout')
        self.assertEqual(actual['releaseCauseRaw'],'0: Tx Bye')
        self.assertEqual(actual['secondaryReleaseCause1Raw'],'0')
        self.assertEqual(actual['secondaryReleaseCause2Raw'],'Null')
        self.assertIsNone(actual['sipFailResponseCodeRaw'])
    def test_read_cdr_preserves_fields_and_existing_identity(self):
        from datetime import datetime
        source={'4. START TIME':datetime(2026,10,30,10),'5. END TIME':datetime(2026,10,30,10,1),
                'E2. svc_cont_id':'fixture','E3. Call_ID_edit':'edited','140. RTCP MOS(v5)':2,
                '102. FC':'9563','115. BYE REASON':'102^RTP timeout','13. Release Cause':'0: Tx Bye'}
        with patch.object(voice,'cdr_rows',return_value=iter([(9,source,b'fingerprint')])):
            calls,_=voice.read_cdr(Path('fixture.xlsx'),'all')
        self.assertEqual(calls[0].get('termination',{}).get('fcRaw'),'9563')
        self.assertEqual(calls[0]['id'],'call-'+voice.sha_key('cdr-leg','fixture',calls[0]['startDt'].isoformat(),calls[0]['endDt'].isoformat(),'edited',9))

if __name__=='__main__': unittest.main()
