/* eslint-disable @typescript-eslint/no-require-imports -- Local Node analysis worker. */
const SOP_VERSION='candidate-sop-draft-v7';

const PROCEDURES={
 SCOPE_CHECK:{targetKind:'members',conditionalActions:[
  {when:'Cell·시간대·위치 근거별 관측 패턴이 서로 다르면',action:'조사 범위를 분리하고 각 구간의 원인에 맞는 개선 검토 대상을 정합니다.'},
  {when:'위치·시각 근거가 부족하면',action:'저하 순간과 동기화된 실측으로 조사 위치를 보완합니다.'}
 ],verifyAfter:['보완한 위치·시각으로 동일 구간이 재현되는지 별도 관측에서 확인합니다.']},
 COMPARISON_CHECK:{targetKind:'members',conditionalActions:[
  {when:'동일 기간·시간대·위치 정책의 정상 비교 자료를 확보하면',action:'선정 조건과 제외 사유를 기록하고 후보와 같은 정의로 비교합니다.'},
  {when:'비교 조건을 맞출 수 없으면',action:'지역 불량률을 미산정으로 유지하고 비교 자료를 수집합니다.'}
 ],verifyAfter:['보완 자료의 평가·위치·무선 확보율과 비교 집단 선정 조건을 다시 확인합니다.']},
 TIMING_ALIGNMENT:{targetKind:'members',conditionalActions:[
  {when:'저하 순간과 무선·RTP·SIP 기록의 시간 정합이 확인되면',action:'같은 통화·구간의 확인된 원인에 연결된 개선 절차를 검토합니다.'},
  {when:'시계 차이 또는 매칭 오류가 확인되면',action:'자료 연결과 시간 기준을 보완한 뒤 원인 판단을 다시 수행합니다.'}
 ],verifyAfter:['보완 후 같은 통화의 저하 구간과 근거 시각·방향이 일치하는지 확인합니다.']},
 RADIO_REVIEW:{targetKind:'radio',checkNow:['저하 시점의 통화 매칭 RSRP·SINR과 서빙·이웃 Cell·핸드오버 기록을 대조합니다.','동일 조건의 정상 관측 또는 승인된 기준으로 커버리지와 간섭 원인을 구분합니다.'],
 conditionalActions:[
  {when:'저하 구간의 커버리지 부족이 현장 측정과 정상 비교로 확인되면',action:'해당 구간의 안테나 방향·틸트 등 커버리지 설계와 실내 보완 방안을 검토합니다.'},
  {when:'저하 구간의 간섭원이 확인되면',action:'확인된 간섭원을 제거·완화하고 영향 구간의 무선 최적화 방안을 검토합니다.'},
  {when:'무선 변화가 저하 시점과 일치하지 않거나 비교 자료가 부족하면',action:'무선 원인 판단을 보류하고 동기화 측정과 다른 원인 근거를 확보합니다.'}
 ],verifyAfter:['개선 후 독립 날짜에 같은 동선·시간대·단말 조건으로 RSRP·SINR과 MOS·QoE·Drop을 함께 대조합니다.','핸드오버와 인접 구간 품질 변화 및 자료 확보율을 확인합니다.']},
 RTP_REVIEW:{targetKind:'rtp',checkNow:['RTP 원본 단위·송수신 방향·누적 또는 구간 정의를 확인합니다.','저하 시점의 방향별 손실·지터와 무선·전송 구간 기록을 대조해 영향 구간을 식별합니다.'],
 conditionalActions:[
  {when:'손실을 발생시키는 전송 구간이나 장비 장애가 확인되면',action:'확인된 오류 링크·장비를 복구합니다.'},
  {when:'품질 저하와 함께 특정 구간의 혼잡이 확인되면',action:'용량 보강·부하 분산을 검토하고 음성 QoS 적용 상태를 확인합니다.'},
  {when:'단위·방향·시간 정합 또는 영향 구간이 불명확하면',action:'원본 정의와 구간별 자료를 보완하고 패킷망 원인 판단을 보류합니다.'}
 ],verifyAfter:['개선 후 같은 방향·단위·구간 정의의 RTP와 MOS·QoE를 별도 날짜의 비교 가능한 통화에서 확인합니다.','무선 조건과 자료 확보율 차이를 함께 기록하여 변화의 해석 가능성을 확인합니다.']},
 SIP_REVIEW:{targetKind:'drop',checkNow:['Drop 원본 통화의 SIP 원인 코드와 종료 전후 메시지 흐름·발신 주체를 확인합니다.','같은 통화의 단말·무선·IMS 기록을 종료 시각에 맞춰 원인을 구분합니다.'],
 conditionalActions:[
  {when:'단말 측 종료 결함이 메시지와 단말 기록으로 확인되면',action:'검증된 패치·설정 정정 또는 단말 교체 방안을 적용합니다.'},
  {when:'무선 연결 실패가 종료 원인으로 확인되면',action:'해당 구간의 무선 연결을 복구하고 커버리지·이동성 개선 방안을 검토합니다.'},
  {when:'IMS 측 장애가 종료 원인으로 확인되면',action:'확인된 IMS 서비스·연동 장애를 복구합니다.'},
  {when:'종료 원인을 구분할 메시지 흐름이 부족하면',action:'원시 SIP와 단말·망측 동기화 기록을 확보한 뒤 원인별 조치를 판단합니다.'}
 ],verifyAfter:['복구 후 비교 가능한 별도 통화의 SIP 종료 흐름·Drop과 MOS·QoE를 함께 확인합니다.','Drop 감소만으로 전체 SIP 성공을 선언하지 않고 다른 종료·장애 근거도 확인합니다.']},
 FIELD_MEASUREMENT:{targetKind:'members',conditionalActions:[
  {when:'위치·시간·정상 비교 부족으로 가설을 구분할 수 없으면',action:'구간별 동선과 발생 시간대에 맞춰 음성·무선 동기화 측정을 보완합니다.'},
  {when:'현장 측정에서 원인이 재현되면',action:'확인된 원인에 맞는 개선 방안을 검토합니다.'}
 ],verifyAfter:['독립 측정에서 재현 여부와 실내외·동선·단말 조건 차이를 기록합니다.']},
 POST_CHANGE_CHECK:{targetKind:'members',conditionalActions:[
  {when:'개선 전후 관측 조건과 분모를 맞출 수 있으면',action:'독립 날짜의 MOS·QoE·Drop과 원인 지표의 변화를 함께 평가합니다.'},
  {when:'조건이나 자료 확보율이 달라 직접 비교가 어려우면',action:'효과 판단을 보류하고 동일 조건의 후속 관측을 추가 수집합니다.'}
 ],verifyAfter:['동일 품질 정의·시간·위치 정책과 정상·미평가·위치 미확보 집단의 비교 가능성을 재확인합니다.']}
};

