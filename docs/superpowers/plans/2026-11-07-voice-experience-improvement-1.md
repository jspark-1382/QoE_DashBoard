# 음성 체감지표 개선 1안 Implementation Plan

> **실행 기준에서 제외된 이전 계획:** 독립 화면 구현은 사용자의 품질 현황 개선 의도와 달랐습니다. 이후 작업은 [수정 개발 계획](2026-11-07-quality-overview-improvement-1-revision.md)을 따릅니다. 아래 실행 지침은 이력 보존용입니다.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 현황과 기존안을 보존하면서, 기존안 바로 오른쪽의 개선 1안에서 같은 조건의 후보·수집률·고객 통화를 비교한다.

**Architecture:** 새 라우트와 전용 분석/화면 모듈을 추가한다. 기존 로더·MOS/시간/위치검토를 읽기 전용 재사용하고, 신규 로컬 배치에서 위치 근거와 후보를 별도 출력한다. 기존안 셸의 변경은 공통 비교 조건을 탭 링크에 전달하는 범위로 제한한다.

**Tech Stack:** 기존 React 19.2.6, TypeScript 5.9.3, Vinext, CSS Modules, Leaflet, Node 내장 테스트, Python 및 기존 NumPy/scikit-learn. 새 서버·AI 모델·외부 서비스는 단기 전제에 포함하지 않는다.

**Spec:** [개선 1안 설계](../specs/2026-11-07-voice-experience-improvement-1-design.md). 보고서의 참고 지시와 사용자의 변경 요청을 구분한다. 단기 구현을 실행했으며 검증 결과와 범위 판단은 [개발 기록](2026-11-07-voice-improvement-1-progress.md)에 정리했다.

## Global Constraints

- 현재 `품질 현황`과 `기존안`의 본문·집계·기본 진입 화면을 유지한다.
- 상단 `기존안` 탭 **바로 오른쪽**에 표시명이 정확히 `개선 1안`인 탭을 신설한다.
- 신규 내부 경로는 `/overview-improvement-1`, 신규 활성 탭 값은 `improvement1`이다.
- 기존 기본 `/` 라우트와 과거 경로의 의미를 유지하며 삭제된 `/overview-proposal-1/2/3`을 복원하지 않는다.
- 기존 후보/overview/voice JSON과 원본 Excel은 덮어쓰지 않는다.
- 새 지역 후보 입력은 원본 정책의 GNSS 또는 근거로 재현한 `strict-3-site-v1` 통과 위치다. BYE 단독·rough·2-Site·누락 근거 추정은 제외한다.
- 저MOS는 유효 원본 MOS(v5) `1 <= MOS < 3`; 지역 불량률과 열화 순간/원인 확정을 만들지 않는다.
- 기존안 ↔ 개선 1안의 집계 조건은 출처·원본 revision·기간·일별 시간창·MOS 기준이다. hour와 단일 고객은 상세 탐색 조건이며 상단 분모·후보 산정에 적용하지 않는다.
- 신규 산출물은 `public/voice-improvement-1/<revision>/<scopeKey>/report.json`에 분리하고 개인정보가 포함된 생성물은 기존 정책처럼 버전 관리에서 제외한다.

## Review Focus

1. 날짜 누락·중복 ID·revision 혼합을 정상 0건처럼 표시하지 않는다. Task 1/2/4에서 거부·누락 상태 테스트.
2. 실측/QoE·복수 고객·서로 대응하지 않는 지도 필터를 동일 조건이라고 표시하지 않는다. Task 1/4에서 비호환 테스트.
3. GNSS와 radio 중복, BYE·rough·필수 진단 누락이 통화 수와 활용 가능 비율을 부풀리지 않는다. Task 2에서 자격·합계 테스트.
4. 검증일·같은 고객의 재발·날짜 공백·중간 정상/미평가 통화가 반복/연속/신규 고객 판정을 왜곡하지 않는다. Task 3/5에서 테스트.
5. 100m 이웃의 연결 사슬·희소 외곽점·지도의 픽셀 묶음이 광범위 확정 불량 권역처럼 보이지 않는다. Task 3/4에서 범위·표현 테스트.

