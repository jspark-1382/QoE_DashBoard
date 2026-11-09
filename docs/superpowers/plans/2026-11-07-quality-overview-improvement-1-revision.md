# 품질 현황 개선 1안 수정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 현재 품질 현황의 구성과 기능을 바탕으로 개선 1안을 만들고, 같은 페이지의 원본/개선 모드를 비교한다.

**최신 수정:** 사용자 전체 화면 비교 피드백에 따라 후보 모드의 일반 KPI·수집 현황·차트 상시 유지 결정은 폐기했다. 후보 모드는 원본과 같은 조건 → 후보 요약 → 지도/목록 구성을 사용한다. 관련 통화 조사를 선택할 때만 조사 표를 표시한다. 아래 항목 중 이 기준과 충돌하는 초안 조항은 적용하지 않는다.

**Architecture:** 기존 `QualityProposalFour`에 `variant='current'|'improvement1'`을 추가한다. 화면 구성과 CSS·로더를 공유하고 개선 기능만 기존 영역에서 적용한다. 잘못 만든 독립 workspace는 새 화면의 본체로 재사용하지 않는다.

**Tech Stack:** 현재 React/TypeScript/Vinext/CSS Modules/Leaflet와 기존 로컬 데이터 로더·후보 배치.

**Spec:** [기존 품질 현황 기반 재설계](../specs/2026-11-07-quality-overview-improvement-1-revision-design.md).

상태: 단기 구현·검증 완료. [개발 기록](2026-11-07-quality-overview-improvement-1-revision-progress.md) 참조. 아래는 실행에 사용한 계획이다. 초안 작성 당시 사용자가 ‘개선 1안’에 같은 품질 현황의 개선 버전을 표시한다고 확인한 후 작성한 수정 계획. 이번 턴에서는 제품 코드를 변경하지 않았다. 이전 독립 대시보드 계획을 대체하며 아래 작업은 미실행이다.

## Global Constraints

- 개선 결과는 ‘개선 1안’에 같은 품질 현황의 개선 버전으로 표시하고 원본과 비교한다.
- 원형은 현재 `QualityProposalFour`다. 구형 `QualityOverview`가 아니다.
- KPI 4개·차트 3개·지도+행정동 순위·통화 목록·통화 모달의 기존 구성을 유지한다.
- 신규 독립 대시보드·대형 수집률 중심 화면·별도 조건 입력 폼을 만들지 않는다.
- 원본/개선 모드는 같은 컴포넌트와 CSS를 사용하고 `variant`로 개선 기능을 구분한다.
- 기간·시간·복수 고객의 공통 집계 의미는 현재 품질 현황을 따른다.
- 기존 원본 데이터·MOS·구형 기존안·원본 링크는 보존한다.
- 후보 요약은 범위당 1MB 이하로 분리하고, 207MB 전체 보고서를 초기 로딩에 사용하지 않는다.

## Review Focus

1. 원본 모드가 개선용 위치 정책이나 차트 변경의 영향을 받는지 확인한다.
2. 복수 고객이 KPI까지 좁히는 현재 의미를 새 모드에서도 유지한다.
3. 원본↔개선 전환/새로고침/뒤로가기로 필터·지도 모드가 사라지지 않게 한다.
4. 후보 미생성·오류·0건이 KPI·차트·일반 통화 목록을 숨기지 않게 한다.
5. 계산 테스트만으로 화면이 요청에 맞다고 판단하지 않고, 실제 두 모드의 화면과 조작을 비교한다.

## Task 1: 현재 화면 기준선과 같은 페이지의 비교 모드

**Files:**

- Modify: `app/page.tsx`, `components/analyst/quality-proposal-four.tsx`, `components/analyst/quality-top-nav.tsx`
- Create: `lib/analyst/quality-comparison-state.ts`
- Test: `scripts/tests/quality-comparison-state.test.cjs`, `scripts/tests/quality-tabs.test.cjs`

**Interfaces:**