/** Replaceable, read-only draft procedures. Model prose never supplies commands,
 * equipment settings, thresholds, step order, or completion records. */
function selectCandidateSop({candidate,comparison,coverage,summary,analysisTargets}){
 const templates=[];
 const add=(id,title,purpose,reason,materials,method,outcomes,additionalData,evidenceIds)=>templates.push({id,title,purpose,reason,materials,method,outcomes,additionalData,evidenceIds,checkNow:[...method],...PROCEDURES[id]});
 const scope=()=>add('SCOPE_CHECK','후보 범위와 위치 근거 확인','하나의 표시 원을 하나의 장애 또는 기지국 문제로 오인하지 않고 조사 구간을 정합니다.',
  candidate.rangeReviewRequired?'구성점의 분포가 넓어 범위 검토가 필요합니다. Cell·시간대·위치 종류별로 나누어 관측 패턴을 먼저 확인합니다.':'표시 원은 조사 참고 범위이므로 구성 통화의 위치 종류와 조사할 구간을 먼저 확인합니다.',
  ['후보 구성 통화와 날짜','GPS·MDT 근사 위치 구분','Cell·시간대별 집계와 지도'],
  ['구성 통화 원본을 열어 관측 시각과 위치 종류를 확인합니다.','표시 반경과 구성점 사이 최대 거리를 구분하고 Cell·시간대·위치 근거별로 구간을 나누어 봅니다.','BYE 대표 위치와 MDT 근사는 실제 품질 저하 순간의 단말 위치로 확정하지 않습니다.'],
  ['구간별 패턴이 다르면 각 구간을 별도 조사 대상으로 정합니다.','위치와 시각의 근거가 부족하면 위치를 확정하지 않고 추가 측정 단계로 연결합니다.'],
  ['저하 순간과 연결된 단말 위치·시간 기록','해당 구간의 현장 동선과 건물·실내외 구분'],['E04','E05']);
 const compare=()=>add('COMPARISON_CHECK','정상 비교 자료와 자료 충분성 확인','후보 구성 저품질 통화와 지역 전체의 정상 분모를 구분합니다.',
  comparison.status==='unavailable'?'현재 동일 지역·시각·위치 정책으로 선정한 정상 비교군이 없어 지역 불량률을 산정할 수 없습니다.':'확보된 비교군의 선정 조건과 위치 확보 편향을 검토해야 합니다.',
  ['후보 통화 집단 정의','정상 비교군 선정 조건','위치·무선 자료 확보 범위'],
  ['같은 고객의 기간 전체 통화를 지역 정상 분모로 합산하지 않습니다.','동일 기간·시간대·조사 구간과 위치 확보 정책을 적용한 평가 가능 통화의 존재를 확인합니다.','비교 조건을 맞출 수 없는 통화와 미평가·위치 미확보 통화는 별도 집단으로 남깁니다.'],
  ['조건을 맞춘 비교 자료가 있으면 선정 조건과 제외 사유를 기록하여 비교합니다.','비교 자료가 없으면 지역 불량률은 미산정으로 유지하고 비교 자료 수집을 요청합니다.'],
  ['정상 비교 통화와 위치·시간 정합 자료','동일 조건의 미평가·위치 미확보 통화 현황'],['E01','E06','E09']);
 if(candidate.rangeReviewRequired){scope();compare();}else{compare();scope();}
 add('TIMING_ALIGNMENT','품질 저하 시점과 무선·RTP·SIP 근거 대조','통화 대표값의 연관성과 실제 저하 시점의 일치를 구분합니다.',
  coverage.radioCalls&&coverage.rtpCalls?'통화에 연결된 무선·RTP 표본은 있으나 저하 순간의 정밀 시간 정합은 검증되지 않았습니다.':'무선 또는 RTP 상세 표본이 부족하여 원인별 점검 전에 자료 연결과 시간 정합을 확인해야 합니다.',
  ['원본 MOS와 저장된 QoE','통화 연결 MDT 시계열','방향별 RTP 원본 지표','SIP 원인과 호 시작·종료 시각'],
  ['대표 근거 통화 원본을 열어 자료의 시각·방향·매칭 상태를 대조합니다.','서로 건수가 같다는 이유만으로 같은 통화 집합으로 연결하지 않습니다.','RTP 단위는 원본 정의를 확인하며 임의로 백분율 또는 시간 단위를 붙이지 않습니다.'],
  ['시간 정합이 확보되면 관련 무선·RTP·SIP 점검으로 연결합니다.','시각 또는 매칭이 불명확하면 해당 인과 판단을 보류하고 동기화 자료를 요청합니다.'],
  ['품질 저하 구간의 원시 타임스탬프와 시계 오차 정의','RTP 필드의 단위·방향·집계 구간 정의'],['E02','E03','E06','E07','E08']);
 if(coverage.radioCalls>0)add('RADIO_REVIEW','연결된 무선 근거 점검','확보된 통화 단위 무선 관측이 품질 저하와 함께 나타나는지 확인합니다.',
  '매칭된 RSRP 또는 SINR 표본이 있어 대표 평균만으로 결론 내리지 않고 구간별 원시 자료를 대조할 수 있습니다.',
  ['통화 매칭 RSRP·SINR','서빙·이웃 Cell과 핸드오버 기록','정상 비교군의 같은 지표'],
  ['Cell·시각·위치 종류별로 매칭된 관측을 구분합니다.','정상 비교 또는 승인된 기준이 없으면 임의의 양호·불량 등급을 부여하지 않습니다.','배경 MDT 격자와 통화 연결 MDT를 혼용하지 않습니다.'],
  ['저하 구간과 일치하는 무선 변화가 확인되면 해당 구간의 후속 측정을 정합니다.','변화가 없거나 비교가 불가능하면 무선 원인을 확정하지 않고 다른 근거를 확인합니다.'],
  ['동일 조건의 정상 무선 관측','저하 구간 서빙·이웃 Cell 시계열'],['E05','E07','E09','E10']);
 if(coverage.rtpCalls>0)add('RTP_REVIEW','RTP 원본 지표 점검','손실·지터 관련 관측과 음성 품질 저하의 시간 관계를 확인합니다.',
  '수치형 RTP 표본이 확보되어 있으나 원본 단위와 시간 구간을 확인해야 해석할 수 있습니다.',
  ['방향별 RTP 지표와 원본 단위 정의','음성 품질 시계열','같은 통화의 무선·SIP 기록'],
  ['필드별 단위와 송수신 방향, 누적값 또는 구간값 여부를 확인합니다.','저하 시점과 수집 구간이 겹치는지 확인하고 결측을 무손실로 바꾸지 않습니다.','정상 비교가 없는 평균 차이로 패킷망 원인을 확정하지 않습니다.'],
  ['시간 관계와 정의가 확인되면 관련 구간의 추가 원본을 대조합니다.','단위 또는 구간이 불명확하면 수치의 심각도 판단을 보류합니다.'],
  ['RTP 필드 사전','정상 비교 통화의 같은 방향·구간 지표'],['E08','E09']);
 if(summary.dropCalls>0)add('SIP_REVIEW','SIP 종료·Drop 근거 점검','관측된 Drop과 종료 사유를 통화별로 구분합니다.',
  '후보 구성 통화에서 SIP Drop이 관측되어 해당 통화의 종료 흐름 확인이 필요합니다.',
  ['Drop 근거 통화 상세','SIP 원인 코드와 메시지 흐름','같은 통화의 품질·무선 관측'],
  ['Drop으로 집계된 원본 통화와 SIP 종료 사유를 대조합니다.','호 종료 위치를 품질 저하 순간의 위치로 확정하지 않습니다.','Drop 외 다른 SIP 문제의 존재 여부는 별도 메시지 근거로 확인합니다.'],
  ['원본 종료 사유가 확인되면 관련 구간의 추가 점검으로 연결합니다.','메시지 흐름이 부족하면 원인 구분을 보류하고 원시 SIP 자료를 요청합니다.'],
  ['종료 전후 SIP 메시지 흐름','단말·망측 시각 정합 자료'],['E02','E04']);
 add('FIELD_MEASUREMENT','필요한 현장 측정과 후속 확인','미확인 위치·시간·비교 근거를 보완하여 가설을 구분합니다.',
  candidate.rangeReviewRequired?'넓은 조사 권역을 구간별로 나누고 GPS·MDT 근사 차이를 확인할 후속 측정이 필요합니다.':'현재 원인 가설을 구분하려면 같은 조건의 위치·품질·무선 관측을 추가 확보해야 합니다.',
  ['조사 구간별 동선','동기화된 음성·무선 측정 계획','기존 통화 원본과 비교 조건'],
  ['범위 점검에서 나눈 구간과 발생 시간대를 기준으로 측정 구간을 정합니다.','실내외·동선·주파수·단말 조건과 측정 시각을 남깁니다.','기지국 설정 변경값이나 장비 명령은 이 초안에서 생성하거나 실행하지 않습니다.'],
  ['가설을 구분할 근거가 확보되면 관측 사실과 미확인 항목을 다시 정리합니다.','재현되지 않으면 측정 조건 차이와 남은 공백을 기록하고 원인을 확정하지 않습니다.'],
  ['실측 위치와 음성 품질의 동시 기록','비교 조건을 맞춘 정상 관측'],['E04','E06','E09']);
 add('POST_CHANGE_CHECK','개선 후 검증 방법','발견에 사용한 자료와 별도의 후속 관측으로 개선 여부를 확인합니다.',
  candidate.validationDates.length?'별도 평가 자료의 조건과 신규 고객 관측을 구분하고 후속 개선 검증 조건을 맞춰야 합니다.':'별도 검증일이 없어 같은 발견 자료로 개선 효과를 검증할 수 없습니다.',
  ['개선 전 분석 조건과 원본 버전','별도 날짜의 비교 가능한 관측','정상 비교군 선정 조건'],
  ['동일한 QoE·MOS·Drop 정의와 시간·위치 정책을 적용합니다.','후보 구성 통화 수 감소만으로 지역 불량률 개선을 단정하지 않습니다.','별도 검증일과 충분한 위치·무선 근거를 확보하고 자료 확보율 변화도 함께 확인합니다.'],
  ['비교 조건을 충족하면 관측 변화와 한계를 함께 보고합니다.','조건이나 자료 확보율이 다르면 직접 비교를 보류하고 추가 자료를 수집합니다.'],
  ['개선 후 독립 날짜의 관측','비교 가능한 정상·미평가·위치 미확보 집단'],['E01','E09','E11']);
 if(Array.isArray(analysisTargets)){
  const common=templates.filter(t=>['COMPARISON_CHECK','TIMING_ALIGNMENT','POST_CHANGE_CHECK'].includes(t.id));
  const gridTargets=analysisTargets.filter(t=>t.kind==='mdt-grid');
  const shared=gridTargets.length?[mdtCategorySop('coverage',gridTargets)]:[];
  const criteria=analysisTargets.filter(t=>t.kind==='call-criteria');
  const ruleSteps=['coverage','interference','mobility'].filter(category=>criteria.some(target=>target.allowedCauseCategories.includes(category))).map(category=>criteriaCategorySop(category,criteria.filter(target=>target.allowedCauseCategories.includes(category))));
  templates.splice(0,templates.length,...analysisTargets.filter(t=>['termination-group','call-radio'].includes(t.kind)).map(targetSop),...shared,...ruleSteps,...common);
 }
 return {version:SOP_VERSION,status:'draft',notice:'회사 승인 절차가 아닌 조회용 점검 SOP 초안입니다. 조치 실행과 완료 이력은 관리하지 않습니다.',templates};
}
function criteriaCategorySop(category,targets){
 const descriptions={
  coverage:['DL·UL 원본 측정의 커버리지 확인','해당 통화에서 실제로 충족된 DL RSRP 또는 원본 PHR 기준의 관측 시각을 음성 시계열과 대조합니다.','같은 조건의 정상 통화, 송신전력·경로손실과 PHR 단위를 확인합니다.'],
  interference:['동일 주파수 셀 중첩 검토','같은 EARFCN의 서빙 PCI 또는 Cell-ID가 A→B→A로 돌아온 시각과 RSRP·RSRQ를 조사합니다.','현장에서 서빙·이웃 셀을 동시에 측정하고 이동 경로와 부하에 따른 차이를 대조합니다.'],
  mobility:['셀·주파수 전환 시각 확인','연속 EARFCN 변경 또는 반복 서빙 PCI·Cell-ID 전환의 직전·직후 시각을 RRC 요청·완료·실패 로그와 대조합니다.','동일 통화 음성 시계열로 전환 영향을 확인하고 다른 통화의 Drop을 결합하지 않습니다.']
 };
 const [title,first,second]=descriptions[category],checkNow=[first,second];
 const conditionalActions=[{when:'동기화 원본과 정상 비교로 해당 원인과 영향 구간이 확인되면',action:'확인된 원인·구간에 한정해 담당자의 개선 절차를 검토합니다.'},{when:'측정 정의·시각·원인 근거가 부족하면',action:'원인 확정과 망 변경을 보류하고 누락된 원본을 확보합니다.'}];
 const verifyAfter=['별도 날짜에 동일 기준·구간·단말 조건을 맞춰 무선·음성 품질을 비교하고 자료 확보율 차이를 기록합니다.'];
 return {id:'RULE_'+category.toUpperCase()+'_REVIEW',causeCategory:category,targetKind:'radio',title,purpose:'원본 관측 기준과 원인 추정을 구분해 확인합니다.',reason:'실제 기준을 충족한 통화의 원인 후보를 구분합니다.',materials:['연결 통화의 원본 무선 시계열','동기화 음성 품질 및 서빙·이웃 셀 기록'],method:checkNow,outcomes:conditionalActions.map(row=>row.when+' '+row.action),additionalData:['정상 비교 통화','동일 시각 동기화 원본과 측정 필드 정의'],evidenceIds:[...new Set(targets.flatMap(target=>target.evidenceIds))],checkNow,conditionalActions,verifyAfter};
}
function mdtCategorySop(category,targets){
 const coverage=category==='coverage';
 const checkNow=coverage?[
  '선택된 POT와 같은 날짜·대역·EARFCN 인접 POT의 RSRP ≤ -100 비율과 집계 가중치를 비교합니다. PHR 평균은 개별 측정 횟수·비율이 아니며 단위·실제 유효 분모는 미확인입니다.',
  '해당 구간의 실측 서빙·이웃 셀 신호를 확인하고 다른 날짜에도 음영이 반복되는지 대조합니다.'
 ]:[
  '선택된 POT와 같은 날짜·대역·EARFCN 인접 POT의 RSRP·RSRQ를 함께 비교합니다.',
  '동일 시각의 SINR·서빙/이웃 PCI와 셀 부하를 확보해 중첩·간섭과 부하 영향을 구분합니다.'
 ];
 const conditionalActions=coverage?[
  {when:'같은 POT·대역의 음영이 독립 실측에서 재현되고 담당 셀이 확인되면',action:'해당 셀의 커버리지 설계·실내 보완 방안을 검토합니다.'},
  {when:'재현되지 않거나 표본이 부족하면',action:'같은 POT·대역을 재측정하고 망 변경 판단을 보류합니다.'}
 ]:[
  {when:'동시 실측으로 간섭원 또는 과도한 셀 중첩이 확인되면',action:'해당 셀들의 커버리지·PCI 계획과 간섭 완화 방안을 검토합니다.'},
  {when:'낮은 RSRQ가 부하 변화에 연관되면',action:'해당 시간대의 부하 분산 방안을 검토합니다.'}
 ];
 const verifyAfter=['별도 날짜에 같은 POT·대역·EARFCN과 측정 조건을 맞춰 무선 지표와 음성 품질을 비교합니다.'];
 return {
  id:coverage?'MDT_COVERAGE_REVIEW':'MDT_INTERFERENCE_REVIEW',
  causeCategory:category,targetKind:'radio',title:coverage?'선택 POT 커버리지 확인':'선택 POT 셀 중첩·간섭 확인',
  purpose:'AI가 선택한 POT의 실제 관측으로 해당 원인을 구분합니다.',
  reason:coverage?'기준 이하 신호 비율과 인접 POT 차이를 대조합니다.':'RSRP·RSRQ 차이와 동시 셀 관측을 대조합니다.',
  materials:['선택 POT·대역의 MDT 원본','실측 서빙·이웃 Cell 및 동시 품질 자료'],
  method:checkNow,outcomes:conditionalActions.map(v=>v.when+' '+v.action),
  additionalData:['동일 구간의 독립 날짜 측정','서빙·이웃 셀 및 부하 기록'],
  evidenceIds:[...new Set(targets.flatMap(t=>t.evidenceIds))],checkNow,conditionalActions,verifyAfter
 };
}
function targetSop(target){
 const grid=target.kind==='mdt-grid',termination=target.kind==='termination-group';
 const subject=grid?target.title:termination?target.title:'동일 통화·Cell·주파수 관측 구간';
 const observedCodes=target.metrics.filter(m=>['fcRaw','byeReasonRaw','reasonRaw','releaseCauseRaw'].includes(m.label)&&m.value!==null).map(m=>({fcRaw:'FC',byeReasonRaw:'BYE',reasonRaw:'REASON',releaseCauseRaw:'종료'}[m.label])+': '+m.value).join(' · ');
 const timeout=target.metrics.some(m=>m.value!==null&&/RTP timeout|Rx_RTP_middle_Loss/i.test(String(m.value)));
 const checkNow=grid?[
  subject+'의 원본 O열 집계 가중치와 지표별 유효 분모 미확인 상태를 구분하고 RSRP ≤-105/≤-110 비율, RSRQ·PHR 분포를 날짜·대역·EARFCN별로 원본과 대조합니다.',
  '동일 POT의 같은 날짜 다른 대역과 독립 날짜 측정을 비교하고 약신호 구간이 지속되는지 현장 음성·무선 동기화 측정으로 확인합니다.',
  '실측 서빙·이웃 Cell/PCI를 확보해 커버리지와 간섭을 구분합니다. 최근접 기지국을 책임 셀로 지정하지 않습니다.'
 ]:termination?[
  observedCodes+' 관측을 같은 통화의 종료 주체 및 종료 전후 SIP 흐름과 대조합니다. 확보된 원문과 벤더 코드 의미 미등록을 구분합니다.',
  timeout?'실제 RTP timeout/수신 중간 손실 원문의 송수신 중단 시각을 단말·무선·전송·IMS 로그와 맞춰 최초 중단 구간을 찾습니다.':'실제 종료 메시지의 발신 주체·종료 요청/응답 순서와 해당 Drop 분류를 대조하고, 코드만으로 장애를 추정하지 않습니다.'
 ]:[
  '같은 통화·Cell·주파수의 RSRP 변화 구간을 RSRQ·SINR·서빙·이웃 Cell 및 핸드오버 원시 시각과 대조합니다.',
  'QoE 저하 시각과의 시간 정합 및 동일 조건 정상 관측을 확보해 관측된 변화의 영향을 확인합니다.'
 ];
 const conditionalActions=grid?[
  {when:'해당 POT·대역의 낮은 RSRP 비율이 독립 실측에서 재현되고 커버리지 부족이 확인되면',action:'실측으로 확인된 담당 셀의 커버리지 설계·실내 보완 방안을 검토합니다.'},
  {when:'낮은 RSRQ가 동시 관측되고 간섭원·부하 영향이 확인되면',action:'확인된 간섭원 완화 또는 부하 분산 방안을 해당 대역·구간에 한정해 검토합니다.'},
  {when:'다른 날짜·대역에서 재현되지 않거나 기준별 표본이 부족하면',action:'원인 결론과 망 변경을 보류하고 해당 POT·대역을 재측정합니다.'}
 ]:termination?[
  ...(timeout?[{when:'실제 관측된 RTP 중단이 특정 전송 구간 오류와 동기화되어 확인되면',action:'확인된 링크·장비 장애를 복구하는 절차를 검토합니다.'}]:[]),
  {when:'무선 연결 실패 또는 IMS·단말 종료 결함이 동기화 원본에서 확인되면',action:'확인된 원인 구성 요소의 복구·패치 또는 무선 개선 절차를 검토합니다.'},
  {when:'원본 코드의 공식 의미나 종료 주체·시간이 불명확하면',action:'벤더 코드 사전과 동기화 메시지를 요청하고 코드만으로 원인을 확정하지 않습니다.'}
 ]:PROCEDURES.RADIO_REVIEW.conditionalActions;
 const verifyAfter=[grid?'별도 날짜에 동일 POT·대역·EARFCN·O열 가중치와 실제 기준별 유효 분모의 확보 여부를 구분해 RSRP 꼬리 비율과 RSRQ·PHR를 비교하고 동시 음성 품질을 확인합니다.':'별도 날짜의 같은 종료 유형 또는 같은 무선 관측 조건에서 종료 흐름·원인 지표와 MOS·QoE를 함께 확인합니다.','측정 수·위치·시간·단말 조건과 자료 확보율 차이를 기록하고 발견 자료를 개선 효과 검증에 재사용하지 않습니다.'];
 return {id:'TG_'+target.id,...(termination?{causeCategory:'equipment'}:target.kind==='call-radio'?{causeCategory:'coverage'}:{}),title:subject+' 점검',purpose:'실제 관측 대상에서 원인 후보를 구분합니다.',reason:target.observation,materials:grid?['날짜·POT·대역별 원본 MDT','원본 O열 집계 가중치와 지표별 실제 분모의 확인 자료','실측 서빙·이웃 Cell 및 음성 품질']:termination?['동일 종료 사유 통화 원문','종료 전후 SIP 및 단말·망측 기록']:['통화 무선 시계열','품질 저하 시각 및 정상 비교'],method:checkNow,outcomes:conditionalActions.map(row=>row.when+' '+row.action),additionalData:target.limitations,evidenceIds:target.evidenceIds,targetKind:termination?'drop':'radio',checkNow,conditionalActions,verifyAfter};
}
module.exports={SOP_VERSION,selectCandidateSop};