## 파일 구조와 책임

| 작업 | 신규/수정 파일 | 책임 |
| --- | --- | --- |
| 1 | 신규 `lib/analyst/voice-improvement-1/scope.ts`, `types.ts`; 수정 `quality-top-nav.tsx`, `analyst-dashboard.tsx` | 비교 조건·링크·새 탭 |
| 2 | 신규 `evidence.ts`, `coverage.ts`, `validation.ts`, `scripts/build-voice-improvement-1-input.cjs` | 위치 채택·분모·입력 계보 |
| 3 | 신규 `scripts/voice_improvement_1.py`, `scripts/build_voice_improvement_1.py`, `comparison.ts` | 후보 산정·전후 대응·산출물 |
| 4 | 신규 `app/overview-improvement-1/page.tsx`, `components/analyst/voice-improvement-1/{workspace,coverage-panel,candidate-map,candidate-panel,comparison-panel}.tsx`, `workspace.module.css`, `loader.ts` | 새 화면·조건별 결과 조회 |
| 5 | 신규 `customer-metrics.ts`, `customer-panel.tsx`, `field-evidence.ts`, `field-panel.tsx` | 기간 통합 고객 분석·현장 자료 참조 |
| 6 | 수정 `package.json`, `.gitignore`, `README.md`; 신규 테스트 및 본 설계/계획 보완 | 명령·회귀·보고 준비 |

표에서 디렉터리를 생략한 분석 모듈은 `lib/analyst/voice-improvement-1/`, 새 화면 하위 모듈은 `components/analyst/voice-improvement-1/` 아래다. 기존 본문·위치 정책 파일을 수정하는 구조로 바꾸지 않는다.

### Task 1: 기존 화면 보호와 비교 조건·탭 계약

**Files:**

- Create: `lib/analyst/voice-improvement-1/types.ts`, `scope.ts`
- Modify: `components/analyst/quality-top-nav.tsx`, `components/analyst/analyst-dashboard.tsx` (조건 전달만)
- Test: `scripts/tests/voice-improvement-1-scope.test.cjs`, `scripts/tests/quality-tabs.test.cjs`

**Interfaces:**

- `ImprovementScope = {source:'MDT', sourceRevision:string, dateStart:string, dateEnd:string, from:string, to:string, hour:number|null, metric:'mos', customerId:string|null, mode:'holdout'|'screening'}`.
- `parseImprovementScope(search:string, availableDates:readonly string[], revision:string): ScopeResult`는 `{ok:true, scope}` 또는 `{ok:false, reason:'unsupported-source'|'unsupported-metric'|'invalid-range'|'missing-date'|'revision-mismatch'}`다. 기간 미지정 직접 진입은 전체 가용 기간, `date`만 있으면 그 하루, `dateStart/dateEnd`가 있으면 해당 기간이다. 시간 미지정은 하루 전체, 지표 미지정은 MOS다. 모드 미지정은 3일 이상 holdout/1~2일 screening으로 초기화하며 명시된 비호환 값은 거부한다.
- `improvementScopeQuery(scope:ImprovementScope):string`, `legacyComparisonHref(scope:ImprovementScope):string`, `analysisScope(scope:ImprovementScope):AnalysisScope`, `canonicalScopeJson(scope:AnalysisScope, policy:CandidatePolicy):string`. `AnalysisScope`는 ImprovementScope에서 hour/customerId를 제외한 타입이다. revision은 URL의 `compareRevision`으로 전달한다.
- `scopeKey(scope:AnalysisScope, policy:CandidatePolicy):string`는 배치 CLI에서만 Node crypto로 정규화 JSON의 SHA-256 앞20자리를 계산한다. 브라우저 loader는 `canonicalScopeJson`으로 인덱스의 정규화 조건과 대조하며 Node crypto를 가져오지 않는다. 정규화 JSON의 객체 키는 재귀 정렬하고 날짜 배열은 오름차순, undefined는 제거한다.
- `QualityTopNav`에 선택 `improvementHref?:string`을 추가한다. 기존 `legacyHref`와 합쳐 양방향 링크를 제공한다. 나머지 호출자의 기본 동작은 유지한다.