- `QualityOverviewVariant = 'current'|'improvement1'`.
- `QualityProposalFour({variant='current'}:{variant?:QualityOverviewVariant})`.
- `QualityComparisonState`는 dateStart/dateEnd/from/to/customerIds/selectedBand/distributionMode/selectedHour/district/evidence/cohort/mapMode/chosenCall/sourceRevision를 가진다. customerIds는 string 배열, 나머지 상태 타입은 현재 컴포넌트의 MOS·위치·그룹 타입을 따른다.
- `parseQualityComparisonState(search:string, availableDates:readonly string[]):QualityComparisonStateResult`와 `qualityComparisonHref(state:QualityComparisonState, variant:QualityOverviewVariant):string`. 결과는 유효 상태 또는 날짜/범위 오류를 구분한다. 원본 revision은 자료 로드 후 별도로 대조한다.

- [ ] 현재 품질 현황을 날짜·시간·고객 조건별로 캡처하고, KPI·3개 차트·지도/순위·목록·팝업의 수치와 동작을 기준선으로 기록한다. 구형 `QualityOverview`의 해시 보호는 유지한다.
- [ ] 실패 테스트 작성: `/`는 기본 current, `?variant=improvement1`은 같은 컴포넌트의 개선 모드, `view=overview/contract`는 기존 경로, 메뉴 인접 순서가 정확하다. view와 variant가 함께 있으면 명시적 기존 view를 우선한다.
- [ ] 상태 왕복 테스트 작성: 복수 고객 ID의 중복 제거·선택 유지, MOS/Drop/등급/hour/행정동/근거/지도 모드 복원. 기간 변경 때 기존 초기화 의미를 유지하고 잘못된 기간/버전을 구분한다.
- [ ] 실패 확인 후 모드와 상태 전달을 구현한다. 서버 렌더에서 window를 읽지 않는다. 복원 전에 다른 날짜의 결과를 먼저 보여주지 않으며 직접 진입의 기본 날짜는 원본과 같다.
- [ ] 비교 버튼은 현재 품질 현황 current 모드를 가리킨다. 구형 ‘기존안’ 탭은 그대로 유지한다.
- [ ] Run: `node --test scripts/tests/quality-comparison-state.test.cjs`, `npm.cmd run test:proposals`. 기대: 새 테스트는 구현 전 실패·후 통과, 기존 경로/원본 데이터 검사 통과.

## Task 2: 기존 KPI와 차트 안에서 지표 설명 보완

**Files:**

- Modify: `components/analyst/quality-proposal-four.tsx`, `components/analyst/quality-proposal-four.module.css`
- Create: `lib/analyst/quality-improvement-adapter.ts`
- Reuse after adaptation: `lib/analyst/voice-improvement-1/coverage.ts`, `customer-metrics.ts`, `evidence.ts`
- Test: `scripts/tests/quality-improvement-metrics.test.cjs`

**Interfaces:**

- `buildQualityImprovementMetrics(overview:AnalystOverview, state:QualityComparisonState, evidence:QualityEvidenceIndex|null):QualityImprovementMetrics`.
- `QualityEvidenceIndex`는 date/revision/policy/censusComplete와 명확한 연결/위치 근거가 있는 통화의 희소 레코드를 가진다. 전체 연결 감사가 불완전하면 인덱스에 없는 통화를 none으로 판정하지 않고 unknown으로 남긴다.
- 결과는 기존 KPI/차트 원본 집계에 추가 coverage와 자료 누락 상태를 제공한다. 새 페이지 구조를 만들지 않는다.

- [ ] 실패 테스트 작성: 같은 기간·시간·복수 고객에서 원본/개선의 전체 통화·유효 MOS·평균·저MOS가 같다. Drop/미평가 분모가 정확하고 hour 클릭이 상단 전체 기간 KPI를 변경하지 않는다.
- [ ] 기존 KPI 4개와 차트 3개 순서를 유지한다. 수집률은 KPI 아래 작은 접기 영역에만 추가하고 원본 모드에서는 새 정보를 렌더하지 않는다.
- [ ] 고객 체감 3행을 유지하며 반복 통화/관측일/연속일의 차이를 도움말·상세에 명시한다. 정상·미평가 중간 통화를 건너뛰어 연속으로 만들지 않는다.
- [ ] Run: 새 지표 테스트, `npm.cmd run test:customer-map`, 기존 MOS/Drop 테스트. 기대: 공통 지표 일치, 신규 수집률도 현재 선택 고객 모집단과 일치.

