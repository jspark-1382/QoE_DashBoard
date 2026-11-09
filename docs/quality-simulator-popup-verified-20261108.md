# 개선 2안 — 중복 시뮬레이터 제거 및 독립 팝업 전환

검증일: 2026-11-08
프로젝트: Windows QoE_Metrics
운영 프리뷰: http://127.0.0.1:3016/qoe/?variant=improvement2&dateStart=2026-10-26&dateEnd=2026-10-30&mapMode=improvement

## 요청과 적용 내용
- 사용자 캡처에서 왼쪽 중간 '알고리즘 설명 | 시뮬레이터 | 선정 기준' 탭과 하단 '시뮬레이터 열기' 버튼이 중복.
- **중간 시뮬레이터 탭 제거**, 전체화면 왼쪽 탭은 '알고리즘 설명 | 선정 기준' 2개로 정리.
- 하단 '시뮬레이터 열기' 클릭 시 **별도 오버레이 팝업**을 띄우고 기존 가상 7단계 인터랙티브 실습을 그 안에서 제공.
- 상단 '알고리즘 설명·시뮬레이션' 단축 버튼도 동일한 팝업 실행. 일반 지도 화면에서도 실행 가능.
- 팝업 바깥 클릭, 우상단 닫기, Escape로 팝업만 닫음. 지도 전체화면에서 팝업을 열었으면 한 번 Escape는 팝업만, 다음 Escape는 지도 전체화면을 닫음.
- 지도 전체화면·선택 후보·지도 마커·VWorld 타일·줌·패닝은 팝업을 열어도 유지. 열려 있는 동안 배경은 inert 처리하여 키보드 및 포커스가 팝업에 머물도록 함.
- 팝업은 실제 DOM의 body 포털. 초점 시작은 '시뮬레이터 팝업 닫기', Tab/Shift+Tab 포커스 루프, 닫은 뒤 원래 조작 버튼으로 복귀.
- 모바일(390px)에서는 팝업 전체 높이를 사용하고 시뮬레이션 내용은 독립 스크롤함. 실제 시뮬레이션 결과가 외부 지도 후보를 수정하지 않음.
- **6개 모델 모두 적용**: DBSCAN, HDBSCAN, ST-DBSCAN, Adaptive KDE, Spatial Scan, Bayesian Empirical Bayes. 실험용 Scan/Bayes 경고 및 표본 편향 해석 유지.
- 기존 DBSCAN 전체 기간 8곳/검증일 분리 7곳, HDBSCAN 20/16, ST-DBSCAN 7/5, KDE 18/15, Scan 20/17, Bayesian 20/20 표시 제한 유지.
- 원본 CDR/MDT/GNSS/RTCP, 후보 계산 알고리즘/근거, MOS 품질 현황 탭은 변경하지 않음.

## 코드
- 신규 `components/analyst/quality-simulator-dialog.tsx` 및 `.module.css`: 포털 기반 독립 접근성 모달, 배경 클릭·Escape·포커스 트랩·모바일.
- 수정 `components/analyst/quality-two-candidate-workspace.tsx`: 시뮬레이터 탭 제거, 하단/상단 트리거에서 `QualityTwoSimulator` 모달 실행, MapPanelFrame suspended로 팝업 계층 조정.
- 수정 `components/analyst/quality-model-alternative-workspace.tsx`: 대안 5종도 동일한 동작, 기존 `QualityModelSimulator`를 팝업에 배치.
- 수정 CSS: `quality-two-candidate-workspace.module.css`, `quality-model-alternative.module.css` 좌측 탭 2분할.
- 신규 `scripts/tests/quality-simulator-popup.browser.cjs` 및 기존 7단계/확대/레이아웃 관련 Playwright 검사 수정.

## 빌드/검증
- 별도 빌드 `outputs/quality-improvement-two-deploy/stage-simulator-popup-20261108/dist`
- 운영 스크립트 `scripts/serve-quality-simulator-popup-preview.cjs`; 포트 3016
- 이전 빌드 `stage-reference-ui-20261108/dist` 및 서버 어댑터를 롤백용으로 유지. 원본 및 3001/3014 서버 변경 없음.
- 포트 3019에서 먼저 검증한 후 3016에만 반영함.
- TypeScript noEmit + oxlint PASS. 기존 데이터 12개 Node 테스트 PASS. 빌드 PASS.
- Edge Playwright 실제 3016:
  - DBSCAN + 5개 모델 독립 팝업, 중복 탭/시뮬레이터 본문 제거, 일반 화면 상단 바로가기 정상.
  - 포커스 및 첫 Escape(팝업) / 다음 Escape(지도) 동작 정상. 지도 선택 후보 유지.
  - 모바일 390px 팝업 화면 폭과 내부 스크롤 정상. 지도 타일 실패 0, JS pageerror 0.
  - 기존 대안 5개 7단계, 입력 파라미터, 자동 재생·중지, 밀도·거리 계산, 선택 확대/전체 관측 정상.
  - 전체 기간/성능 검증 후보 수 및 1일 선택 시 검증 비활성화 유지, 레이아웃 넘침 없음.
  - MOS 공통 KPI(2026-10-30): 37,731건 / 평가 26,688건 / MOS 4.11 / 저품질 288건, 기존/개선1/개선2 일치.
- 팝업 캡처:
  - `outputs/quality-improvement-two-deploy/simulator-popup-live-qa/dbscan-popup.png`
  - `outputs/quality-improvement-two-deploy/simulator-popup-live-qa/hdbscan-popup-390.png`

## 주의
시뮬레이터는 가상 실습 데이터입니다. 단계·슬라이더 변경은 실제 측정 통화와 지도 후보를 변경하지 않으며, 현장 RF 원인을 확정하는 도구가 아닙니다.