- [ ] 기존 코드·기존 공개 JSON의 SHA-256과 git 상태를 `outputs/voice-improvement-1-baseline/`에 기록한다. 기존안 본문/CSS에 이미 있는 해시 검사는 유지한다.
- [ ] 테스트 작성: `기존안` 바로 뒤 `개선 1안`, 기본 라우트 유지, 삭제된 과거 제안 경로 부재, 새 활성 값, `/qoe` 중복 없음.
- [ ] 함수 테스트 작성: 5일 범위·단일일·시간·hour·단일 고객의 URL 왕복 동일, revision 불일치 거부, 날짜 누락/역전/자정 넘는 시간창 거부, 명시 실측/QoE 비호환. `date`가 기간을 덮어쓰지 않는지, hour/고객 변경은 상단 집계와 scopeKey를 바꾸지 않는지 검사한다.
- [ ] `node --test scripts/tests/voice-improvement-1-scope.test.cjs`로 새 테스트 실패를 확인한 뒤 인터페이스와 메뉴를 구현한다. SHA-256은 배치 환경에서 `node:crypto`를 사용하며 브라우저 번들에는 빌드용 해시 의존성을 넣지 않는다.
- [ ] 기존안 셸에서 `resolved`와 현재 `filters`로 새 링크를 만든다. `compareRevision`은 초기 읽기·URL 정규화·push/popstate 때 보존하고 로드한 manifest와 대조한다. 기존 `QualityOverview`의 props·필터·집계·렌더는 바꾸지 않는다. 불일치 안내는 셸의 비교 이동 영역에 둔다. 새 안의 날짜·정책을 사용자 대신 기존안 상태에 덮어쓰지 않는다.
- [ ] 위 테스트와 `npm.cmd run test:proposals` 통과 후 Task 1 파일만 별도 커밋한다.

### Task 2: 위치 근거·수집률 입력을 원본과 분리

**Files:**

- Create: `lib/analyst/voice-improvement-1/evidence.ts`, `coverage.ts`, `validation.ts`
- Create: `scripts/build-voice-improvement-1-input.cjs`
- Test: `scripts/tests/voice-improvement-1-evidence.test.cjs`, `voice-improvement-1-coverage.test.cjs`

**Interfaces:**

- `CandidatePolicy`는 version/locationPolicy 문자열과 수치 필드 epsM/minSamples/minPoorCustomers/minPoorDates/minNewCustomers/maxDiameterMultiplier를 가진다. 기본값은 `{version:'voice-improvement-1-policy-v1', epsM:100, minSamples:2, minPoorCustomers:3, minPoorDates:2, minNewCustomers:2, maxDiameterMultiplier:2, locationPolicy:'strict-3-site-v1'}`이며 민감도 진단에서 epsM만 50/100/200/300/500으로 바꾼다.
- `EvidenceCall`은 날짜·고유 callId/rawCallId·customerId·시작시각·원본 MOS·SIP 이유·`mdtLinkStatus:'unique'|'ambiguous'|'none'|'unknown'`를 가진다.
- `selectCandidateEvidence(call:EvidenceCall, gnss:OverviewCallLocation|null, day:AnalystDay|null): EvidenceDecision`은 `accepted` 위치 1개 또는 `excluded`와 사유 목록을 반환한다. accepted에는 `gnss|reviewed-radio`, 원본 위치 시각, 기준점 age, 필수 검토 진단, 원본 파일/통화 식별 계보가 포함된다.
- `buildCoverage(calls:readonly EvidenceCall[], decisions:readonly EvidenceDecision[]): CoverageSummary`는 N/M/D/G/T/U, 저MOS 부분집합, MDT ambiguous/unknown, 위치 제외 사유, 각 비율의 numerator/denominator를 반환한다.
- `validateVoiceImprovementReport(value:unknown, scope:AnalysisScope, policy:CandidatePolicy):{ok:boolean, reasons:string[]}`는 스키마·원본·조건·정책·계보와 고유 통화/집합 합계를 검증한다. 후보 수나 특정 날짜를 고정하지 않는다. 검증 실패 자료는 정상 결과로 반환하지 않는다.
- 입력 빌더는 `--public-dir --date-start --date-end --from --to --mode --out-dir`을 받는다. 입력 JSON은 정규화 scope·policy·calls·decisions·coverage·입력 파일 해시와 인벤토리 해시를 가진다. 원본 읽기 경로와 출력 경로가 겹치면 쓰기를 거부한다.

