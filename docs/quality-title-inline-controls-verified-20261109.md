# 개선 2안 — 조사 후보 지도 제목 오른쪽에 선택기 통합

검증일: 2026-11-09
프로젝트: QoE_Metrics (Windows)
접속: http://127.0.0.1:3016/qoe/?variant=improvement2&dateStart=2026-10-26&dateEnd=2026-10-30&mapMode=improvement

## 사용자 요구와 실제 반영
사용자가 첨부한 '조사 후보 지도' 제목과 오른쪽 빈 공간을 활용하도록 두 개의 분석 설정 카드를 제거했다.

- **일반 지도**: 제목/짧은 설명과 같은 헤더 행의 오른쪽에 `전체 기간 | 성능 검증 | 모델 선택 | 플라스크 아이콘` 배치.
- **지도 전체화면**: 왼쪽 패널의 같은 '조사 후보 지도' 제목 오른쪽에 설정 표시. 지도 자체는 오른쪽 크게 유지.
- **단축 텍스트**: '전체 기간 후보 분석(기본)'→'전체 기간', '알고리즘 성능 검증(기간 분리)'→'성능 검증', 긴 모델 표시→'DBSCAN · 100m', 'Adaptive KDE'→'KDE'. 전체 모드 명칭, 모델 선택 기준과 시뮬레이터 기능은 aria-label/title로 보존.
- **알고리즘**: DBSCAN/HDBSCAN/ST-DBSCAN/KDE/Spatial Scan/Bayesian 총 6개 그대로. 플라스크 아이콘은 기존 7단계 가상 시뮬레이터 팝업으로 연결.
- 가로 폭이 충분한 1100/1369/1600px에서는 제목과 설정이 동일한 행. 좁은 폭에서만 줄바꿈 허용. 전체화면의 본문과 지도의 기존 선택후보·지도 줌·패닝 기능은 변경하지 않음.
- 설정 카드 세로 공간 감소로 지도와 좌측 분석 정보 사용 공간 확대.
- 데이터/후보 산정 로직/MOS 원본/통화·고객 근거는 수정하지 않음.

## 변경 파일
- `components/analyst/quality-improvement-candidate-panel.tsx`: 짧은 텍스트·전체 접근성 이름·아이콘 시뮬레이터를 가진 compact 헤더 제어.
- `components/analyst/quality-two-candidate-workspace.tsx`: 일반/전체화면 DBSCAN 제목과 오른쪽 컨트롤 같은 행.
- `components/analyst/quality-model-alternative-workspace.tsx`: 5개 대안 모델도 동일한 배치.
- `components/analyst/quality-model-alternative.module.css`, `quality-two-candidate-workspace.module.css`: 컴팩트 버튼·반응형 헤더.
- `scripts/tests/quality-title-inline.browser.cjs` 및 `quality-title-inline-diagnostic.browser.cjs`: 배치 측정·기능 검증.
- 기존 `quality-map-inside-controls.browser.cjs`, `quality-reference-layout.browser.cjs`의 예상 정렬 기준을 새로운 '제목 옆' 구조로 수정.

## 빌드, 배포, 검증
- 빌드: `outputs/quality-improvement-two-deploy/stage-title-inline-20261109/dist`
- 3016 서버: `scripts/serve-quality-title-inline-preview.cjs`
- 이전 빌드 `stage-map-inside-controls-20261108/dist`는 롤백용 보존. 서비스 3001/3014 및 모든 원본 데이터 변경 없음.
- 3019에서 독립 QA를 실행하고 실제 3016 서버에만 새 빌드를 적용.
- TypeScript noEmit, oxlint 및 관련 Node 회귀 검사 12개 통과. 프로덕션 빌드 성공.
- 실제 3016 Edge/Playwright 결과:
  - DBSCAN 및 HDBSCAN, 화면 폭 1600/1369/1100: 일반/전체화면 모두 제목과 컨트롤 같은 행.
  - 800/390px 반응형에서 설정이 화면 밖으로 나가지 않음; 모바일 가로 넘침 없음.
  - 전체화면에서 DBSCAN→Spatial Scan 모델 변경 및 전체기간↔성능 검증 모드 전환 후 지도 유지.
  - 6개 알고리즘과 시뮬레이터 팝업, ESC 복귀 정상. VWorld 타일 성공, HTTP 오류 0, JS pageerror 0.
  - 전체 기간/성능검증 후보 산출 결과 기존값 유지(DBSCAN 8/7, HDBSCAN 20/16, ST-DBSCAN 7/5, KDE 18/15, Scan 20/17, Bayesian 20/20 표시 상한).
  - KPI 원본(2026-10-30) 기존/개선1/개선2 동일: 전체 37,731건, MOS 평가 26,688건, 평균 MOS 4.11, 저품질 288건.
- 실제 화면 캡처: `outputs/quality-improvement-two-deploy/title-inline-live-qa/normal-1369.png`, `dbscan-fullscreen-1369.png`, `hdbscan-fullscreen-390.png`.

## 안전한 해석
모델 선택 UI의 'DBSCAN · 100m'는 군집 이웃 거리 설명이며, 지도에 표시되는 실제 후보 반경이나 GNSS 측위 오차를 뜻하지 않는다. 조사 원/중심점이 MOS 열화 발생 시점의 확정 좌표라는 의미도 아니다.
