from pathlib import Path
def edit(path,fn):
 p=Path(path)
 text=p.read_text(encoding='utf-8')
 updated=fn(text)
 if updated==text:raise RuntimeError("No change: "+path)
 p.write_text(updated,encoding='utf-8')
 print("UPDATED",path)
def one(text,old,new):
 if text.count(old)!=1:raise RuntimeError("Expected one occurrence, got "+str(text.count(old))+" for "+repr(old[:110]))
 return text.replace(old,new)
def dbscan(t):
 t=one(t,"import {QualityTwoSimulator} from './quality-two-simulator';","import {QualityTwoSimulator} from './quality-two-simulator';\nimport {QualityInvestigationRail} from './quality-investigation-rail';")
 t=one(t," const [railTab,setRailTab]=useState<'explanation'|'criteria'>('explanation');\n","")
 anchor=" const displayPoints=selected\n"
 mapping=""" const investigationItems=summary.candidates.map((c,i)=>{
  const dong=candidateAdministrativeDong(overview,c.medoid.lat,c.medoid.lon);
  const detailForRow=c.id===selected?.candidate.id?selected:null;
  const proof=detailForRow?candidateEvidenceSummary(detailForRow):null;
  return {
   id:c.id,title:candidateTitle(i)+(dong?' · '+dong:''),customers:c.poorCustomerCount,
   calls:c.poorCallCount,days:c.poorDateCount,radiusM:c.displayRadiusM,
   rangeReview:c.rangeReviewRequired,rank:c.rank,
   maxPairDistanceM:detailForRow?.candidate.maxPairDistanceM??null,
   gnssCalls:proof?.gnss??null,radioCalls:proof?.radio??null,
   validationNewCustomers:c.validationNewCustomers
  };
 });
"""
 t=one(t,anchor,mapping+anchor)
 begin=t.index('          <section className={styles.railSelected}',t.index('<aside className={styles.algorithmRail}'))
 end=t.index('        </>}',begin)
 new="""         </div>
         <QualityInvestigationRail
          candidates={investigationItems} selectedId={activeCard?.id??null} onSelect={onSelect}
          onCalls={()=>{setDetailTab('calls');close();}} analysisMode={analysisMode}
          modelName="DBSCAN" guidance="군집 중심은 조사 참고 좌표이며, 통화 열화 순간 위치가 아닙니다."
         />
"""
 t=t[:begin]+new+t[end:]
 return t
def alt(t):
 t=one(t,"import {QualitySimulatorDialog} from './quality-simulator-dialog';","import {QualitySimulatorDialog} from './quality-simulator-dialog';\nimport {QualityInvestigationRail} from './quality-investigation-rail';")
 t=one(t," const [railTab,setRailTab]=useState<'explanation'|'criteria'>('explanation');\n","")
 anchor=" const validationCount=candidates.filter(c=>c.validationStatus==='reobserved').length;\n"
 mapping=""" const investigationItems=candidates.map((c,i)=>{
  const dong=candidateAdministrativeDong(overview,c.lat,c.lon);
  return {
   id:c.id,title:'후보 지역 '+(i+1)+(dong?' · '+dong:''),
   customers:c.poorCustomers,calls:c.poorCalls,days:c.days,radiusM:c.radiusM,
   rangeReview:c.rangeReviewRequired,maxPairDistanceM:c.maxPairDistanceM,rank:c.rank,
   gnssCalls:c.gnssCalls,radioCalls:Math.max(0,c.poorCalls-c.gnssCalls),
   validationNewCustomers:c.validationNewCustomers,
   basis:metricValue(c,modelId),
   warning:subset?'위치 확보 통화 표본의 탐색 결과이며 전체 망 불량률이나 확정된 위험 우선순위가 아닙니다.':undefined
  };
 });
"""
 t=one(t,anchor,anchor+mapping)
 begin=t.index('          <section className={styles.railSelected}',t.index('<aside className={styles.railSidebar}'))
 end=t.index('        </aside>',begin)
 new="""         </div>
         <QualityInvestigationRail
          candidates={investigationItems} selectedId={active?.id??null} onSelect={select}
          onCalls={()=>{setDetailTab('calls');close();}} analysisMode={analysisMode}
          modelName={option?.name??modelId}
          guidance={subset?'표본 편향: 지도 후보는 탐색용이며 위험률·RF 원인 확정이 아닙니다.':'선정 지역은 실제 MOS 저하 순간 좌표나 RF 원인 확정 장소가 아닙니다.'}
         />
"""
 t=t[:begin]+new+t[end:]
 return t
edit('components/analyst/quality-two-candidate-workspace.tsx',dbscan)
edit('components/analyst/quality-model-alternative-workspace.tsx',alt)