- [ ] 합성 테스트: 같은 통화에 GNSS+radio가 있어도 G=1/T=0/U=1, BYE-only·rough·2-Site·검토 근거 누락은 U=0, MDT 복수 연결은 D에서 제외, unknown은 별도, N=0 비율은 null.
- [ ] 엄격 검토 경계값·거리 포화·사이트 중복·미래/오래된 GNSS·이동범위 이탈을 검사한다. `review.accepted` 문자열/플래그만 있는 입력과 Python의 느슨한 `trilateration-reviewable`만 있는 입력은 채택하지 않는다.
- [ ] 실패 확인 후 원본 overview의 GNSS 정책을 보존하고, MDT 상세를 기존 `normalizeDay(dataset, sourceDay, 'MDT')`로 처리해 TS 엄격 검토와 최근 GNSS 이동 검사 결과를 확보한다. CLI에서는 기존 `scripts/analyst-ts-loader.cjs`의 `load()`로 순수 TS 모듈을 재사용한다.
- [ ] CDR-MDT 유일 연결은 동일 고객·날짜·raw call에 대한 기존 원본 매칭 상태와 연결 근거로 판정한다. 단순 `hasMdt`/고객 파티션 존재만으로 판정하지 않는다. 근거 없는 통화는 unknown으로 남긴다.
- [ ] 동일 revision·유효 날짜·고유 통화·원본 좌표를 검사하며 별도 입력을 작성한다. `sourceRevision` 없는 과거 screening 파일을 입력으로 채택하지 않는다.
- [ ] 두 새 테스트와 기존 `position-review.test.cjs`, `gnss-reference-fusion.test.cjs`, `date-range-analyst.test.cjs`를 실행한다. 원본 해시 불변 확인 후 별도 커밋한다.

### Task 3: 재현 가능한 후보·범위·전후 비교

**Files:**

- Create: `scripts/voice_improvement_1.py`, `scripts/build_voice_improvement_1.py`
- Create: `lib/analyst/voice-improvement-1/comparison.ts`
- Test: `scripts/tests/test_voice_improvement_1.py`, `scripts/tests/voice-improvement-1-comparison.test.cjs`

**Interfaces:**

- Python `build_report(input_document: dict) -> dict`는 `schemaVersion='voice-improvement-1-v1'`, source/해시/scope/policy, discoveryDates/validationDates, coverage, `baselineSpatialCandidates`, `improvedSpatialCandidates`, diagnostics, publicationReference를 반환한다.
- 후보는 안정 ID, 발견기간 memberCallIds, 고객 수/저MOS 통화 수/관측일 수/GNSS 채택 수, medoid, maxCenterDistanceM/maxPairDistanceM, displayRadiusM, `rangeReviewRequired`, 조사 순위, 검증 신규 고객/기존 고객 재발, 검증 상태를 가진다.
- `nearbyPoints`는 발견/검증기간 전체의 채택된 저MOS 대표점 중 발견 구성점과 eps 이내인 통화 전부를 담고 `discovery-member|validation-new|validation-existing`를 구분한다. 후보별 대표 통화 소수만으로 전체 주변 도트를 대체하지 않는다. 원본 GNSS 이동 경로는 별도 데이터로 조회한다.
- `compareSpatialCandidates(before:readonly SpatialCandidate[], after:readonly SpatialCandidate[]): CandidateCorrespondence[]`는 공통 통화 수와 양방향 겹침 비율·공간 차이를 반환한다. 겹침 0은 대응 없음이며 일대일 대응을 강제하지 않는다.
- CLI `build_voice_improvement_1.py --input <input.json> --out-dir <dir>`는 `<revision>/<scopeKey>/report.json`과 조건 인덱스를 별도 쓰고 원본 경로 쓰기를 거부한다. scopeKey는 Task 1 값과 동일하게 입력에서 전달받는다.

