# 개선 2안 · 조사 후보 지도 전체화면 후보 목록 중심 UI 검증

일자: 2026-11-09
Windows 프로젝트: QoE_Metrics
운영 주소: http://127.0.0.1:3016/qoe/?variant=improvement2&dateStart=2026-10-26&dateEnd=2026-10-30&mapMode=improvement

## 요청 및 적용

사용자가 요청한 '긴 알고리즘 설명 대신 조사 후보 지역 목록을 보여주는 UI'를 반영했다. 일반 화면의 원본 후보 목록/근거는 유지하고 지도 **전체화면**의 왼쪽(약 35%)만 다음과 같이 개편했다.

- 조사 후보 지도 제목 오른쪽 기존 선택 컨트롤 유지: '전체 기간 | 성능 검증 | 모델 선택 | 플라스크 팝업 아이콘'.
- 제목 아래 GNSS/3-Site/선택/비선택 후보 범례 유지.
- 기존 왼쪽의 긴 알고리즘 설명, 선정 기준 탭, 중복 후보 요약 카드와 하단 시뮬레이터 버튼 제거.
- 왼쪽에 **실제 원본으로 산출된 후보 지역 목록**을 추가. 전체 후보 수와 '범위 검토' 필터, 클릭 가능한 후보 순번/동 이름/고객 수/저MOS 통화 수/관측일/반경을 제공.
- 왼쪽 목록의 후보를 누르면 오른쪽 VWorld 지도에서 해당 후보의 표시 반경·마커 강조를 업데이트하고 Leaflet 지도가 그 위치로 이동.
- 오른쪽 후보 마커를 누르면 목록에서 같은 후보가 선택되고, 긴 목록은 선택 행이 보이도록 자체 스크롤. 지도 후보 SVG 마커에 실제 후보 ID 및 접근성 라벨/키보드 선택(Enter/Space)을 부여.
- 목록 아래 실제 선택 후보 상세: 독립 저MOS 고객·통화·관측 날짜·표시 반경, GNSS/3-Site 근거(연결된 경우), 해당 모델 산정 정보. '범위 검토 필요'이면 최대 점간 거리 등 근거를 직접 표기. DBSCAN의 200m 기준과 그 외 모델의 범위 판정을 구분. 표시는 실제 MOS 저하 순간 위치/오차 확정이 아님.
- 하단 '선택 후보 고객·통화 보기'는 전체화면을 닫고 기존 일반 화면의 해당 후보 통화 근거 탭을 활성화.
- 플라스크 팝업에 **시뮬레이터 / 알고리즘 설명 / 선정 기준** 화면을 제공. 실제 7단계 시뮬레이터는 기존 그대로이며, 설명을 봤다가 돌아와도 실습 상태/입력 유지.
- Spatial Scan/Bayesian은 기존 위치확보 표본 편향 경고를 유지하고 '실제 망 위험률'로 오해하지 않도록 명시.
- 모바일 390px에서 전체화면 닫기 버튼이 시뮬레이터 아이콘을 가리던 문제를 해결하여 닫기 버튼을 지도 영역으로 이동. 후보 목록/상세는 내부 스크롤로 표시하며 지도 줌/드래그 유지.
- 원본 SIP/RTCP/MDT/GNSS, 승인 좌표 정책, 후보 계산 및 MOS 품질 판정은 수정하지 않음.

## 변경 파일

