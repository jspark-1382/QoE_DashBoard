# 개선 2안 UI 통합 재구성 — 2026-11-08

## 목적과 실제 반영
사용자가 승인한 '기존 품질 현황'과 비슷한 화면 밀도의 UI로 개선 2안을 통일했다.
- 접속: http://127.0.0.1:3016/qoe/?variant=improvement2&dateStart=2026-10-26&dateEnd=2026-10-30&mapMode=improvement
- 기존 큼직한 짙은 색 안내 배너를 흰색의 간결한 '저품질 조사 후보' 상단 타이틀로 변경; '선정 근거', '현장 검증', '본부장 요구 강조' 기존 기능 유지.
- 두 줄에 걸쳐 분산되던 분석 목적 선택/알고리즘 선택을 같은 가로 행의 일관된 설정 컨트롤로 배치. 반응형 1260px 이하에서는 세로 정렬.
- 알고리즘 선택은 DBSCAN, HDBSCAN, ST-DBSCAN, Adaptive KDE, Spatial Scan, Bayesian 6개를 그대로 제공한다.
- '알고리즘 설명·시뮬레이션' 버튼을 설정 바 옆에 배치. 이 버튼은 선택 모델의 기존 지도 전체화면 및 좌측 단계별 설명/시뮬레이터를 실제로 연다.
- KPI 카드 3개는 참고 '품질 현황'처럼 낮고 얇게, 설명 문구도 간결하게 구성.
- 지도는 왼쪽 큰 영역으로 유지하고 우측 후보 목록은 215px(모바일 230px) 내부 스크롤해 선택 후보 요약이 지도와 같은 시야에 보이도록 조정.
- 우측 상세 탭: '선정 요약', '고객·통화', '위치·무선 근거'. 실제 탭 동작을 연결. DBSCAN의 실제 고객 통화 상세, 원본·RF 검토 항목, 대안 모델의 승인 GNSS/3-Site 통화 표 및 모델별 근거 유지.
- 일부 후보 RF 중앙값이 미산출인 상황을 그대로 표시해 RSRP/RSRQ/SINR 값을 만들어 내지 않음.
- Spatial Scan 및 Bayesian의 위치 표본 편향·탐색 전용 경고 유지.
- DBSCAN 전체기간 8곳, 성능검증 7곳; 모든 모델/분석 모드 기존 원본 산출값 유지. 고객명/원본 SIP/MDT/GNSS 파일 수정 없음.

## 변경 코드
- `components/analyst/quality-improvement-two.tsx` 및 `.module.css`: 개선 후보 모드에만 compact header 적용.
- `components/analyst/quality-improvement-candidate-panel.tsx`: 통합 컨트롤, 모델 선택 옆 설명/시뮬레이터 진입.
- `components/analyst/quality-model-alternative.module.css`: 통합 바·KPI·지도·목록·반응형·탭 스타일.
- `components/analyst/quality-two-candidate-workspace.tsx` 및 `.module.css`: DBSCAN 선택 후보 3개 탭 및 압축 레이아웃.
- `components/analyst/quality-model-alternative-workspace.tsx`: 5개 대안 모델 상세 탭, 압축 카드, 스크롤 후보 목록.
- `components/analyst/map-panel-frame.tsx`: 기존 전체화면 지도와 ESC/focus trapping 유지하면서 부모의 `openRequest`로 전체화면 열기 지원.
- 새로운 브라우저 QA: `scripts/tests/quality-unified-ui.browser.cjs`, `quality-unified-kpi.browser.cjs`.
- 과거 전용 테스트 `quality-model-simulators.browser.cjs`의 DBSCAN 7곳 기대를 전체기간 기본 8곳에 맞게 수정.

## 실제 브라우저·빌드 검증
- 별도 빌드 `outputs/quality-improvement-two-deploy/stage-unified-ui-20261108/dist`; 빌드 성공. 이전 `stage-full-period-20261108/dist`는 롤백용으로 보존했다.
- 임시 3019 사전 검증 후 3016 프로세스만 교체했다. 3001과 3014는 건드리지 않았다.
- Edge Playwright 실제 3016 재검사:
  - 알고리즘 6개 선택 존재, 기본 DBSCAN 8곳, HDBSCAN 20곳, Spatial Scan 20↔17(전체기간↔후속평가) 전환 정상.
  - '알고리즘 설명·시뮬레이션' 버튼으로 DBSCAN/대안 모델 각각 전체화면 지도+7단계 설명 열림, ESC 복귀 정상.
  - 선정 요약, 고객·통화, 위치·무선 근거 3개 탭 모두 클릭 동작·실제 원본 데이터 표시 정상.
  - 지도 VWorld 타일 로딩 정상 (15개 실사용 화면, 전체 회귀에서 37개의 성공 응답), 타일 HTTP 오류 0.
  - 1440/1280/1024/800/680/390px에서 지도/우측 패널 겹침, 가로 넘침 없음. 후보 목록 max-height 215px/230px 정상.
  - 대안 5개 7단계 시뮬레이터의 확대/전체 관측/자동 재생/일시정지 정상.
  - 2026-10-30 1일 KPI: 기존/개선1/개선2 동일하게 총통화 37,731, 평가가능 26,688, 평균 MOS 4.11, 저품질 288.
  - 브라우저 pageerror 0, TypeScript 및 oxlint 검사 통과, 관련 Node 회귀 검사 통과.
- 실제 배포 스크립트: `scripts/serve-quality-unified-ui-preview.cjs` (3016).
- 실제 캡처: `outputs/quality-improvement-two-deploy/unified-live-qa/dbscan-1440.png`, `hdbscan-1440.png`, `hdbscan-390.png`.

## 한계와 구분
UI 변경만 수행했으며 후보 알고리즘, 원본 MOS, GNSS/3-Site/RTCP/MDT 데이터, 위치 표본 편향 및 원인 검증 상태는 변경하지 않았다.
조사 후보 원이 실제 음성 저하 순간의 확정 위치/오차 반경이라는 뜻이 아니다.
RF 중앙값을 아직 산출하지 않은 후보에서 RF 지표를 임의 생성하지 않는다.