- [ ] Python 테스트: 통화 1개/관측 100개가 minSamples를 채우지 않음, 고객 1명/여러 통화가 고객3명을 채우지 않음, 날짜2개와 고객5명이 별도, BYE가 후보를 만들지 않음.
- [ ] 테스트: 100m 사슬로 최대거리 200m를 넘으면 `rangeReviewRequired=true`, 병합·분리 자동 수행 없음, 단독점은 noise, 입력 순서가 달라도 후보ID·조사순위 동일, 0개 후보 정상.
- [ ] holdout 테스트: 검증일은 중심/표시 범위/발견 순위에 영향을 주지 않음. 신규 집합은 `검증일 후보 이웃 고객 - 해당 후보 발견기간 저MOS 구성 고객`. 동일 기존 고객의 검증일 재발은 주변 통화에는 남고 신규에서는 제외한다. 검증점은 발견 구성점 중 어느 하나와 eps 이내이면 이웃이다. 여러 후보를 지원해도 후보별 한 번, 전체 합계는 callId/customerId 합집합으로 세는지 검사한다.
- [ ] 모드 테스트: holdout 최소3일, 마지막날 보류; screening은 전체 선택일 발견, 독립 검증 없음; 하루는 반복 지역 후보 0개와 원본 점을 제공한다. 2일 screening은 고객3명·관측일2일을 만족해야 한다.
- [ ] 실패 확인 후 GNSS-only 호환 산정과 GNSS+엄격radio 산정을 같은 조건으로 실행한다. 기본값 eps100/minSamples2와 고객/날짜 후조건을 분리하고 모든 파라미터를 결과에 기록한다. medoid는 최대 중심거리를 최소로 하는 실제 발견 구성점, 동률은 callId 순이다. 표시 반경은 `ceil(max(100, maxCenterDistanceM+20)/10)*10`m로 현행과 호환한다.
- [ ] ranking은 설계의 고객수 → 관측일 → 통화수 → GNSS수 → ID다. 범위검토 후보는 기본 순위 밖 별도 목록이다. 검증 불충족도 삭제하지 않고 상태를 표시한다.
- [ ] TS 비교 테스트: 한 후보가 두 후보와 겹칠 수 있음, 중심이 가까워도 공통 통화가 없으면 대응 없음, Cell 참고 후보를 공간 후보 합계에 섞지 않음.
- [ ] `python -B -m unittest discover -s scripts/tests -p test_voice_improvement_1.py`와 새 TS 테스트를 실행한다. 50/100/200/300/500m 민감도는 별도 diagnostics로 저장하되 정답에 맞춰 기본 반경을 선택하지 않는다.
- [ ] 실제 원본 재생성 없이 새 입력만 빌드해 현재 revision의 GNSS-only 기본 holdout 결과가 게시 공간 후보 3곳과 대응하는지 확인한다. 불일치 시 위치/시점/원본변경 이유를 기록하며 숫자를 3으로 강제하지 않는다. Cell2개는 고정 게시 조건에서만 참고한다. 원본 해시 불변 확인 후 별도 커밋한다.

### Task 4: 독립된 개선 1안 화면과 조건별 조회

**Files:**

