"""Explicit MDT-first, source-order fallback policy for registered BYE sites."""
from collections import Counter
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from openpyxl import Workbook
from shapely.geometry import box

from bye_station_catalog import load_bye_catalog, resolve_bye_site, select_bye_site
from administrative_dong import get_bye_mdt_events
import administrative_dong as mapper


class ByeStationSelectionTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.lte = self.root / 'lte.xlsx'
        book = Workbook(); sheet = book.active
        sheet.append(['cell_id','LTERU_ID','pci_no','latitude','longitude'])
        for row in [
            ['cell','Z-FIRST',2,37.51,127.01],
            ['cell','A-SECOND',2,37.52,127.02],
            ['invalid','NO-COORD',3,None,127.0],
            ['invalid','VALID',3,37.5,127.0],
            ['conflict','SAME-RU',4,37.53,127.03],
            ['conflict','SAME-RU',4,37.54,127.04],
            ['only-invalid','BAD',4,None,127.0],
        ]: sheet.append(row)
        book.save(self.lte); book.close()
        self.catalog,_ = load_bye_catalog(self.lte,None,{'cell','invalid','conflict','only-invalid'})

    def event(self, ru='A-SECOND', lag=1, cell='cell', rat='LTE'):
        return {'ruId':ru,'cellId':cell,'technology':rat,'secondsBeforeEnd':lag}

    def test_first_is_source_order_and_missing_or_wrong_rat_is_never_invented(self):
        chosen = select_bye_site(self.catalog,'cell','LTE')
        self.assertEqual(chosen['ruId'],'Z-FIRST')
        self.assertEqual(chosen['byeSelectionMethod'],'first')
        self.assertEqual(chosen['byeCandidateCount'],2)
        self.assertIsNone(select_bye_site(self.catalog,'cell','NR'))
        self.assertIsNone(select_bye_site(self.catalog,'missing','LTE'))
        self.assertIsNone(resolve_bye_site(self.catalog,'cell','LTE'))

    def test_mdt_chooses_latest_matching_ru_and_records_timing(self):
        events = [self.event('Z-FIRST',10), self.event(lag=-.05)]
        chosen = select_bye_site(self.catalog,'cell','LTE',events)
        self.assertEqual(chosen['ruId'],'A-SECOND')
        self.assertEqual(chosen['byeSelectionMethod'],'mdt')
        self.assertEqual(chosen['byeSelectionDeltaSeconds'],-.05)
        self.assertEqual(chosen['byeSelectionMdtRu'],'A-SECOND')
        self.assertEqual(chosen['byeCandidateCount'],2)

    def test_mdt_tie_stale_future_wrong_cell_rat_and_unregistered_ru_fall_back(self):
        for events in [
            [self.event(),self.event('Z-FIRST')], [self.event(lag=30.001)],
            [self.event(lag=-1.001)], [self.event(cell='other')],
            [self.event(rat='NR')], [self.event('UNKNOWN')],
            [self.event(lag=float('nan'))],
        ]:
            with self.subTest(events=events):
                chosen = select_bye_site(self.catalog,'cell','LTE',events)
                self.assertEqual((chosen['ruId'],chosen['byeSelectionMethod']),('Z-FIRST','first'))
                self.assertNotIn('byeSelectionDeltaSeconds',chosen)

    def test_invalid_coordinates_are_skipped_and_ru_coordinate_conflicts_remain_first(self):
        self.assertIsNone(resolve_bye_site(self.catalog,'invalid','LTE'))
        chosen = select_bye_site(self.catalog,'invalid','LTE')
        self.assertEqual((chosen['ruId'],chosen['byeSelectionMethod']),('VALID','first'))
        self.assertEqual(chosen['byeCandidateCount'],1)
        self.assertIsNone(select_bye_site(self.catalog,'only-invalid','LTE'))
        chosen = select_bye_site(self.catalog,'conflict','LTE',[self.event('SAME-RU',cell='conflict')])
        self.assertEqual(chosen['byeSelectionMethod'],'first')
        self.assertEqual((chosen['lat'],chosen['lon']),(37.53,127.03))

    def test_unknown_rat_can_use_matching_mdt_radio_but_explicit_rat_stays_scoped(self):
        nr=self.root/'nr.xlsx'
        book=Workbook(); sheet=book.active
        sheet.append(['ru_id','cell_id','pci','latitude','longitude'])
        sheet.append(['NR-RU','cell',700,37.55,127.05])
        book.save(nr); book.close()
        catalog,_=load_bye_catalog(self.lte,nr,{'cell'})
        events=[self.event('NR-RU',rat='NR')]
        chosen=select_bye_site(catalog,'cell',None,events)
        self.assertEqual((chosen['ruId'],chosen['technology'],chosen['byeSelectionMethod']),('NR-RU','NR','mdt'))
        self.assertEqual(chosen['byeCandidateCount'],3)
        self.assertEqual(select_bye_site(catalog,'cell','LTE',events)['byeSelectionMethod'],'first')

    def test_partition_loader_uses_only_linked_exact_call_samples_and_validates_identity(self):
        fields=['callId','rat','mdt']
        manifest={'meta':{'sampleFields':fields},'days':[
            {'customerId':'customer','date':'2026-10-30','dataPath':'day.json'},
        ]}
        raw={'customerId':'customer','date':'2026-10-30','calls':[
            {'id':'raw','matchStatus':'MATCHED','endCellId':'cell','endRat':'LTE','endTimestamp':'2026-10-30T10:01:00'},
            {'id':'other','matchStatus':'MATCHED','endCellId':'cell','endRat':'LTE','endTimestamp':'2026-10-30T10:01:00'},
        ],'samples':[
            ['raw','LTE',{'baseStationId':'A-SECOND','cellId':'cell','timestamp':'2026-10-30T10:00:59'}],
            ['other','LTE',{'baseStationId':'Z-FIRST','cellId':'cell','timestamp':'2026-10-30T10:01:00'}],
        ]}
        call={'id':'customer:raw','customerId':'customer','rawCallId':'raw','endCellId':'cell','endRat':'LTE'}
        path=self.root/'day.json'
        path.write_text(json.dumps(raw),encoding='utf8')
        events=get_bye_mdt_events(manifest,self.root,'2026-10-30',[call])
        self.assertEqual(len(events[call['id']]),1)
        self.assertEqual(events[call['id']][0]['secondsBeforeEnd'],1)
        raw['calls'][0]['matchStatus']='AMBIGUOUS'
        path.write_text(json.dumps(raw),encoding='utf8')
        self.assertEqual(get_bye_mdt_events(manifest,self.root,'2026-10-30',[call]),{})
        raw['customerId']='wrong'
        path.write_text(json.dumps(raw),encoding='utf8')
        with self.assertRaisesRegex(ValueError,'customer|고객'):
            get_bye_mdt_events(manifest,self.root,'2026-10-30',[call])

    def test_mapper_propagates_mdt_selection_without_replacing_primary_gnss(self):
        calls=[{'id':'customer:'+cid,'customerId':'customer','rawCallId':cid,
                'endCellId':'cell','endRat':'LTE','mos':2.2,'start':'10:00:00'}
               for cid in ('gnss','fallback')]
        manifest={'meta':{'sampleFields':['callId','rat','mdt']},'days':[
            {'customerId':'customer','date':'2026-10-30','dataPath':'day.json'},
        ]}
        raw={'customerId':'customer','date':'2026-10-30','calls':[
            {'id':cid,'matchStatus':'MATCHED','endCellId':'cell','endRat':'LTE',
             'endTimestamp':'2026-10-30T10:01:00+09:00'} for cid in ('gnss','fallback')
        ],'samples':[
            [cid,'LTE',{'baseStationId':'A-SECOND','cellId':'cell',
                        'timestamp':'2026-10-30T10:00:59.500+09:00'}] for cid in ('gnss','fallback')
        ]}
        (self.root/'day.json').write_text(json.dumps(raw),encoding='utf8')
        overview={'date':'2026-10-30','calls':copy.deepcopy(calls)}
        x,y=mapper.forward_5186(37.49,127.01)
        primary=[('customer:gnss',x,y,'gnss',37.49,127.01,
                  '2026-10-30T01:00:59Z','2026-10-30T01:01:00Z',1,{'estimationMethod':'GNSS'})]
        region={'id':'adm:test','label':'test','lat':37.5,'lon':127.0,'coordinates':[],
                'bbox':(-1000000,-1000000,2000000,2000000),'geometry':box(-1000000,-1000000,2000000,2000000)}
        with patch.object(mapper,'check_prj'),patch.object(mapper,'read_dbf',return_value=[{'BASE_DATE':'20251101'}]),\
             patch.object(mapper,'get_normalized_points',return_value=(primary,Counter())),\
             patch.object(mapper,'read_local_boundaries',return_value=[region]):
            audit=mapper.attach(overview,manifest,self.root,self.root/'fake.shp',self.root/'points.json',self.lte)
        points={point['callId']:point for point in overview['callLocations']}
        gnss=points['customer:gnss']; fallback=points['customer:fallback']
        self.assertEqual((gnss['evidence'],gnss['lat'],gnss['lon']),('gnss',37.49,127.01))
        self.assertEqual((gnss['byeStationLat'],gnss['byeStationLon']),(37.52,127.02))
        self.assertEqual((fallback['evidence'],fallback['lat'],fallback['lon']),('bye-cell',37.52,127.02))
        for point in points.values():
            self.assertEqual(point['byeSelectionMethod'],'mdt')
            self.assertEqual(point['byeCandidateCount'],2)
            self.assertEqual(point['byeSelectionDeltaSeconds'],.5)
            self.assertEqual(point['byeSelectionMdtRu'],'A-SECOND')
        self.assertEqual(audit['byeSelection_mdt'],2)


if __name__=='__main__':
    unittest.main()
