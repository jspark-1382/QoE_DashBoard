# 분석가 UI 조사 도구 개선 Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for independent UI tasks and an independent integration review. The user approved the six UI proposals with ‘적용 해줘’ on 2026-10-26.

**Goal:** 읽기 쉬운 구역·조사 맥락·지도 범례와 문제 시점 탐색, 건수/비율 비교, 작업 공간 전환을 실제 분석가 화면에 반영한다.

**Architecture:** 기존 데이터·위치 모델과 전체 집계 의미를 유지하고 UI 파생 상태만 추가한다. 현황 컴포넌트, 계약/시간축 컴포넌트, 지도와 공통 표시 규칙의 소유권을 나눠 병렬 구현한다.

**Tech Stack:** 기존 React/TypeScript/Leaflet, CSS modules, Node 회귀 검사, 실제 브라우저 검증.

**Spec:** `docs/superpowers/specs/2026-10-24-qoe-analyst-ui-design.md` 및 2026-10-26 승인된 채팅의 여섯 UI 개선 항목.

## Constraints and rulings
- Ruling: 기존 `codex/analyst-workspace`를 계속 사용한다. 작업 시작은 clean `cdb2d5c`이며, 현재 체크아웃의 Git 제외 원본·파티션·로컬 미리보기를 유지해야 한다.
- 위치 모델·품질 분모·저품질 임계값·원본 좌표·계약번호는 이번에 바꾸지 않는다. 의심 GNSS와 보정된 불확실성은 별도 위치 품질 계획에서 처리한다.
- 실제 행정동/도로명을 추측하지 않는다. 기존 지리명이 없으면 안정적인 ‘조사구역 N’ 별칭을 제공하고 내부 격자 ID·중심 좌표는 상세에 남긴다.
- 지역/시간 조사와 표시 모드는 전체 통화 분모를 조용히 바꾸지 않는다. 건수/비율 전환은 같은 시간대 분모를 사용하며 평가 없음은 0%와 구별한다.
- 시간축의 ‘조건 위반’과 ‘셀 변경’은 관측 탐색이며 원인/장애 판정으로 표시하지 않는다. 차트 원래 단위, 원본 sampleIndex, 결측·공백의 선 끊기를 유지한다.
- 지도 이동은 명시 선택/보기 조작에만 반응하고 일반 시점 이동이 기존 확대 범위를 계속 초기화하지 않게 한다.

## Ownership and interfaces
- Overview: `quality-overview.tsx`, `quality-overview.module.css`, 신규 별칭/시간대 표시 helper와 전용 검사. 구역 별칭, 상단 조건줄, 구역 선택 지도 이동, 건수/비율 전환, 지도/목록 중심 보기.
- Contract: `contract-workspace.tsx`, 해당 CSS, `radio-timeline.tsx`, `observation-details.tsx`, 신규 탐색 helper와 전용 검사. 시간축 확대/조건·셀·공백 이동, 패널 폭/접기, 핵심 근거와 원본 대조 그룹.
- Root/map: `analyst-map.tsx`, 해당 CSS, `lib/analyst/map.ts`. `focusTarget?:{key:string;lat:number;lon:number}` prop으로 명시 구역 이동 제공. `getMetricLegend(metric,threshold)`는 `{kind:'poor'|'other'|'missing',label:string,color:string}[]` 반환. 기존 metricColor 판정과 동일 규칙을 공유한다. 계약 UI가 이 helper로 숫자 범례를 렌더링한다.
- 현황 비율 색상은 기존 지도 단계와 정확히 맞춘다: 0%/평가 불가 회색, >0–<10%, 10–<25%, ≥25%. 임의 연속 색상처럼 보여주지 않는다.

## Pre-flight
- Overview의 focusTarget ↔ 지도 신규 prop: 같은 이름/좌표형을 사용한다.
- Contract의 숫자 범례 ↔ map helper: 임계값/결측 정의를 공유하고 기준을 변경하지 않는다.
- 시간축/근거 ↔ 상위 선택 상태: 원본 index 콜백을 유지한다. 탐색 중 통화 밖으로 이동하지 않는다.
- 독립 파일 소유권 밖 수정은 root와 조율하고, 모든 에이전트는 커밋 없이 결과를 공유한다.

## Tasks
- [x] 1. Overview: 행정명 없는 격자의 안정적 별칭과 선택/해제/목록 확대/비율의 관찰 가능한 회귀를 먼저 작성하고 실패를 확인한다. 구현 후 현황 검사와 기존 집계 회귀를 통과시킨다.
- [x] 2. Contract: 긴 통화의 조건/셀/공백 탐색과 시간 범위 확대의 실패 검사를 작성한다. 같은 원본 관측을 지도·차트·근거에 유지하고, 공간 전환·근거 그룹을 구현한다.
- [x] 3. Map: 숫자 범례가 실제 색상 경계/결측과 일치하는 실패 검사, 명시 이동과 평상시 viewport 보존 검사를 작성한다. 지도 포커스 API와 선택 관측 보기 조작을 구현한다.
- [x] 4. Integrate: 관련 검사 전체, 실제 데이터 대조, 타입/변경 UI 정적 검사, 제품 빌드를 실행한다. 1920/1366에서 원본 검색·현황 조사·상세 복귀·긴 통화 탐색·지도 이동·새 보기 모드를 브라우저로 확인한다.
- [x] 5. Independent review: 기능 누락, 시간/셀 탐색 경계, 결측 비율, 표시 범위와 전체 분모, 접근성·작은 화면·선택 상태·지도 수명주기를 독립 검토하고 필요한 수정을 검증한다.
- [x] 6. Document and save: 실제 결과와 캡처를 기록하고 검증한 코드·계획을 로컬 기능 브랜치에 커밋한다. 데이터/고객 화면 캡처는 Git에서 제외한다.

## Progress ledger
- 2026-10-26: 승인된 UI 후속 개선 시작. 기존 위치 품질 설계는 제안 상태로 유지한다.

- Implementation: stable full-day aliases, persistent investigation controls, same-color numeric legends, explicit region/observation map focus, hourly count/rate with missing denominator, list expansion, contract focus/rail controls and grouped evidence implemented.
- Timeline review repair: full-call navigation remains available outside the zoom window; actual timestamps handle midnight. Meaningful RED→GREEN regressions verify original index and window recentering.
- Independent review: original zoom navigation P2 repaired and rechecked; accessible rate/unknown labels also repaired with failing/passing assertions. No unresolved material findings.
- Browser acceptance: real Edge at 1920×1080 and 1366×768; aliases, area focus, scope/global totals, rate/empty hours, expanded list, return with filters, zoom, original-index condition navigation, layouts and evidence/numeric legend passed; browser errors 0. Captures in ignored outputs/analyst-ui/browser-2026-10-26.

- Final verification: analyst regression suite and current actual-data reconciliation passed; TypeScript without incremental output and scoped type-aware lint passed; fresh product build passed. Existing browser acceptance also passed search/inline measured source/late response/no-event calls/renderer stability with zero errors. No original data, denominator, or estimation model changes. Only UI-owned files and documentation are saved in the local commit.