## Task 3: 페이지에 이미 있는 지도와 후보 분석 모드 개선

**Files:**

- Modify: `components/analyst/quality-proposal-four.tsx`, `improvement-candidates.tsx`, `improvement-candidate-map.tsx`, `analyst-map.tsx`
- Create: `lib/analyst/quality-improvement-candidates.ts`
- Modify: `scripts/build_voice_improvement_1.py`의 웹용 요약/상세 출력 어댑터
- Test: `scripts/tests/quality-improvement-candidates.test.cjs`, 후보 분할 출력 테스트

**Interfaces:**

- `QualityCandidateScope`는 sourceRevision/dateStart/dateEnd/from/to/policy를 가진다. 고객 필터 중 후보 모드 비활성화라는 현재 제약을 유지한다.
- `loadQualityCandidateSummary(scope:QualityCandidateScope, signal?:AbortSignal):Promise<QualityCandidateSummary>`는 같은 조건 요약만 반환한다.
- `loadQualityCandidateDetail(summary:QualityCandidateSummary, candidateId:string, signal?:AbortSignal):Promise<QualityCandidateDetail>`는 선택 후보의 구성 통화·실제 주변 점·발견/검증·채택/제외 이유를 읽는다.
- `buildQualityScopeObservationPoints(overview:AnalystOverview, state:QualityComparisonState, evidence:QualityEvidenceIndex):QualityObservationPoint[]`는 이미 로드한 통화/위치와 근거 인덱스로 해당 범위의 채택된 저MOS 대표점을 만든다. 후보 ID나 후보 상세 파일이 필요하지 않다. 후보 0건에서도 이 경로로 관측점을 유지한다.
- 원래 후보 컴포넌트의 기본 동작은 유지하고 개선 모드에서만 새 scope/자료 어댑터를 전달한다.
- `AnalystMap`의 선택 prop `separateEvidence` 기본값은 false, 개선 모드만 true로 설정해 다른 근거를 한 마커로 합치지 않는다.

- [ ] 실패 테스트 작성: 후보 수 동적 계산, 하루 0후보여도 범위 관측점을 계산하고 후보 상세를 요청하지 않음, BYE/rough/미검토 추정의 지역 후보 제외, 검증일 누출 방지, 조건 전환 시 이전 후보의 잔류 방지. 근거 인덱스 미확보와 관측점 0건도 구분한다.
- [ ] 기존 지도/오른쪽 목록 자리와 기존 ‘개선 후보 분석’ 버튼을 개선한다. 별도 전면 workspace를 추가하지 않는다.
- [ ] 개선 모드의 후보 화면에서는 위쪽 KPI·차트와 아래 통화 목록을 유지하고 지도/오른쪽 패널만 전환한다. 원본 모드는 기존 표시를 유지한다.
- [ ] 고객 필터가 적용되면 후보 분석을 비활성화하고 이유를 표시한다. 선택 고객의 지표를 전체 고객 후보의 지표로 대체하지 않는다.
- [ ] 웹용 작은 요약+선택 후보 상세로 분할 출력한다. 전체 파일별 해시 감사는 로컬 outputs에 두고 요약에 검증 참조를 남긴다. 범위당 요약 <=1MB, 초기 로딩에서 207MB report를 요청하지 않는지 검사한다.
- [ ] Run: 새 후보/분할 테스트와 기존 position-review/지도/후보 회귀. 기대: 후보 0건·미생성·버전 오류를 구분하며 후보 오류가 일반 현황을 가리지 않는다.

## Task 4: 기존 통화 표와 팝업에 후보 조사 연결

**Files:**

- Modify: `components/analyst/quality-proposal-four.tsx`의 기존 `Table`과 통화 모달
- Reuse: `customer-metrics.ts`, `sip-reason.ts`, `buildOriginalCallLink`
- Test: `scripts/tests/quality-improvement-investigation.test.cjs`