- Create: `app/overview-improvement-1/page.tsx`
- Create: `components/analyst/voice-improvement-1/workspace.tsx`, `coverage-panel.tsx`, `candidate-map.tsx`, `candidate-panel.tsx`, `comparison-panel.tsx`, `workspace.module.css`
- Create: `lib/analyst/voice-improvement-1/loader.ts`
- Test: `scripts/tests/voice-improvement-1-loader.test.cjs`, `voice-improvement-1-ui.test.cjs`

**Interfaces:**

- `loadImprovementReport(scope:ImprovementScope, policy:CandidatePolicy, signal?:AbortSignal):Promise<ImprovementReport>`는 조건 인덱스에서 정확히 일치하는 결과를 읽고 schema/revision/집계 조건/policy/입력 해시를 검증한다. 조건 부재·HTTP 실패·버전 불일치는 서로 다른 표시 상태다.
- `VoiceImprovementOneWorkspace()`는 URL의 집계 조건을 분석 기준으로 사용하고, hour/고객/후보/표시 레이어는 상세 탐색에 사용한다. hour/고객 변경은 상단 전체 분모와 후보 산정을 바꾸지 않는다.
- `CandidateMap({candidates, nearbyPoints, selectedId, onSelect})`는 위치 근거별 마커와 후보 조사 범위를 별도 레이어로 표시한다. 기존 `AnalystMap`을 수정해 다른 화면의 동작까지 바꾸지 않는다.

- [ ] loader 테스트: 유효 0건, 미생성 조건, 누락일, 오래된 revision, 잘못된 schema, 다른 scope, 요청 취소 후 이전 결과의 덮어쓰기 방지. 기존 5일 고정 JSON으로 대체하지 않는다.
- [ ] 새 화면 테스트: N/M/D에서 G/T로 분기한 뒤 U로 통합, 실제 건수와 분모명, 비율 산출 불가 null, 전체/저MOS 구분, 후보 목록과 지도·근거 연동, 범위 검토를 확정 불량 영역으로 표시하지 않음.
- [ ] 실패 확인 후 페이지와 공통 메뉴 `active="improvement1"`, 같은 조건의 `legacyHref`를 추가한다. 주요 URL 상태를 복원하고 조건 전환 중 이전 후보를 최신 조건의 결과로 표시하지 않는다.
- [ ] 원본 GNSS/채택 추정/추가 검토/기지국 참고를 색뿐 아니라 모양·라벨로 구분한다. 화면 픽셀 묶음과 DBSCAN 후보를 구분하고, 한 표시 묶음에 서로 다른 위치 근거를 통합하지 않는다.
- [ ] 비교표에 같은 조건의 CDR 합계·공간 후보 수·제외 내역·구성 통화 차이·조사 순위를 표시한다. 과거 5후보는 조건 일치 시에만 `게시 기준선`으로 표시하고 공간3/Cell2를 구분한다.
- [ ] 브라우저에서 기존안→개선 1안→기존안, 새로고침, 뒤로/앞으로를 확인한다. 1366px·좁은 화면에서 새 탭 접근, 키보드 조작, 범례, 빈 결과를 확인한다.
- [ ] 새 loader/UI 테스트, 기존 탭/DocumentLink 테스트, TypeScript 검사를 통과하면 이 작업만 별도 커밋한다.

### Task 5: 고객의 기간 전체 통화와 현장 자료 연결

**Files:**

- Create: `lib/analyst/voice-improvement-1/customer-metrics.ts`, `field-evidence.ts`
- Create: `components/analyst/voice-improvement-1/customer-panel.tsx`, `field-panel.tsx`
- Test: `scripts/tests/voice-improvement-1-customers.test.cjs`, `voice-improvement-1-field.test.cjs`

**Interfaces:**

