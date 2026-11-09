# 개선 2안 — 시뮬레이터 팝업 하단 잘림 해결 및 화면 높이 최적화
검증: 2026-11-09 / 프로젝트: Windows QoE_Metrics / 운영 프리뷰 3016

## 문제와 원인
사용자 캡처는 1600x960 화면에서 DBSCAN 시뮬레이터의 1단계 달력 도식이 팝업 너비로 과도하게 커지면서 아래 설정과 '이전/다음' 버튼이 보이지 않는 현상.
기존 3016 실측(1600x960): 팝업 내부 보이는 높이 789px, DBSCAN 전체 내용 1009px, 그림 높이 406px, 단계 이동 버튼 y=1028~1081로 화면 밖. HDBSCAN은 내부 내용 2655px, 그림 623px. 팝업 자체가 충분히 작아지지 않는 상황.

## 적용
- `components/analyst/quality-two-simulator.tsx`: DBSCAN 도식과 단계별 조절 조건을 2열 학습 레이아웃으로 변경. 가상 계산 규칙은 전혀 수정하지 않음.
- `components/analyst/quality-two-simulator.module.css`: 7단계 선택지를 PC에서 한 줄(모바일 4+3), SVG 과확대 차단(단계별 222/196px 이내), 조건/범례/결과 요약을 촘촘하게 정돈, 단계 전환 버튼을 스크롤 뷰포트 하단 sticky 처리.
- `components/analyst/quality-model-simulator.tsx`: 대안 5모델을 SVG·범례 좌측, 파라미터·모델 공식 우측 2열 구성. 별도의 원본 후보 상세는 '실제 선택 후보 분석 근거 펼치기' disclosure로 제공해 반드시 필요할 때 펼쳐 보도록 조정. 상세 근거·지도 연결 기능 삭제 없이 유지.
- `components/analyst/quality-model-simulator.module.css`: 모델 그림 최대 높이 270px(768px 높이에서는 230px), 7단계 네비게이션 PC 1줄, 단계 컨트롤/계산/단계 이동 압축, 실제 후보 상세는 접힌 상태가 기본. 모바일에서는 1열+내부 스크롤/고정 단계 버튼.
- `components/analyst/quality-simulator-dialog.module.css`: 팝업 최대 805px, 화면 높이에 따라 축소, 헤더·내부 여백을 줄여 실제 학습에 필요한 공간 확보.
- 기존 시뮬레이터 입력/슬라이더·단계 이동·자동재생·실제 모델·DBSCAN 계산값 변경 없음.
- `scripts/tests/quality-model-simulators.browser.cjs`: 실제 후보 상세가 접혀 있음을 반영하여 열고 나서 검증하도록 수정.
- 신규 `scripts/tests/quality-popup-viewport-diagnostic.browser.cjs`, `scripts/tests/quality-simulator-fit.browser.cjs`: 팝업/그림/설정/이동 버튼 높이 계측 및 6모델×7단계/모바일 검증.

## 최종 빌드와 배포
- 빌드: `outputs/quality-improvement-two-deploy/stage-simulator-fit-20261109/dist`
- 3016 실행 어댑터: `scripts/serve-quality-simulator-fit-preview.cjs`
- 롤백: `outputs/quality-improvement-two-deploy/stage-title-inline-20261109/dist` 및 `scripts/serve-quality-title-inline-preview.cjs`
- 3019 독립 검증 후 3016에만 적용. 3001/3014 원본 앱, SIP/RTCP/GNSS/MDT 자료와 KPI 불변.

## 검증
- 최초 개발 전 1600x960 실측: DBSCAN 전체 968px 도식 406px, HDBSCAN 전체 2614px 도식 623px.
- 최종 3016 브라우저 실측: DBSCAN 1단계 내용 약 553px/그림 222px, HDBSCAN 1단계 내용 약 710px/그림 270px.
- **1600x960, 1600x900, 1600x768 높이에서 6모델 모두 1단계 시뮬레이터 팝업 내부 스크롤 없음(스크롤 높이=가시 높이)**.
- 6개 모델 × 7단계 모두 클릭 후 '이전/다음/자동 재생' 하단 이동 버튼이 보임. 필요시 내용만 내부 스크롤, 버튼은 sticky.
- 모바일 390x830에서도 화면 가로 넘침 없음, 긴 계산 파라미터는 내부 스크롤, 단계 이동 버튼 고정.
- 대안 모델 5개 파라미터 변경/상황 변경/선택 실제 후보 근거 펼치기/그림 확대/자동 재생·일시정지 회귀 통과.
- 시뮬레이터 팝업 종료 후 지도 전체화면 유지. 브라우저 JavaScript 오류 0.
- 기존/개선1/개선2 공통 MOS KPI 동일(2026-10-30: 전체 통화 37,731건, MOS 평가 26,688건, 평균 4.11, 저MOS 288건).
- 캡처:
  - `outputs/quality-improvement-two-deploy/sim-fit-live-qa/dbscan-1600x960.png`
  - `outputs/quality-improvement-two-deploy/sim-fit-live-qa/hdbscan-1600x900.png`
  - `outputs/quality-improvement-two-deploy/sim-fit-live-qa/hdbscan-390x830.png`

## 해석 주의
시뮬레이터는 7단계 가상 학습 도식이며 실제 고객 위치/품질 판정 및 원본 데이터는 수정하지 않습니다. 100m DBSCAN 이웃 거리와 지도 표시 반경/위치 오차는 별도 개념입니다.