- 신규 `components/analyst/quality-investigation-rail.tsx`, `quality-investigation-rail.module.css`: 전체화면 공용 후보 목록·필터·선택 상세·원본 통화 액션.
- 수정 `components/analyst/quality-two-candidate-workspace.tsx`: DBSCAN 후보 목록 중심 사이드바. 원본 후보 detail을 사용할 수 있을 때 범위 실제 점간 거리 확인.
- 수정 `components/analyst/quality-model-alternative-workspace.tsx`: 5개 대안 모델의 실제 후보 목록·표본 해석·양방향 선택.
- 수정 `components/analyst/improvement-candidate-map.tsx`: Leaflet 후보 마커 ID·접근성 라벨·키보드 선택.
- 수정 `components/analyst/quality-simulator-dialog.tsx`, `.module.css`: 설명/선정 기준 팝업 전환, 실습 상태 유지.
- 수정 `components/analyst/quality-two-candidate-workspace.module.css`, `components/analyst/quality-model-alternative.module.css`: 모바일 전체화면 닫기 버튼을 지도 쪽으로 이동.
- 브라우저 검사 추가: `quality-rail-smoke.browser.cjs`, `quality-investigation-alternatives.browser.cjs`, `quality-investigation-responsive.browser.cjs`, `quality-mobile-control-overlap.browser.cjs`.
- 변경된 UI를 기준으로 팝업/모델/전체 기간 검수 스크립트 수정.

## 배포와 복구

- 배포된 별도 빌드: `outputs/quality-improvement-two-deploy/stage-candidate-rail-20261109/dist`
- 3016 서버: `scripts/serve-quality-candidate-rail-preview.cjs`
- 이전 빌드(롤백용): `outputs/quality-improvement-two-deploy/stage-simulator-fit-20261109/dist` 및 `scripts/serve-quality-simulator-fit-preview.cjs`
- 기존 3001/3014 서비스와 원본 데이터 그대로 유지. 3019 QA 프리뷰는 검증 종료 후 종료.

## 검증 결과 (실제 3016)

- TypeScript noEmit + oxlint 통과, vinext 프로덕션 빌드 성공.
- 원본·모델 관련 Node 테스트 12개 PASS, Edge Playwright 후보 목록/지도 상호작용·팝업·반응형 PASS.
- 전체기간 후보: DBSCAN 8곳, HDBSCAN 20곳, ST-DBSCAN 7곳, KDE 18곳, Spatial Scan 20곳, Bayesian 20곳 (표시 상한).
- 기간 분리 성능 검증: DBSCAN 7곳, HDBSCAN 16곳, ST-DBSCAN 5곳, KDE 15곳, Spatial Scan 17곳, Bayesian 20곳.
- 실제 범위 검토 필터 건수: DBSCAN 3, HDBSCAN 15, ST-DBSCAN 2, KDE 11, Spatial Scan 15, Bayesian 19.
- DBSCAN/대안 5종의 모든 후보 지도 마커 수=목록 후보 수, 목록 클릭·지도 클릭 동기화 PASS, 지도에서 최종 후보 선택 시 해당 목록 행 자동 스크롤 PASS.
- 1440/1024/800/680/390px에서 사이드바·지도 겹침 없음, 페이지 가로 넘침 없음, VWorld 타일 정상 (HTTP 200), JavaScript pageerror 0.
- 모바일 390px 상단 플라스크 아이콘과 전체화면 닫기 버튼 겹침 해결; 모바일 시뮬레이터 팝업 열기·닫기 PASS.
- 6개 시뮬레이터 모두 7단계·파라미터 변경·가상 실습 계산 및 독립 증거 표시 회귀 통과.
- 공통 2026-10-30 MOS KPI (기존/개선1/개선2) 동일: 전체 37,731통화, MOS 평가 26,688통화, 평균 4.11, 저MOS 288통화.
- 테스트 캡처: `outputs/quality-improvement-two-deploy/candidate-rail-responsive/dbscan-1440.png`, `hdbscan-1440.png`, `dbscan-390.png`, `hdbscan-390.png`.

## 주의

범위 검토 대상이 실측 무선 장애로 확정됐다는 뜻은 아니다. 표시 반경과 GNSS/3-Site 위치 불확실성은 다른 값이고, 해당 관측이 RTCP 저하 순간 발생 지점임을 확증하지 못한다. 후보 순번은 현장 조사 우선순위와 동일하지 않으며, 모델 간 후보 수 비교는 성능 우열이 아니다.
