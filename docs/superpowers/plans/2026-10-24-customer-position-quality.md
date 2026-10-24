# 고객 위치 추정 품질 개선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 잘못된 위치 확정과 정밀 집계를 막고, GNSS를 숨긴 독립 평가로 개선 효과를 확인할 수 있는 고객 위치 추정을 만든다.

**Architecture:** 원본 관측과 위치 품질·추정 결과를 분리한다. 같은 품질 정책과 버전 키를 상세·현황·평가에 공통 적용하며, 현재 엔진은 비교 기준으로 보존한다. 알고리즘 선택은 분리된 검증 자료에서 결정하고 잠금 테스트는 선택에 사용하지 않는다.

**Tech Stack:** 기존 TypeScript/React/Leaflet, Node/Python 데이터 도구. 1차는 새 외부 서비스·지도 엔진·학습 라이브러리를 요구하지 않는다.

**Spec:** `docs/superpowers/specs/2026-10-24-customer-position-quality-design.md`

**Status:** 검토 후 제안, 구현 승인 전. 문서 작성과 로컬 탐색 감사만 수행했으며 아래 체크박스는 앞으로의 작업이다.

## Global Constraints

- 원본 서비스계약번호 문자열, 원본 UTMK, 확인된 EPSG:5179 변환 좌표를 보존한다. 원본 자료를 수정하지 않는다.
- 통화·고객을 가로질러 관측/앵커/경로를 연결하지 않는다. 원본 IMS·통화시간 충돌이 드러나면 모델 학습 전에 입력 묶음을 먼저 바로잡는다.
- 단일 기지국 좌표를 고객 추정점으로 제공하지 않는다. GNSS 정확도 미제공은 null이며 모델상의 허용반경과 구분한다.
- 현재 출발값 200km/h·120초는 이상 징후 검사 설정이다. 이 값 아래이면 정확하다는 뜻으로 쓰지 않는다. 10초 보간은 실험 설정이며 검증 전 기본 제품 정책으로 확정하지 않는다.
- 전체 통화/평가 분모와 원본 품질 판정은 위치 적격성으로 줄이지 않는다. 위치 없음·보류·평가 불가는 별도로 유지한다.
- 현황은 고객 상세 전체를 브라우저로 받지 않는다. 좌표·계약·IMS가 있는 증거 파일은 `outputs/location-evaluation/` 등 Git 제외 경로에 저장한다.

## Review Focus

1. 동일 Cell ID를 재사용하는 다른 기지국과 명시 미매칭이 엔진에서 다시 연결되는 경우.
2. 같은 시각의 다른 좌표, 미래 앵커, 앵커 적용 뒤 생기는 순간 이동, 자정 통화와 순서가 뒤바뀐 입력.
3. 긴 GNSS 공백·단일 GNSS·GPS 없음·RSRP 없음·2사이트/일직선 배치·여러 도시의 마스터.
4. 숨긴 GNSS가 raw metadata/다른 phase/같은 timestamp 복제행/보정셋을 통해 들어가는 평가 누출.
5. 원본은 같고 모델/설정/품질 정책만 바뀔 때 현황·상세·캐시가 섞이는 경우.

## Task 1. 원본 묶음 감사와 평가 기준 고정

**Files**
- Create: `scripts/evaluate-location.cjs`, `scripts/tests/location-evaluation.test.cjs`, `docs/location-evaluation.md`.
- Reference: `outputs/location-audit/2026-10-24/audit.cjs`, `scripts/mdt_pipeline.py`, `scripts/analyst-ts-loader.cjs`.
- Modify only if source grain is proven wrong: `scripts/mdt_pipeline.py`, `scripts/test_mdt_pipeline.py`.

**Interfaces:** `evaluate-location.cjs`는 기존 파티션과 명시한 모델 설정을 읽고, `--output <dir>`에 `manifest.json`과 집계 `metrics.json`을 낸다. manifest는 원본 revision·CRS·모델/설정 해시·품질 정책·샘플링 seed·분할 해시·평가 모드·마스킹 구간을 기록한다. metrics는 공통 표본 P50/P90/P95, 60/100/300m, 커버리지·보류율, 모델별 대상 수와 고객/통화별 집계를 제공한다.