- `buildCustomerExperience(calls:readonly EvidenceCall[], availableDates:readonly string[]):CustomerExperience[]`는 영향 여부·poorCallCount·poorDateCount·repeatCalls·consecutiveCalls·maxConsecutivePoorDates·판정 불가 사유를 반환한다.
- `candidateCustomerCalls(allCalls:readonly EvidenceCall[], candidate:SpatialCandidate):CandidateCustomerPeriod[]`는 후보의 발견/검증 관련 고객에 대해 선택 기간 전체 통화와 구성원 여부를 반환한다. 판정에 사용하지 않는 검증기간의 기존 고객 재발도 조사 대상에 남긴다.
- `FieldEvidence = {candidateId:string, observedAt:string, audioRef:string|null, measuredMos:number|null, rfRef:string|null, result:'uncollected'|'pending'|'observed'}`. 제공된 로컬/동일 오리진 자료를 참조하고 미제공 시에는 빈 상태를 사용한다.
- `scanComparisonEligibility(reference:ScanReference, scope:ImprovementScope):{eligible:boolean,reasons:string[]}`는 기간·원본 지역/모집단·지표 정의의 일치를 확인한다. 미제공을 불일치 0건으로 취급하지 않는다.

- [ ] 예시 테스트: 고객5명/같은 날5통화는 고객5·관측일1, 같은 고객의 불량→정상→불량은 repeat=true/consecutive=false, 불량→미평가→불량도 false, 10/26·28은 최대 연속일1. 시각 누락/동일 시각은 해당 고객의 연속 판정 불가.
- [ ] 고객 목록 테스트: 후보 관련 통화 외에 선택 기간 정상/미평가도 유지, 기간 밖 제외, 다른 날짜의 동일 rawCall 구분, 미확인 고객에서 전체 고객으로 복귀하지 않음. 다른 지역의 통화에 후보 구성원 배지를 붙이지 않는다.
- [ ] 실패 확인 후 기존 SIP 11.REASON 분류와 실제 raw call 상세 링크를 재사용한다. 후보 내 A/B/C 별칭은 고객ID의 안정 순서로 부여하고 표 정렬로 바꾸지 않는다.
- [ ] 현장 자료가 없으면 `현장 자료 미확보`, SCAN 조건 불일치는 `비교 조건 미충족`으로 표시한다. 실제 녹음과 측정 MOS는 같은 측정 자료임을 검증할 수 있을 때만 함께 표시한다. 업로드/외부 전송은 구현하지 않는다.
- [ ] 새 고객/현장 테스트와 기존 `test:customer-map`, `date-range-analyst.test.cjs`를 통과시킨다. 자료가 없어도 화면을 검토할 수 있는지 확인하고 별도 커밋한다.

### Task 6: 회귀 확인과 보고 설명 완성

**Files:**

- Modify: `package.json`, `.gitignore`, `README.md`
- Update: 본 설계/계획의 실행 상태, 필요하면 과거 문서 앞부분에 이력임을 알리는 링크
- Test: `scripts/tests/voice-improvement-1-preservation.test.cjs`

- [ ] `data:voice-improvement-1`과 `test:voice-improvement-1`을 추가한다. 전자는 새 입력→새 후보만 실행하고 기존 `data:all`/`prelocal`/원본 재생성 명령에 연결하지 않는다. 신규 public 생성물을 `.gitignore`에 추가한다.
- [ ] 보존 테스트는 Task1 시점 기존 본문/스타일/원본 데이터 해시를 대조한다. 변경 허용 범위는 메뉴·조건 전달 어댑터·신규 파일과 관련 문서다.
- [ ] 구현 완료 시 아래 검사를 한 번 실행하고 결과를 기록한다. 필요한 원본 자료가 없으면 실행하지 못한 이유와 범위를 기록하고 통과로 취급하지 않는다.

```powershell
npm.cmd run test:voice-improvement-1
python -B -m unittest discover -s scripts/tests -p test_voice_improvement_1.py
npm.cmd run test:proposals
npm.cmd run test:improved
npm.cmd run test:customer-map
npm.cmd run test:mos-lab
npm.cmd run test:analyst
node --test scripts/tests/date-range-analyst.test.cjs scripts/tests/document-link.test.cjs
npx.cmd tsc --noEmit --incremental false
npm.cmd run lint
npm.cmd run build:local
```

