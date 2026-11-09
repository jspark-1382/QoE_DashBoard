# 개선 2안 — '분석 목적/후보 산정 모델' 선택기를 조사 후보 지도 내부로 이동

날짜: 2026-11-08
프로젝트: Windows QoE_Metrics
적용: http://127.0.0.1:3016/qoe/?variant=improvement2&dateStart=2026-10-26&dateEnd=2026-10-30&mapMode=improvement

## 사용자 요구
- 기존 지도 전체화면 위에 가로로 고정되어 있던 '분석 목적 선택 / 후보 산정 모델 선택 / 알고리즘 설명·시뮬레이션' 행을 제거.
- 모두 '조사 후보 지도' 안쪽에 배치하도록 수정.

## 적용
- 일반 개선 2안: 지도 제목 아래의 지도 패널 내부에 분석 목적(전체기간/성능검증)과 6개 모델 선택 및 시뮬레이터 바로가기를 한 번만 표시. 지도 밖의 별도 제어 행 제거.
- 지도 전체화면: 왼쪽 사이드 패널 '조사 후보 지도' 제목 바로 아래에 두 선택기와 시뮬레이터 버튼을 배치. 다음에 지도 범례, 선택 지역 카드, 알고리즘 설명·선정 기준, 하단 두 버튼, 오른쪽 지도 순서로 정렬.
- 오른쪽 지도를 가로로 가리는 상단 설정 행을 완전히 제거.
- 전체화면의 모델 선택/성능 검증 전환 유지; 상태 전환 후에도 전체화면 유지.
- 팝업 시뮬레이터는 상단 안쪽 바로가기와 하단 '시뮬레이터 열기' 모두 사용 가능, 시뮬레이터 본문은 팝업만 사용.
- DBSCAN 이웃 거리 100m와 실제 후보 표시 반경을 분리하는 기존 정책, 후보 위치 계산 및 MOS 근거 불변.
- 390px 모바일에서는 설정이 왼쪽 패널 범위에 맞춰 쌓이고 지도는 별도로 스크롤/확대 가능.

## 수정
- `components/analyst/quality-improvement-candidate-panel.tsx`의 페이지 전역 controlBar를 제거하고, 뷰 상태별 `mapControls(expanded)` 생성.
- `components/analyst/quality-two-candidate-workspace.tsx` normal 지도 내부 / fullscreen 좌측 rail 안에 controls 배치.
- `components/analyst/quality-model-alternative-workspace.tsx` 5개 대안 모델에도 같은 구조 적용.
- `components/analyst/quality-model-alternative.module.css` 지도 내부 설정 카드의 반응형 및 간결한 선택기 스타일.
- 신규 검증 `scripts/tests/quality-map-inside-controls.browser.cjs`.

## 빌드/롤백
- 운영 빌드 `outputs/quality-improvement-two-deploy/stage-map-inside-controls-20261108/dist`
- 운영 어댑터 `scripts/serve-quality-map-inside-preview.cjs`; 3016 포트.
- 복구용 직전 빌드 `outputs/quality-improvement-two-deploy/stage-simulator-popup-20261108/dist` 및 `scripts/serve-quality-simulator-popup-preview.cjs` 보존.
- Windows 원본 프로젝트와 3001/3014 서비스 그대로 유지, QA 3019는 검증 후 종료.

## 검증
- TypeScript noEmit, oxlint, vinext 별도 빌드 통과.
- Edge Playwright 3016 실사용:
  - 일반 모드: 설정은 반드시 '개선 2안 조사 후보 지도' 내부에 1개만 존재, 지도 제목보다 아래.
  - 전체화면: 설정은 반드시 '전체화면 왼쪽 지도 해석' 내부이며 지도 제목 아래·범례 위, 기존 '전체화면 모델 및 분석 설정' 상단 전역 행 0개.
  - 6개 모델 선택, HDBSCAN으로 전환, 성능 검증 목적 변경, 다시 DBSCAN으로 전환 후 전체화면 유지.
  - 팝업 시뮬레이터 기능(6개 모델)과 Esc 복귀 유지.
  - 1024/800/680/390px: 지도와 패널 겹침/페이지 가로 오버플로 없음, 390px 지도 높이 366px.
  - VWorld 타일 정상, JavaScript pageerror 0.
  - 전체기간/검증 후보 결과 변동 없음(DBSCAN 8/7, HDBSCAN 20/16, ST-DBSCAN 7/5, KDE 18/15, Scan 20/17, Bayesian 20/20 표시 상한).
  - 공통 MOS KPI 기존/개선1/개선2 동일(전체 37,731, MOS 평가 26,688, 평균 4.11, 저MOS 288).
- 운영 화면 캡처:
  - `outputs/quality-improvement-two-deploy/map-inside-live-qa/normal-map-controls-1600.png`
  - `outputs/quality-improvement-two-deploy/map-inside-live-qa/fullscreen-controls-inside-1600.png`
  - `outputs/quality-improvement-two-deploy/map-inside-live-qa/fullscreen-controls-inside-390.png`
