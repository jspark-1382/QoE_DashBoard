"""Synthetic contracts: no source customer data is embedded in tests."""
import copy
import importlib.util
import pathlib
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))


def document(points=(), days=3, mode='holdout'):
    dates = [f'2026-10-{26+i:02}' for i in range(days)]
    calls, decisions = [], []
    for cid, customer, day, east_m, kind in points:
        calls.append(dict(callId=cid, rawCallId=cid, customerId=customer,
                          date=dates[day], mos=2, mdtLinkStatus='unique'))
        decisions.append(dict(callId=cid, status='accepted', kind=kind,
                              lat=37, lon=127+east_m/88798, reasons=[]))
    return dict(sourceRevision='synthetic', scopeKey='01234567890123456789',
                scope=dict(source='MDT', sourceRevision='synthetic', dateStart=dates[0],
                           dateEnd=dates[-1], from_='00:00', to='23:59', metric='mos', mode=mode),
                policy=dict(version='voice-improvement-1-policy-v1', locationPolicy='strict-3-site-v1',
                            epsM=100,minSamples=2,minPoorCustomers=3,minPoorDates=2,
                            minNewCustomers=2,maxDiameterMultiplier=2),
                availableDates=dates,calls=calls, decisions=decisions,coverage={},
                provenance=dict(inputFiles=[],stationInventories=[]))


class PipelineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import voice_improvement_1
        cls.build = staticmethod(voice_improvement_1.build_report)

    def base(self):
        return [('a','A',0,0,'gnss'),('b','B',0,40,'gnss'),('c','C',1,80,'gnss')]

    def test_empty_result_is_valid_and_single_day_never_repeated_candidate(self):
        self.assertEqual(self.build(document())['improvedSpatialCandidates'], [])
        one = document([(x,x,0,0,'gnss') for x in 'abcde'],1,'screening')
        report=self.build(one)
        self.assertEqual(report['improvedSpatialCandidates'],[])
        self.assertEqual(len(report['diagnostics']['observationPoints']),5)

    def test_one_call_with_many_observations_cannot_supply_density(self):
        d=document([('a','A',0,0,'gnss')]); d['decisions']*=100
        with self.assertRaisesRegex(ValueError,'duplicate.*decision'):
            self.build(d)

    def test_repeated_one_customer_does_not_supply_three_customers(self):
        self.assertEqual(self.build(document([(str(i),'A',i%2,0,'gnss') for i in range(6)]))['improvedSpatialCandidates'],[])

    def test_existing_customer_validation_kept_but_not_new(self):
        d=document(self.base()+[('d','A',2,170,'gnss'),('e','D',2,170,'gnss'),('f','E',2,170,'gnss')])
        c=self.build(d)['improvedSpatialCandidates'][0]
        self.assertEqual(c['validation']['newCustomerIds'],['D','E'])
        self.assertEqual(c['validation']['existingCustomerIds'],['A'])
        self.assertEqual(c['validation']['status'],'reobserved')
        self.assertEqual({p['callId'] for p in c['nearbyPoints']},set('abcdef'))

    def test_holdout_does_not_change_discovery_geometry_or_rank(self):
        a=self.build(document(self.base()))['improvedSpatialCandidates'][0]
        b=self.build(document(self.base()+[('x','X',2,170,'gnss')]))['improvedSpatialCandidates'][0]
        for key in ['id','medoid','displayRadiusM','maxPairDistanceM','investigationRank','memberCallIds']:
            self.assertEqual(a[key],b[key])
        self.assertEqual(b['validation']['status'],'insufficient-new-customers')

    def test_chain_range_review_and_noise(self):
        d=document([(str(i),str(i),i%2,i*90,'gnss') for i in range(4)]+[('noise','noise',0,3000,'gnss')])
        r=self.build(d); c=r['improvedSpatialCandidates'][0]
        self.assertGreater(c['maxPairDistanceM'],200)
        self.assertTrue(c['rangeReviewRequired']); self.assertIsNone(c['investigationRank'])
        self.assertEqual(r['diagnostics']['improvedNoiseCallIds'],['noise'])

    def test_input_order_cannot_change_ids_or_ranks(self):
        d=document(self.base()); shuffled=copy.deepcopy(d)
        shuffled['calls'].reverse(); shuffled['decisions'].reverse()
        self.assertEqual(self.build(d)['improvedSpatialCandidates'],self.build(shuffled)['improvedSpatialCandidates'])

    def test_radio_expands_only_improved_and_bye_is_excluded(self):
        d=document([('a','A',0,0,'gnss'),('b','B',0,0,'gnss'),('c','C',1,0,'reviewed-radio')])
        r=self.build(d)
        self.assertEqual(len(r['baselineSpatialCandidates']),0)
        self.assertEqual(len(r['improvedSpatialCandidates']),1)
        d['decisions'][2]['kind']='bye-cell'
        with self.assertRaisesRegex(ValueError,'kind'):
            self.build(d)

    def test_two_day_screening_has_no_independent_validation(self):
        r=self.build(document(self.base(),2,'screening'))
        self.assertEqual(r['validationDates'],[])
        self.assertEqual(r['improvedSpatialCandidates'][0]['validation']['status'],'not-applicable')
        with self.assertRaisesRegex(ValueError,'holdout'):
            self.build(document([],2))

    def test_missing_day_and_revision_mixing_rejected(self):
        d=document();d['availableDates'].remove('2026-10-27')
        with self.assertRaisesRegex(ValueError,'date'):
            self.build(d)
        d=document(); d['scope']['sourceRevision']='wrong'
        with self.assertRaisesRegex(ValueError,'revision'):
            self.build(d)

    def test_shared_validation_points_count_union_not_sum(self):
        # Two groups 190m apart, holding point 95m away from each group.
        p=[(f'{side}{i}',f'{side}{i}',i%2,side*190,'gnss') for side in range(2) for i in range(3)]
        p += [('v','V',2,95,'gnss')]
        r=self.build(document(p))
        self.assertEqual(len(r['improvedSpatialCandidates']),2)
        self.assertEqual(r['diagnostics']['validationUnion']['callCount'],1)
        self.assertEqual(r['diagnostics']['validationUnion']['customerCount'],1)
        self.assertTrue(all('v' in c['validation']['callIds'] for c in r['improvedSpatialCandidates']))

    def test_coverage_and_lineage_are_forwarded(self):
        d=document(); d['coverage']={'N':12}; d['provenance']['inputFiles']=[{'file':'source.json','sha256':'a'*64}]
        r=self.build(d)
        self.assertEqual(r['coverage']['N'],12)
        self.assertEqual(r['provenance'],d['provenance'])
        self.assertEqual([s['epsM'] for s in r['diagnostics']['sensitivity']],[50,100,200,300,500])

    def test_batch_generates_each_contiguous_scope_and_hashed_index(self):
        from build_voice_improvement_1 import publish_reports
        d=document(self.base()); d['scope']['from']=d['scope'].pop('from_')
        with tempfile.TemporaryDirectory() as directory:
            index=publish_reports(d,pathlib.Path(directory)/'voice-improvement-1',all_ranges=True)
            self.assertEqual(len(index['entries']),6)
            for entry in index['entries']:
                self.assertEqual(len(entry['scopeKey']),20)
                self.assertTrue((pathlib.Path(directory)/'voice-improvement-1'/entry['path']).exists())

    def test_publisher_rejects_original_output_and_scope_key_tampering(self):
        from build_voice_improvement_1 import publish_reports
        d=document()
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError,'output'):
                publish_reports(d,pathlib.Path(directory)/'analyst-overview')
            with self.assertRaisesRegex(ValueError,'scope key'):
                publish_reports(d,pathlib.Path(directory)/'voice-improvement-1')

    def test_incremental_single_day_publication_preserves_all_index_dates(self):
        from build_voice_improvement_1 import publish_reports, scope_key
        full=document(self.base());full['scope']['from']=full['scope'].pop('from_')
        with tempfile.TemporaryDirectory() as directory:
            out=pathlib.Path(directory)/'voice-improvement-1'
            initial=publish_reports(full,out,all_ranges=True)
            single=copy.deepcopy(full);single['availableDates']=['2026-10-26']
            single['scope'].update(dateEnd='2026-10-26',mode='screening')
            single['calls']=[c for c in full['calls'] if c['date']=='2026-10-26']
            ids={c['callId'] for c in single['calls']};single['decisions']=[d for d in full['decisions'] if d['callId'] in ids]
            single['scopeKey']=scope_key(single['scope'],single['policy'])
            latest=publish_reports(single,out)
            self.assertEqual(latest['availableDates'],full['availableDates'])
            self.assertEqual(len(latest['entries']),len(initial['entries']))

if __name__=='__main__': unittest.main()