- [ ] **1. 실패 검사:** 같은 timestamp의 복제 phase에 정답이 남으면 마스킹 검사가 실패하고, 주 평가의 같은 고객이 보정·검증·잠금 테스트를 가로지르면 실패하는 fixture를 작성한다. 별도 공간 평가에서는 고객↔격자 연결 그룹의 분할 침범을 실패로 확인한다. 원본 call key의 IMS·통화시간 충돌도 집계한다.
- [ ] **2. 실패 확인:** `node scripts/tests/location-evaluation.test.cjs`를 실행해 위 동작이 아직 없음을 확인한다.
- [ ] **3. 구현:** 모든 좌표 복제 경로를 제거하는 radio-only와 5/10/30/60/120초 연속 공백 평가를 구분한다. 주 평가는 고객 hash의 60/20/10/10% fit/validation/radius-calibration/locked-test다. 별도 공간 스트레스 평가는 EPSG:5179 1km 격자·200m 완충·고객↔격자 연결 그룹을 사용하며, 거대 연결 그룹이면 공간 일반화 불충분으로 기록한다. 현재 300통화 탐색 평가를 독립 테스트로 이름만 바꾸지 않는다.
- [ ] **3a. 품질 누출 차단:** 마스킹 뒤 남은 GNSS만으로 예측 입력의 품질·앵커 적격성을 다시 계산한다. 숨긴 정답의 품질 검사는 사전에 고정한 평가 대상 선정에만 사용하며 예측기의 quality/reasons/거리 특징으로 전달하지 않는다. 이를 검출하는 복제 phase/플래그 누출 fixture를 Task 1 검사에 포함한다.
- [ ] **4. 검증:** 위 fixture PASS 후 현행 모델과 serving 기준선을 같은 표본에 실행한다. 일관성 검사 전/후 GNSS를 구분하고, 하루 데이터라는 한계를 manifest에 남긴다. 채택 기준은 검증 전에 고정한다(P90 10% 개선, P50 후퇴 ≤5%, 커버리지 후퇴 ≤5%p를 출발값으로 제안).
- [ ] **5. 커밋:** 평가 도구·합성 검사·방법 문서만 저장하고 원본 식별자/좌표가 있는 결과는 제외한다.

## Task 2. 최종 좌표 판정과 조인 오류 수정

**Files:** Modify `lib/location-estimation/adaptive.ts`, `types.ts`, `master.ts`, `lib/analyst/data.ts`; Create `scripts/tests/location-consistency.test.cjs`.

**Interfaces:** 기존 `estimateAdaptive(samples, stations, config)` 호출을 유지한다. `MdtSample`에 선택적인 `radioEvidenceEligible:boolean`을 추가한다(생략은 레거시 호환, 명시 false는 매칭 근거로 사용 금지). 위치를 주변 시각으로 추정하는 정책과 이 행의 잘못된 무선 근거 사용 금지는 구분한다. 최종 좌표 이후의 속도/잔차/기하/점프를 반환한다.

- [ ] **1. 실패 검사:** 검토의 3행 앵커 사례는 최종 속도와 반환 속도가 일치해야 한다. `UNKNOWN/cell10`은 `A/cell10`에 재매칭되지 않아야 한다. 동일 시각 충돌, gap>120초, 통화 경계를 포함한다.
- [ ] **2. 실패 확인:** `node scripts/tests/location-consistency.test.cjs`로 현행 실패를 확인한다.
- [ ] **3. 구현:** 최적화/앵커/선택적 smoothing 후 최종 좌표로 모든 판정을 계산한다. 미매칭 관측 적격성을 엔진까지 전달하고, GNSS가 있어도 잘못된 무선 근거를 유효화하지 않는다.
- [ ] **4. 검증:** 새 검사와 `node scripts/test-location-estimation.cjs`, `npm.cmd run test:analyst` PASS. 단일사이트 억제와 원본 GNSS 보존도 유지한다.
- [ ] **5. 커밋:** 계산 일관성·매칭 수정과 회귀 검사만 저장한다.

## Task 3. GNSS 품질과 추정 근거 계약

**Files:** Create `lib/location-estimation/position-quality.ts`, `scripts/tests/position-quality.test.cjs`; Modify `lib/location-estimation/types.ts`, `adaptive.ts`, `adaptive-config.ts`, `lib/analyst/types.ts`, `data.ts`, `components/analyst/observation-details.tsx`.

**Interfaces:** `assessPositionQuality(samples, policy): Map<number, PositionQuality>`를 제공한다. `PositionQuality`는 `state:'plausible'|'suspect'|'rejected'|'unknown'`, `reasons:string[]`, `anchorEligible:boolean`을 가진다. `AnalystSample`에 원본 관측 위치와 별개인 quality 및 estimation evidence를 추가한다. evidence는 `method`, `siteCount`, `windowSec`, `anchorDeltaSec`, `residualM`, `geometry`, `jump`, `warnings`, `radiusM`, `uncertaintyKind:'heuristic'|'calibrated'|'unknown'`을 보존한다. GNSS 관측 정확도는 `number|null`이다.

