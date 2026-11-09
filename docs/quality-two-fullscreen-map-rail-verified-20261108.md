# 개선 2안 · 전체화면 지도 왼쪽 정보 패널 UI 반영 검증

검증일: 2026-11-08 / 프로젝트: QoE_Metrics / 프리뷰: 127.0.0.1:3016

## 요구사항 및 적용
- 승인된 지도 전체화면 시안의 왼쪽 영역에 조사 후보 지도 제목/설명, 지도 범례, **현재 선택한 실제 후보** 고유 저MOS 고객 수/저MOS 통화 수/관측 날짜 수/표시 반경을 고정 요약 형태로 배치.
- 아래에는 **알고리즘 설명 / 시뮬레이터 / 선정 기준 / 지도 표시** 4개 탭 추가. 탭마다 독립 스크롤. 원본 알고리즘 설명·실제 후보 근거·가상 7단계 시뮬레이터·선정 기준 상세 및 지도 원 해석을 유지.
- 이 설계를 **DBSCAN + 5개 대안 모델(HDBSCAN, ST-DBSCAN, Adaptive KDE, Spatial Scan, Bayesian)**에 모두 적용.
- 기존 상단 '알고리즘 설명·시뮬레이션' 바로가기 클릭 시 시뮬레이터 탭을 자동으로 열도록 연결. 지도 자체의 전체화면 버튼은 설명 탭부터 확인 가능.
- 기존 일반 지도에는 상단 제목과 범례를 그대로 보존. 전체화면에서는 제목/범례를 왼쪽으로 보내고 상단 오른쪽에 '전체 화면 닫기'만 오버레이.
- 지도 컨테이너(Leaflet)는 탭 전환 때 언마운트하지 않아 줌·패닝·현재 위치 표시를 유지. 왼쪽 전체화면 요약은 지도 마커로 후보 선택 시 반영.
- 모바일(390px)에서는 왼쪽 패널(상단)과 지도(하단)를 세로 배치하고 각각 충분한 높이 유지.
- 가상 예시와 실제 후보 수치를 명확히 분리, 후보 표시 반경 ≠ 위치 오차/통화 저하 순간 좌표.
- 기존 전기간 기본 분석과 성능 검증의 원본 산출 분리 및 표본 편향 경고 유지. 코드 변경은 UI 중심으로, 원본 CDR/MDT/GNSS/RTCP 및 계산 알고리즘 변경 없음.

## 수정
- components/analyst/quality-two-candidate-workspace.tsx / .module.css
- components/analyst/quality-model-alternative-workspace.tsx / .module.css
- components/analyst/quality-two-algorithm-guide.tsx
- scripts/tests/quality-map-rail.browser.cjs
- scripts/tests/quality-map-rail-pan.browser.cjs
- 기존 시뮬레이터 브라우저 검사 2개에 새 시뮬레이터 탭 선택 단계를 반영.

## 배포와 롤백
- 새 독립 빌드: outputs/quality-improvement-two-deploy/stage-map-rail-20261108/dist
- 서버 어댑터: scripts/serve-quality-map-rail-preview.cjs, 현재 3016 포트에서 실행.
- 기존 빌드 outputs/quality-improvement-two-deploy/stage-unified-ui-20261108/dist 와 scripts/serve-quality-unified-ui-preview.cjs 는 롤백용으로 보존.
- 3001, 3014 서버 및 원본 파일 유지, 3019는 임시 QA 검증용으로 사용 후 종료.

## 테스트
- TypeScript noEmit, oxlint 및 관련 Node 테스트 15개 통과, 별도 프로덕션 빌드 성공.
- 3019 브라우저 사전 검사, 3016 배포 후 Edge Playwright 동일 재검사 통과.
- DBSCAN/대안 모델 두 종류 모두 전체화면 왼쪽의 제목/범례/실제 선택 후보 4가지 숫자 표시 및 선택 연동 정상.
- 4개 탭, 7단계 시뮬레이터/파라미터·상황 변경, 실제 모델별 후보 연동 및 자동 재생/일시정지 정상.
- 오른쪽 VWorld 지도 타일 로드 정상(라이브 25개), 콘솔 pageerror 0.
- 1440/1024/800/680/390 폭에서 왼쪽 패널·지도 겹침 없음. 390px 실측 지도 높이 약 358px, 설명 컨텐츠 약 269px.
- DBSCAN 및 HDBSCAN: 브라우저에서 실제 지도 드래그 후 Leaflet pane transform 변경 확인, 줌 버튼 변경도 검증.
- 전체기간 6모델: DBSCAN 8, HDBSCAN 20, ST-DBSCAN 7, KDE 18, Scan 20, Bayesian 20. 성능 검증 DBSCAN 7, HDBSCAN 16, ST-DBSCAN 5, KDE 15, Scan 17, Bayesian 20. 이 수는 모델 성능 순위가 아님.
- 2026-10-30 KPI 기존/개선1/개선2: 전체 통화 37,731 / MOS 평가 26,688 / 평균 MOS 4.11 / 저MOS 288 동일.
- 테스트 캡처: outputs/quality-improvement-two-deploy/map-rail-live-qa/dbscan-fullscreen-1440.png, hdbscan-fullscreen-1440.png, hdbscan-fullscreen-390.png

## 해석 유의
- 조사 원은 표시용 범위로 실제 품질 저하 발생 위치나 GNSS 오차 반경을 확정하지 않음.
- Spatial Scan/Bayesian은 정상 통화 위치 확보 표본 편향이 있어 탐색용만.
- 기존 모델 선택, 분석 목적, 통화·고객 근거 및 지도 포털 연동 유지.
