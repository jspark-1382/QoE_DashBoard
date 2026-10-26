# Quality overview original chart implementation plan

> **For agentic workers:** Use subagent-driven-development for the independent analytics and chart units, then verify the integrated app.

**Goal:** 승인된 새 배치를 유지하며 원본의 분포 막대/히스토그램과 색상 아이콘/미니 추이를 실제 데이터로 구현한다.
**Architecture:** 기존 React/CSS modules/Leaflet와 사전 생성 overview를 확장한다. 작은 순수 집계 모듈과 분포/체감 전용 컴포넌트를 추가하고 기존 조사 필터·지도·목록에 연결한다.
**Tech Stack:** TypeScript, React, CSS modules, native SVG, existing lucide-react, current Node data builder. 새 의존성 없음.
**Spec:** `../specs/2026-10-26-quality-overview-chart-layout-design.md`, 사용자 후속 승인: '제안한 배치는 유지하고 그래프 모양·색상을 원본처럼 구현'.

## Global constraints
- 상단 요약 / 분포32%·시간대44%·체감24% / 지도70%·구역30% / 전체 폭 목록의 배치를 유지한다.
- 원본처럼 MOS 양호 녹색(4 이상)·보통 노랑(3.5 이상 4 미만)·불량 빨강(3.5 미만), 분포 구성비+히스토그램, 보라/주황/빨강 체감 카드와 실제 시간대 미니 막대를 구현한다.
- MDT QoE에 MOS 4/3.5 등급을 적용하지 않는다. QoE는 기존 저품질2.5와 기준 이상 두 구간이며 MOS 제공 자료에서만 MOS를 선택할 수 있다. 선택 지표는 평균·분포·저품질·지도·목록에 일관되게 적용한다.
- 모든 집계는 고유 통화 ID 기준이며 평균은 통화별 동일 가중이다. 미평가 제외 분모, 위치 없는 저품질, 구역 간 중복 의미를 보존한다.
- 비교일 데이터 없는 전일 대비나 임의 예시 추이를 넣지 않는다. 미니 차트는 해당 일자의 시간대별 실제 집계다. 종료 분류 사전이 없으면 비정상 종료는 미분류로 표시한다.
- 원본 QoE/위치 모델·상세 좌표를 변경하지 않는다. 상세 일괄 다운로드 없이 사전 overview 필드를 확장한다. 고객 캡처/생성 데이터는 Git에서 제외한다.

## Shared interfaces
`lib/analyst/overview-analytics.ts` exports:
- `ScoreMetric = 'qoe' | 'mos'`; `ScoreBand = 'good' | 'fair' | 'poor'`; `ExperienceGroup = 'affected' | 'repeat' | 'consecutive'`.
- `OverviewAnalytics {metric:ScoreMetric; threshold:number; total:number; evaluated:number; unscored:number; average:number|null; outOfRange:number; bands:{id:ScoreBand;label:string;count:number;percent:number|null;color:string}[]; bins:{from:number;to:number;count:number;color:string;band:ScoreBand}[]; experience:{id:ExperienceGroup;label:string;count:number|null;total:number;percent:number|null;customerIds:string[];hourly:number[]|null}[]; termination:{count:number|null;rate:number|null;unknown:number}}`.
- `projectOverviewMetric(overview:AnalystOverview,metric:ScoreMetric):AnalystOverview` creates a nonmutating analysis view with selected score in `qoe`; raw MOS remains available, original input never mutates.
- `getOverviewAnalytics(calls:OverviewCall[],metric:ScoreMetric,threshold:number):OverviewAnalytics` handles de-duplication/finite/empty; MOS threshold3.5; current QoE threshold passed unchanged. Bins quarter-point over0..5, exact5 last; finite outside-domain values counted in outOfRange rather than silently lost. MOS validity1..5, QoE preserves existing finite-score semantics.
- `QualityDistribution({analytics,selectedBand,onBandSelect})`; `CustomerExperience({analytics,selectedGroup,onGroupSelect})` from new matching components. Both aria labeled and CSS isolated. Selecting a band/group toggles an investigation filter, not global scope.

## Tasks
- [x] **1 Analytics/data** — Own new overview-analytics.ts/test, types.ts, data.ts, overview.ts, and relevant builder/loader tests as needed. Add optional original full start timestamp/MOS/termination fields to overview, normalize full timestamp without changing clock seconds/model. Preserve unknown timestamps. Repeated means ≥2 poor calls; consecutive means ≥2 adjacent poor calls in full chronological scope, null score breaks, equal/unknown start ordering is withheld conservatively. Missing chronology gives null availability, not fakezero. Experience mini series are hourly qualifying counts (tooltip states within-hour aggregation); figures overlap and are not summed. Write meaningful RED/GREEN for de-dup/MOSbounds/thresholds/missing/means/bins/chronology. Root runs actual overview generation after integration.
- [x] **2 Original visual charts** — Own quality-distribution.tsx/CSS, customer-experience.tsx/CSS, new SSR chart test. Use the shared exact interface. Composition widths equal actual percentages, small labels below legend when segment narrow. Native SVG histogram red/yellow/green by actual metric bands, axes/tooltips/accessibility. Three compact original-style colored experience tiles with icons, values, percent, real hourly mini columns and accessible band/group buttons. Unknown has placeholder and no fakechart. Row stays within about200~230px, fit320px-wide experience panel. No top summary editing. Parent integrates these components.
- [x] **3 Integration** — Root owns quality-overview.tsx/CSS, dashboard filter URL plumbing, package test command and affected UI regressions. Approved 5-column top summary, metric selector, new three-chart row; move original hourly chart into middle. Implement scoreBand and experience query filters, visible removable tags, reset/pagination/back behavior, combined scope for map/rank/list while top summary and charts retain whole-scope denominators. Existing day/source/time/late-response protections remain.
- [x] **4 Verification/review** — Rebuild published overview (new analytics contract marker for older payload detection/cache) and verify unchanged QoE totals. Full analyst tests/type/lint/build, source-backed browser QA at1920/1366/mobile, band/group/metric/filter reset and contract navigation. Independent review/fix, record evidence, local commit.