- [ ] **1. 실패 검사:** 1초/11km GNSS, 같은 시각 상이한 위치, 원본 순서 변경을 검사한다. 의심 GNSS가 앵커로 사용되지 않으며 raw 좌표는 그대로 남아야 한다. 정지한 반복 위치는 단순 반복만으로 reject하지 않는다.
- [ ] **2. 실패 확인:** `node scripts/tests/position-quality.test.cjs`를 실행한다.
- [ ] **3. 구현:** 설계 5.1의 200km/h·120초·동일 시각 1m 규칙으로 위반 쌍의 양끝을 모두 suspect로 둔다. 재귀 전파/임의 승격 없이 원본을 보존하고 위반에 참여하지 않은 후속 점은 별도로 판정한다. 필수 시각/CRS/출처 누락은 unknown, 좌표 범위 위반은 rejected다. 세 상태는 앵커·정밀 집계에서 제외한다. 정확도 미제공은 그 자체로 rejection이 아니며 plausible GNSS도 관측 정확도는 null이다. 기존 실측의 현황은 별도 출처로 유지하되 정답/앵커로 재사용하지 않는다. 고정 250m를 GNSS 정확도로 쓰지 않고 모델 허용 가정과 분리한다. UI의 경험적 반경은 ‘모델 불확실성 추정’으로 표시한다.
- [ ] **4. 검증:** 새 검사, GNSS provenance 검사, EPSG 변환 Python 검사, Task 1 평가를 실행한다. 품질 보류 전후 표본 수와 누락 원인을 함께 대조한다.
- [ ] **5. 커밋:** 품질 계약·전파·설명과 검사만 저장한다.

## Task 4. 현황 적격성·출처·모델 버전

**Files:** Modify `lib/analyst/types.ts`, `overview.ts`, `data-loader.ts`, `components/analyst/analyst-dashboard.tsx`, `quality-overview.tsx`, `analyst-map.tsx`, `scripts/build-analyst-overview.cjs`, `scripts/test-analyst-loader.cjs`; Create `scripts/tests/location-overview.test.cjs`, `lib/location-estimation/version.ts`.

**Interfaces:** `getPositionModelIdentity()`는 `{normalizationVersion,estimatorVersion,configHash,qualityPolicyVersion}`을 반환한다. 현황 schema를 `analyst-overview-v2`로 올리고 이 identity와 sourceRevision을 같이 검증한다. grid membership에 실제 위치 출처별 관측/통화 수를 저장한다. 기본 격자에는 적격 GNSS/실측만 포함하고, 미검증 보간/무선 추정은 별도 조사 레이어로 둔다. calibrated 추정의 기본 포함 여부는 Task 6 검증 후 별도 고정한다.

- [ ] **1. 실패 검사:** GNSS 1점과 떨어진 radio 1점을 가진 통화가 radio 격자를 GNSS로 표시하지 않아야 한다. 품질 보류로 전체 통화/평가 수는 변하지 않아야 한다. 원본 revision이 같아도 configHash만 다르면 구형 요약을 거부해야 한다.
- [ ] **2. 실패 확인:** `node scripts/tests/location-overview.test.cjs`와 loader 검사를 실행한다.
- [ ] **3. 구현:** 상세 캐시·요약 메타·UI 범위를 동일 정책으로 연결한다. 자료 갱신은 원자적으로 발행한다. 위치 확보/보류 수 변화가 품질 개선에 따른 것임을 명시한다.
- [ ] **4. 검증:** `npm.cmd run data:overview`, `npm.cmd run test:analyst`, TypeScript/빌드, 실제 브라우저 현황→통화→복귀 검증. 모델 변경 후 현황·상세가 섞이지 않아야 한다.
- [ ] **5. 커밋:** 스키마·적격성·버전·검사를 저장한다. 생성된 상세·요약은 제외한다.

**1차 완료 조건:** Task 1–4까지. 이 시점에도 정밀도 개선을 주장하지 않으며, 잘못된 확정 위치와 과도한 집계 해석을 먼저 차단한다.

## Task 5. GNSS 공백과 무선 모델 후보 비교

**Files:** Create `lib/location-estimation/gnss-gap.ts`, `scripts/tests/gnss-gap.test.cjs`, `scripts/tests/location-solver.test.cjs`; Modify `adaptive.ts`, `adaptive-config.ts`, Task 1 평가 도구. 최적화가 커지면 `lib/location-estimation/solver.ts`로 분리한다.

**Interfaces:** `estimateGnssGaps(samples, quality, policy)`는 기존 sampleIndex에 대응하는 후보와 보류 사유를 반환한다. 모델 선택은 `estimatorVersion/configHash`로 식별하고 출처는 `interpolated`로 남긴다. radio 후보는 현행/max, median/절사 median, 거리식 없는 가중 중심, robust 손실+다중 초기값이다.

