# 개선 2안 · 시뮬레이터 팝업 전체화면 가독성 확대 (2026-11-09)

## 요청
기존 3016 시뮬레이터는 화면의 약 2/3 정도를 사용하고 빈 공간이 커서, 알고리즘 단계·그림·슬라이더·결과 글자가 작게 보였다. 사용자는 '화면을 꽉차게 쓰고 글자 들을 전체적으로 키웠으면 좋겠다'고 요청.

## 변경 사항
- `components/analyst/quality-simulator-dialog.module.css`:
  - 모달 너비 `min(1580px, 100vw-24px)`, 높이 `100dvh-24px`로 확장. 모바일은 `100dvh`.
  - 헤더 제목 24px(데스크톱), 안내문 13px, 탐색 탭 13px, 닫기 14px.
  - 콘텐츠 영역의 기존 최대 960px 폭 제한 해제, 가상 실습 화면은 전체 너비/세로 높이 활용.
- `components/analyst/quality-two-simulator.module.css`:
  - 7단계 탭 글자 13px, 단계 제목 19px, 슬라이더 레이블 15px, 결과 15px, 이전/다음 버튼 15px.
  - DBSCAN 원/관측점 도식(390×326 viewBox)은 데스크톱 480×402px까지 확대(기존 266×224px), 나머지 SVG는 최대 700px/415px.
  - 조건/결과 카드 크기 및 여백 조정. 단계 이동 버튼 sticky 유지.
- `components/analyst/quality-model-simulator.module.css`:
  - HDBSCAN/ST-DBSCAN/KDE/Spatial Scan/Bayesian 모두 동일한 헤더/슬라이더/도식 확대 기준 사용.
  - 모델별 학습 도식 600×330px(기존 약 460×270px), 폰트 13~15px 중심으로 확대.
  - 화면 상단의 가상 데이터/상황/7단계 표시 여백을 조정해 도식이 하단 고정 버튼 앞에서 끝나도록 교정.
  - 긴 마지막 단계는 내부 스크롤 가능, 하단 단계 이동 버튼은 보이게 유지.
- 모바일 390px은 두 열을 한 열로 바꾸고 확대된 텍스트/도식을 스크롤로 열람. 가로 넘침 없음.
- 사용자 원본 데이터, 모델 파라미터 계산, 시뮬레이터 상태/시나리오/7단계 이동 로직, 후보 지도·리스트 로직, MOS 지표는 변경하지 않음.

## 로컬 빌드/검증/배포
- 빌드: `outputs/quality-improvement-two-deploy/stage-simulator-readable-20261109/dist`
- 3016 실행 스크립트: `scripts/serve-quality-simulator-readable-preview.cjs`
- 이전 3016 빌드 롤백: `outputs/quality-improvement-two-deploy/stage-candidate-rail-20261109/dist` 및 `scripts/serve-quality-candidate-rail-preview.cjs`
- QA 3019 독립 서버에서 최초 검증 후 3016에 교체 배포, 이전 빌드 복구 경로 유지.
- 실제 3016 Edge Playwright 검증:
  - 1600×960: 모달 1576×936px, DBSCAN 단계4 SVG 480×402px(하단 838px), 단계이동 버튼 시작 864px → 겹침 없음.
  - 1600×960: 5개 대안 모델 모두 단계4 도식 600×330px(하단 820px), 단계이동 버튼 시작 864px → 겹침 없음.
  - 팝업 헤더 24px, 컨트롤 레이블 DBSCAN 15px, 대안 모델 14px.
  - DBSCAN 포함 6개 모델×3단계(1/4/7)×2화면(1600×768, 390×830) 총 36개 검사 통과. 내부 스크롤 가능, 버튼 화면 내 위치, 가로 넘침 0, 브라우저 pageerror 0.
  - DBSCAN 및 5개 대안 모델 팝업/설명/선정 기준/닫기 동작 PASS.
  - 대안 모델 7단계 이동/파라미터 조작/원본 근거 연결 PASS.
  - 원본/개선1/개선2 KPI 불변(2026-10-30): 통화 37,731건, MOS 평가 26,688건, 평균 4.11, 저MOS 288건.
  - 전체 기간/성능 검증 분리 수치 원본과 동일.
- 검증 스크립트:
  - `scripts/tests/quality-simulator-readable.browser.cjs`
  - `scripts/tests/quality-simulator-readable-responsive.browser.cjs`
  - 기존 `scripts/tests/quality-simulator-popup.browser.cjs`, `quality-model-simulators.browser.cjs`, `quality-unified-kpi.browser.cjs`, `quality-full-period.browser.cjs` 회귀 재실행.
- 스크린샷:
  - `outputs/quality-improvement-two-deploy/sim-readable-live-qa/dbscan-stage4-desktop.png`
  - `outputs/quality-improvement-two-deploy/sim-readable-live-qa/hdbscan-stage4-desktop.png`
  - `outputs/quality-improvement-two-deploy/sim-readable-live-qa/dbscan-stage4-mobile.png`

## 해석/제약
- 768px 높이나 모바일에서는 크게 확대한 글자와 단계별 상세 그림/설정을 모두 한 화면에 담을 수 없으므로, 내용은 스크롤되되 7단계 이동 조작은 계속 이용 가능하도록 구성함.
- 실제 조사 후보는 원본 CDR·RTCP·MDT·GNSS에 기반한 별도 결과이고, 시뮬레이터 조작은 실제 조사 후보·지도·원본 통화 지표를 수정하지 않음.
