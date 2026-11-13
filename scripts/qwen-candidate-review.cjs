/* eslint-disable @typescript-eslint/no-require-imports -- Evidence rules run independently of model prose. */
const {createHash}=require('node:crypto');
const finite=value=>typeof value==='number'&&Number.isFinite(value);

/** A bounded investigation shortlist, not an automated root-cause verdict.
 * Every target is inspected; only evidence-bearing connected areas are promoted.
 * This output stays outside modelInput so agreement is observable. */
function mdtAreas(targets,modelTargets,neighbourLinks){
 const models=new Map(modelTargets.map(target=>[target.id,target]));
 const grids=targets.filter(target=>target.kind==='mdt-grid');
 const metrics=target=>models.get(target.id)?.metrics??{};
 const tails=target=>['-100','-105','-110'].map(key=>metrics(target).belowPct?.[key]).filter(finite);
 const ul=target=>metrics(target).criteria?.ul?.status==='matched';
 const sparse=target=>metrics(target).sampleSupport==='sparse';
 const qualified=grids.filter(target=>!sparse(target)&&(tails(target).some(value=>value>0)||ul(target)));
 const eligible=new Map(qualified.map(target=>[target.id,target]));
 const adjacent=new Map(targets.map(target=>[target.id,[]]));
 for(const [a,b] of neighbourLinks){adjacent.get(a)?.push(b);adjacent.get(b)?.push(a);}
 const rank=target=>tails(target).reduce((sum,value)=>sum+value,0)+(ul(target)?30:0);
 const compare=(a,b)=>rank(b)-rank(a)||(metrics(b).samples??0)-(metrics(a).samples??0)||a.id.localeCompare(b.id);
 const visited=new Set(),areas=[];
 for(const seed of [...qualified].sort(compare)){
  if(visited.has(seed.id))continue;
  const area=[],queue=[seed];visited.add(seed.id);
  while(queue.length){
   const current=queue.shift();area.push(current);
   const next=(adjacent.get(current.id)??[]).map(id=>eligible.get(id)).filter(Boolean).sort(compare);
   for(const target of next)if(!visited.has(target.id)){visited.add(target.id);queue.push(target);}
  }
  areas.push(area.sort(compare));
 }
 return {grids,metrics,tails,sparse,adjacent,areas};
}
function buildMdtObservationGroups(targets,modelTargets,neighbourLinks){
 const {grids,metrics,tails,adjacent,areas}=mdtAreas(targets,modelTargets,neighbourLinks);
 return areas.slice(0,6).map(area=>{
  const selected=area.slice(0,5),targetIds=selected.map(target=>target.id),first=selected[0];
  const neighbours=new Set(selected.flatMap(target=>adjacent.get(target.id)??[]));
  const comparison=grids.filter(target=>neighbours.has(target.id)&&tails(target).length&&tails(target).every(value=>value===0)&&metrics(target).criteria?.ul?.status!=='matched').slice(0,3);
  return {id:'AREA_'+createHash('sha256').update(targetIds.join('|')).digest('hex').slice(0,12),kind:'mdt-adjacent-observations',sourceDates:first.sourceDates,band:first.band,earfcn:first.earfcn,componentTargetCount:area.length,selectionBasis:'connected-component-ranked-rsrp-tail',targetIds,comparisonTargetIds:comparison.map(target=>target.id),evidenceIds:[...selected,...comparison].flatMap(target=>target.evidenceIds)};
 });
}
function buildIndependentReview(targets,modelTargets,neighbourLinks){
 const {grids,metrics,tails,sparse,adjacent,areas}=mdtAreas(targets,modelTargets,neighbourLinks);
 const priorities=areas.map(area=>{
  const selected=area.slice(0,5),first=selected[0],targetIds=selected.map(target=>target.id);
  const comparisonIds=new Set(selected.flatMap(target=>adjacent.get(target.id)??[]));
  const zeroNeighbours=grids.filter(target=>comparisonIds.has(target.id)&&tails(target).length&&tails(target).every(value=>value===0)&&metrics(target).criteria?.ul?.status!=='matched');
  const names=selected.map(target=>target.mapPoints[0]?.pot??target.title).join(' · ');
  const neighbours=zeroNeighbours.slice(0,3).map(target=>target.mapPoints[0]?.pot??target.title).join(' · ');
  return {
   id:'RULE_'+createHash('sha256').update(targetIds.join('|')).digest('hex').slice(0,12),category:'coverage',assessment:'possible',targetIds,evidenceIds:[...new Set([...selected,...zeroNeighbours.slice(0,3)].flatMap(target=>target.evidenceIds))],
   title:names+' · '+first.band+' RSRP 분포 확인',
   observation:selected.map(target=>target.observation).join(' ')+(neighbours?' 같은 날짜·대역·EARFCN 인접 '+neighbours+'에는 제공된 RSRP 기준 이하 비율이 0%여서 경계 비교가 가능합니다.':'')+(area.length>selected.length?' 인접관계로 연결된 조사 구간 전체 중 RSRP 꼬리가 큰 POT부터 표시합니다. 표시한 POT끼리 모두 직접 맞닿거나 분포가 동일하다는 뜻은 아닙니다.':''),
   nextCheck:first.sourceDates[0]+' '+first.band+' EARFCN '+first.earfcn+'의 '+names+'에서 서빙·이웃 셀 신호와 음성 품질을 동시 측정하고'+(neighbours?' 인접 '+neighbours+'와 경계를 비교합니다.':' 별도 날짜의 같은 구간에서 재현 여부를 확인합니다.'),
   limitations:['별도 날짜의 배경 MDT 분포로 정한 조사 위치입니다. 해당 통화의 저하 순간 위치나 책임 셀·확정 원인을 뜻하지 않습니다.','측정 가중치가 충분한 양수 꼬리 관측을 우선 표시한 규칙이며 원인 확률이나 무선 양호·불량 판정 기준이 아닙니다.']
  };
 });
 const interruptions=targets.filter(target=>target.kind==='termination-group'&&Object.values(metrics(target).rawCodes??{}).some(value=>typeof value==='string'&&/RTP timeout|Rx_RTP_middle_Loss/i.test(value)));
 const termination=interruptions.slice(0,1).map(target=>({
  id:'RULE_'+target.id,category:'equipment',assessment:'possible',targetIds:[target.id],evidenceIds:target.evidenceIds,
  title:'RTP 중단·종료 주체와 수신 경로 확인',observation:target.observation,
  nextCheck:'같은 통화의 마지막 수신·송신 RTP 시각과 최초 BYE 발신 주체를 맞추고, 단말·무선·IMS·전송 구간별 기록에서 중단이 시작된 방향과 구간을 찾습니다.',
  limitations:['RTP timeout·수신 중단은 관측된 종료 패턴입니다. 전송·장비·단말 중 어느 구성 요소의 결함인지 확정하지 않습니다.','FC 벤더 코드의 공식 의미는 미등록이며 종료 메시지·양방향 패킷 기록과 구간별 동기화 자료가 필요합니다.']
 }));
 const shortlisted=[...priorities.slice(0,termination.length?2:3),...termination];
 return {
  schemaVersion:'candidate-independent-review-v1',label:'근거 규칙 검토',
  method:'전체 MDT POT·날짜·대역·EARFCN을 대조하고, 희소 표본을 제외한 RSRP 양수 꼬리의 인접 구간과 실제 RTP 중단 종료 원문을 조사 대상으로 추립니다. Qwen 응답을 사용하지 않습니다.',
  reviewed:{mdtTargets:grids.length,terminationTargets:targets.filter(target=>target.kind==='termination-group').length,radioTargets:targets.filter(target=>target.kind==='call-radio').length,prioritizedTargets:new Set(shortlisted.flatMap(item=>item.targetIds)).size,zeroTailTargets:grids.filter(target=>tails(target).length&&tails(target).every(value=>value===0)).length,sparseTargets:grids.filter(sparse).length},
  priorities:shortlisted,
  limitations:['정상 비교군과 통화 저하 시각의 정합이 없으면 원인·지역 불량률·망 변경 필요성을 확정할 수 없습니다.','기준 이하 비율 결측·희소 표본·일반 BYE·미등록 FC만 있는 관측은 우선 원인 후보로 만들지 않습니다.',...(areas.length>priorities.slice(0,termination.length?2:3).length?['모든 대상을 검토한 뒤 제한된 조사 순서만 표시했습니다. 표시 밖의 관측이 정상이라는 뜻은 아닙니다.']:[])]
 };
}
module.exports={buildIndependentReview,buildMdtObservationGroups};