- [ ] 실패 테스트 작성: 후보 관련 통화와 관련 고객의 기간 전체 통화는 다른 범위다. 전체 통화에 정상/미평가를 포함하고 다른 지역 통화에는 후보 구성원 표시를 붙이지 않는다.
- [ ] 기존 표 제목 옆에 ‘후보 관련 통화 / 관련 고객 전체 통화’ 범위 전환을 추가한다. 검색·SIP·CSV·더 보기·선택 통화 강조는 유지한다.
- [ ] 기존 팝업에 위치 채택/제외 이유·관측일·규칙 기반 설명·현장 자료 상태를 접기 영역으로 추가한다. 현재 위치/RTP/MDT/원본 통화 링크를 재사용한다.
- [ ] 녹음/SCAN이 없으면 팝업/후보 상세에서 미확보로 표시한다. 이를 위한 새 하단 대시보드나 예시 자료를 만들지 않는다.
- [ ] Run: 새 조사 테스트와 기존 통화 팝업/CSV/고객 원본 링크 검사. 기대: 같은 날짜/고객/raw call 연결, 정상/미평가 보존, 지도와 선택 통화 일치.

## Task 5: 잘못 만든 독립 화면 연결 정리와 비교 검증

**Files:**

- Modify: `app/overview-improvement-1/page.tsx`, `components/analyst/quality-top-nav.tsx`, `lib/analyst/improvement-navigation.ts`, `README.md`
- Modify: 기존 `voice-improvement-1` UI/해시 보호 테스트, 새 동일 화면 비교 브라우저 검사
- Stop using: `components/analyst/voice-improvement-1/workspace.tsx`와 독립 배치 CSS/전체 보고서 로더 연결

- [ ] 실패 테스트 작성: 기존 실험 주소는 같은 페이지의 개선 모드로 호환 이동하고 새 메뉴가 독립 workspace를 렌더하지 않는다. 명확히 대응하는 기간/시간/hour/customer 조건을 보존한다.
- [ ] 새 동일 화면 모드 검증 후 기존 실험 페이지 연결을 바꾼다. 참조가 없는 본 작업 신규 파일만 정리 범위에 기록하며 원본 데이터나 구형 화면을 삭제하지 않는다.
- [ ] 새로 추가했던 `quality-proposal-four.tsx` 파일 전체 해시 고정 검사를 원본 모드의 수치·동작·화면 회귀로 바꾼다. 개선 대상 컴포넌트의 편집을 막아 다른 화면을 만드는 일이 없도록 한다. 구형 `quality-overview.tsx`의 기존 해시 보호는 유지한다.
- [ ] 브라우저에서 같은 조건의 current/improvement1을 1366px/1100px/680px로 비교한다. KPI4개·차트3개·지도+목록의 구조가 같고 후보 모드에서도 현황 맥락이 유지돼야 한다.
- [ ] 새로고침·뒤로/앞으로·복수 고객·MOS/Drop·지도 전체화면·후보0/미생성·팝업·CSV·초기 네트워크 요청을 확인한다.
- [ ] Run: 새 quality-improvement 테스트 그룹, `test:proposals`, `test:customer-map`, `test:analyst`, 날짜/지도/Drop 회귀, TypeScript, 수정 파일 lint, 별도 로컬 build, 브라우저 검증. 결과를 기록한 뒤 완료를 보고한다.

## 실행 순서와 첫 확인 결과물

순서: **현재 화면 기준선 → 같은 페이지 두 모드와 상태 → 기존 KPI/차트 보완 → 기존 지도/후보 모드 → 기존 표/팝업 연동 → 전환·회귀 검증**.

가장 먼저 확인할 결과물은 **동일 조건의 현재 품질 현황/개선 1안 화면과 영역별 차이**다. 이 단계에서 같은 품질 현황의 개선 버전인지 확인하며, 알고리즘 테스트 통과로 화면 요구 충족을 대신하지 않는다.

이번 재계획 단계에서 개발을 계속하거나 기존 실험 산출물을 삭제하거나 사용 중인 서버를 변경하지 않는다. 이후 개발은 이 계획을 기준으로 하며 현장/SCAN/외곽 실측과 구간 MOS·NQI/WING 투자는 후속 자료 확보·조사 범위로 남긴다.