## Review focus
- MDT never masquerades as MOS; all-null/missing MOS and out-of-range handling.
- Global denominator stays stable across combined band/group/hour/cell selections, missing-location shortcut resets conflicting conditions.
- Same customer/id duplicate, unknown score, equal/invalid timestamp, chronological order versus ID order.
- Real miniature trends and percentage widths, empty data versus real zero, no invented previous-day comparisons.
- Existing URL query defaults/Back/forward/source/date, no all-customer detail requests in overview, responsive chart/card overflow.

## Ledger / preflight
- Base `9e6fd41`, branch `codex/analyst-workspace`. Only untracked approved draft spec at task start; include it with this task.
- Ruling: use existing isolated feature checkout with ignored local data/server rather than create a new checkout.
- Ruling: data and visual units work concurrently in disjoint files; root alone owns integration/shared overview CSS.
- Preflight task1→task2: exact OverviewAnalytics props/type contract above; component missing type initially allowed until task1 completes. Task1/2 internal RED/GREEN and no conflicting ownership.
- Preflight task1→task3: original input immutable, selected metric cloned analysis view, optional fields preserve older inputs; root rebuilds once.
- Preflight task2→task3: root imports named components/props exactly, dedicated CSS avoids existing chart overrides.
- Preflight task3→task4: URL schema and data contract marker must be validated together; no changes to primary QoE/position model.

## 완료 기록
- 공유 집계 14개 회귀와 원본 스타일 차트 SSR 회귀를 추가했다. 분포 구성비는 실제 너비를 사용하며 0과 미제공을 구분한다. 계약 경험·반복·연속은 겹치는 집단이고 미니 막대는 시간 내 고유 계약 집계다.
- source→normalize→overview에 MOS·검증된 전체 시작 시각과 종료 원본 필드를 전달했다. analyticsVersion 마커를 생성/검증하고 오래된 overview를 거부하며 조회 캐시 계약도 갱신했다. 브라우저에서 고객 상세 전체를 내려받지 않는다.
- MDT와 실측 overview를 재생성했다. MDT는 총25,548 / 평가23,085 / 미평가2,463 / 저품질2,583 / 영향계약1,781로 기존 QoE 집계와 일치한다. 반복 불량은431계약이다. 실측 2026-07-14의 실제 MOS는524통화 중520건이며 평균4.40, 3.5미만0건으로 확인했다. 원본 모델과 좌표는 변경하지 않았다.
- 독립 검토의 두 P2(미제공 연속 필터가 전체를 보여주는 문제, MOS 없는 자료의 남은 보통 구간)와 P3(전체 위치 없음 버튼의 시간 조건 잔존)를 RED→GREEN으로 수정했다. 미제공 집단은 조사 보류 안내, 지원되지 않는 MOS는 QoE와 종속 조건 정상화, 전체 바로가기는 시간도 해제한다. 13개 통합 회귀와 재검토 통과, 잔여 지적 없음.
- 최종 test:analyst / 타입 / 분석 화면 정적 검사 / 실제 MDT 집계 회귀 / 프로덕션 빌드를 통과했다. 계약 상세의 기존 QoE·관측 index·위치 모델 검사도 전체 회귀에 포함된다.
- CUA 실제 브라우저: MDT 두 구간/경험·반복 실제 미니 막대, 색 구간+반복 조건 교차와 전체 분모 유지, MOS 3색 범례·유효 분모·3.5기준, 지원되지 않는 MOS URL 복구, 전체 위치 없음 바로가기, 통화 분석 이동/뒤로 조건 복원, 1920/1366 같은 높이3열,390가로 넘침 없음, 구성비 실제 너비를 확인했다. 임시 크기 설정을 해제하고 품질 현황을 열어 뒀다.
- 최종 실제 캡처와 브라우저 기록은 무시되는 outputs/analyst-ui/overview-original-charts-1366.png 및 overview-charts-browser-results.json에 저장했다. 생성 이미지와 고객 데이터/캡처는 커밋 대상에서 제외한다.
- 종료 코드 사전 미설정으로 비정상 종료는 미분류, 전체 통화 순서가 모호하면 연속 불량은 미제공으로 표시한다. 미제공을0이나 예시 그래프로 바꾸지 않는다.