- [ ] 현재 사용 중인 개발/미리보기 서버를 중지하거나 교체하지 않는다. 화면 확인은 미사용 로컬 포트/별도 출력으로 하고, 기존 `dist` 사용 중이면 빌드 출력을 분리한다. 기존 미리보기 방법은 `docs/qoe-local-start.md`를 확인한다.
- [ ] 원본 해시 불변, URL 왕복, 비교 합계 일치, BYE/rough 입력0, 자료 없음 상태를 최종 확인한다. 별도 리뷰에서 설계의 R01~R12와 인수 기준을 대조한다.
- [ ] 보고 자료에 같은 조건의 기존안/개선 1안, 공간 후보와 Cell 참고의 구분, 분모, 채택/제외 이유, 현장/외곽/SCAN 검증 상태를 남긴다. 후보 수 감소를 품질 향상률로 환산하지 않는다.
- [ ] README에 새 탭·정확한 신규 경로·기존 화면 유지·조건별 후보 재산정을 설명하고, 이력 문서와 현행 화면 설명이 섞이지 않도록 링크한다. 최종 차이를 확인하고 커밋한다.

## 착수 순서·공수와 중장기 별도 작업

의존 순서는 **Task1 → Task2 → Task3 → Task4 → Task5 → Task6**이다. Task1의 타입이 정해지면 Task3의 합성 테스트와 Task4의 화면 틀은 독립 준비할 수 있다. 기존 자료에 임시 연결한 화면을 정식 결과로 공개하지 않는다.

단기 계획용 공수는 개발자1명 8~12작업일이다. Task1/2 약2~3일, Task3 약2~3일, Task4/5 약3~4일, Task6 약1~2일. 자료 대기·현장 측정·연구소/외부 시스템 협의는 제외하며 확정 납기·예산이 아니다.

중장기는 단기와 분리하고 다음을 조사 산출물로 만든다.

1. **10/30초 MOS:** 원본 RTP/RTCP의 시계열·코덱·방향·시각 정밀도 확인. 하루 표본에서 재산정 가능 여부·처리 시간·저장량·MDT 동기화를 측정한다. 통화 MOS를 단순 분할·복사하지 않는다.
2. **위치 확보율:** 내부/외부 데이터별 결합키·기간·추가 고유 통화 수·중복·위치 근거·이용 조건을 확인하고 추가 확보량을 현재 N과 대조한다. 미조사 확보율을 수치로 만들지 않는다.
3. **NQI/WING:** 조회/출력 API·데이터 최소화·보관일·격자 집계·처리 부하·운영 책임 범위를 정하고 실측 행수/바이트/CPU와 필요한 작업에서 비용·기간을 추정한다. 로컬 PoC를 정식 연계 완료로 표시하지 않는다.
4. **현장/SCAN/외곽 자료:** 제공처·범위·시간 기준·대조키·확보 상태를 관리한다. 미제공 자료 대기와 단기 UI 완성·원본 보존을 구분한다.

## 계획 셀프리뷰

- R01/R03/R04/R05/R09는 Task2/3/4, R02/R07/R08은 Task4/5, R06은 Task2/4, R10은 Task5/6에 대응한다.
- R11/R12는 이번 구현 완료 조건에 섞지 않고, 원본 시계열·외부 자료·성능 실측을 출발점으로 하는 조사 작업으로 분리한다.
- 메뉴 인접·원본 보존·URL 호환은 Task1/6에서 확인한다. 지도상의 표시 묶음과 분석 후보의 구분은 Task4에서 확인한다.
- 현행 출력의 고정 후보 수/날짜를 재사용하지 않으며 엄격 3-Site가0건이어도 정상 처리한다.
- 위 체크박스는 원래 개발 순서다. 실제 구현·검증·조정 내역은 [개발 기록](2026-11-07-voice-improvement-1-progress.md)을 참조한다. 자동 커밋·외부 배포는 수행하지 않았다.