- [ ] **1. 실패 검사:** 통화 밖/긴 공백/의심 양끝은 보간되지 않아야 한다. 짧고 일관된 양끝은 실제 시간 비율로 보간된다. 일직선 3사이트의 대칭 해는 하나의 확정 위치로 표시하지 않는다. 정확한 비퇴화 합성 거리에서 최적화가 정답을 복원해야 한다.
- [ ] **2. 실패 확인:** `node scripts/tests/gnss-gap.test.cjs`, `node scripts/tests/location-solver.test.cjs`를 실행한다.
- [ ] **3. 구현:** 오프라인 보간과 radio 후보를 각각 격리한 설정으로 비교한다. ±시간창의 최대값·대표 RSRP·앵커를 사이트로 세는 조건도 비교 인자로 기록한다. 양끝을 사용할 수 없는 실시간 모드와 혼합하지 않는다.
- [ ] **4. 검증:** validation에서 모델·보류 정책을 선택하고 고정한다. 잠금 테스트는 아직 열지 않으며 Task 6에서 반경까지 고정한 뒤 한 번 실행한다. Task 1의 validation 채택 조건 미달이면 기존 후보/참고 영역을 유지한다. 60m/100m 목표를 역으로 맞추기 위해 정답 좌표로 계수를 조정하지 않는다.
- [ ] **5. 커밋:** 통과한 후보·설정·합성 검사와 비식별 성능 요약을 저장한다.

## Task 6. 불확실성 보정과 최종 수용 검사

**Files:** Create `lib/location-estimation/radius-calibration.ts`, `scripts/tests/radius-calibration.test.cjs`; Modify `adaptive.ts`, `observation-details.tsx`, Task 1 평가 도구, `docs/location-evaluation.md`.

**Interfaces:** 보정 산출물은 모델 identity·보정셋 해시·방법/품질별 고객/지점 수·명목 포함률·반경 규칙을 가진다. 목표는 품질 통과한 제공 GNSS에 대한 90% 포함률이며 절대 위치 정확도가 아니다. 구간별 최소 50고객·200지점이며 부족하면 공통 보정 또는 `uncertaintyKind='heuristic'|'unknown'`을 유지한다. fit·validation·radius-calibration·잠금 테스트의 역할을 manifest에서 구별한다.

- [ ] **1. 실패 검사:** 65점이 정확도 65%로 표시되지 않아야 한다. 보정셋 누출·다른 모델 해시·표본 부족 반경은 calibrated로 읽지 않아야 한다.
- [ ] **2. 실패 확인:** `node scripts/tests/radius-calibration.test.cjs`를 실행한다.
- [ ] **3. 구현:** calibration 분할에서 경험적 반경을 맞추고 잠금 테스트에서는 수정하지 않는다. UI에 포함률 의미와 근거 수를 연결한다. 실제 오차를 가리는 과대 반경은 오차/커버리지와 함께 보고한다.
- [ ] **4. 검증:** 전체 회귀, Python, 타입, 변경 정적 검사, 빌드와 실제 1920/1366 UI 검사. 위치 보류·자료 갱신·원본 좌표 대조를 포함한다. 다른 날짜가 없으면 날짜 밖 정확도 주장은 보류한다.
- [ ] **5. 커밋:** 보정 계약·검사·비식별 최종 결과와 사용 한계를 저장한다.

## 후속 조건부 작업

Task 1–6 이후 셀 마스터가 PCI/주파수/지역의 모호성을 해소하면, 이웃 RSRP와 fingerprint/kNN을 별도 후보로 비교한다. 현재 이웃 배열이 있다는 이유만으로 동시 다변측량을 적용하지 않는다. 안테나·기준신호 전력·TA·다른 날짜는 확보된 뒤에만 기능과 성능 약속에 반영한다.

## 마감 및 전달

- [ ] 구현 시작 전 원본 감사 결과와 이번 탐색 수치를 다시 확인하고, 제안 기준·모델 후보·기본 집계 정책을 문서에 고정한다.
- [ ] 각 Task 종료 때 독립 검토자가 데이터 누출·보류·분모·버전 일관성을 확인한다.
- [ ] 최종 보고에는 비교 대상/분모/추정 불가 수/오차/검증 범위와 실제 채택 설정을 함께 적는다.

이번 계획의 기본 제안은 단계별 독립 구현·검토다. 1차(Task 1–4)부터 진행하면 모델 성능을 과장하지 않으면서 현재 확인된 위험을 먼저 줄일 수 있다.
