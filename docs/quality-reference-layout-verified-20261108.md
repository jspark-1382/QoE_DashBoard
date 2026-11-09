# 개선 2안 지도 전체화면 — 사용자 레퍼런스 이미지 정합 UI 구현 검증
검증일: 2026-11-08
로컬 프로젝트: QoE_Metrics
접속: http://127.0.0.1:3016/qoe/?variant=improvement2&dateStart=2026-10-26&dateEnd=2026-10-30&mapMode=improvement

## 사용자 레퍼런스 대비 구현
- 전체화면 상단에 **실제로 조작 가능한** 분석 목적(전체기간/성능검증), 후보 산정 모델 6종 선택 및 시뮬레이션 버튼을 가로 형태로 배치.
- 왼쪽 ~31%: 조사 후보 지도 제목/짧은 설명 → 범례(선택/기타/GNSS/검토 통과 3-Site) → 선택 후보 카드 1개(고유 저MOS 고객/통화/관측일/실제 표시 반경) → 3개 탭(알고리즘 설명/시뮬레이터/선정 기준) → 짧은 bullet 선정 로직 → 고정 하단 버튼 2개(시뮬레이터 열기/후보 통화 보기).
- 오른쪽 ~69%: 실제 VWorld 지도, 선택 마커 붉은색 강조, 다른 후보 회청색, GNSS 주황·승인 3-Site 보라색, 실제 후보 마커의 라벨 및 실제 산출 반경 m 단위 라벨. 지도 맨 위 오른쪽 전체 화면 닫기.
- 일반 화면은 기존 지도·후보 목록 구조를 유지.
- '후보 통화 보기' 클릭 시 전체화면 종료 후 해당 모델의 고객·통화 탭 활성화.
- 전체화면 상단에서 모델을 변경해도 전체화면 상태가 유지되도록 상태 보존. 데이터/모델이 다르게 로드되는 과정에서 이전 결과를 섞지 않음.
- 레퍼런스의 4명·4통화·3일·100m와 후보 A~E의 가상 좌표를 복제하지 않음. 실제 원본 및 위치 승인 정책으로 나온 값을 표시. 2026.10.26~30 DBSCAN 첫 후보: 양재2동, 고유 고객 9명·저MOS 9통화·5일·표시 반경 160m. 지도 라벨 160m와 일치.
- 100m DBSCAN 이웃 검색 거리와 실제 표시 반경을 구분하며 지도 원은 실제 MOS 저하 순간의 위치 오차 반경이 아님.
- Spatial Scan/Bayesian의 관측 위치 표본 편향/탐색 전용 경고 유지; 원본 SIP/RTCP/MDT/GNSS 및 모델 계산값 불변.

## 변경 파일
- components/analyst/map-panel-frame.tsx / .module.css: 전체화면 실제 모델 선택기 및 상태 유지.
- components/analyst/quality-improvement-candidate-panel.tsx: 전체화면 설정 바 동기화.
- components/analyst/quality-two-candidate-workspace.tsx / .module.css: DBSCAN 참조 카드, 3탭, 간결 요약, 하단 CTA.
- components/analyst/quality-model-alternative-workspace.tsx / .module.css: 5개 대안 모델의 동일 구조.
- components/analyst/improvement-candidate-map.tsx / .module.css: 전체화면에서 선택 후보 붉은 원·라벨, 다른 후보 라벨, 실제 후보별 표시 반경 마커. 일반 모드 기존 시각은 유지.
- scripts/tests/quality-reference-layout.browser.cjs: 실제 브라우저 레퍼런스 구조 및 모델 전환 검사.
- 기존 회귀 검사 일부에 3탭 설명 뷰 변경 반영.

## 실행과 검증
- 독립 빌드: outputs/quality-improvement-two-deploy/stage-reference-ui-20261108/dist
- 3016 실행 어댑터: scripts/serve-quality-reference-ui-preview.cjs
- 롤백: outputs/quality-improvement-two-deploy/stage-map-rail-20261108/dist 및 scripts/serve-quality-map-rail-preview.cjs
- 임시 3019에서 빌드/브라우저 QA 후 3016 적용. 3001/3014 포트 및 원본 불변.
- TypeScript noEmit, oxlint PASS. Node 데이터/모델 관련 테스트 16개 PASS.
- Edge Playwright 실제 3016:
  - 6개 알고리즘 선택; 전체기간/성능검증 전환 결과 기존 산출과 일치(DBSCAN 8/7, HDBSCAN 20/16, ST-DBSCAN 7/5, KDE 18/15, Scan 20/17, Bayesian 20/20 표시 상한).
  - 전체화면 상단 설정 2종 표시·조작, DBSCAN 및 HDBSCAN 3개 탭·2개 CTA, 후보 카드 실제 값·지도 반경 일치.
  - 실제 후보 줌/패닝 및 VWorld 타일 29개 로드(실행별 값 다름), 타일 HTTP 오류 0, pageerror 0.
  - 전체화면에서 HDBSCAN→Spatial Scan→DBSCAN 전환 후에도 모달 유지.
  - 1024/800/680/390px 지도·패널 겹침/가로 스크롤 없음. 390px에서 지도 높이 약 320px.
  - 5개 대안 알고리즘 7단계 시뮬레이터, 파라미터·자동 재생/정지·확대 기능 유지.
  - 2026.10.30 공통 KPI: 전체 통화 37,731 / 평가 26,688 / MOS 4.11 / 저MOS 288, 기존/개선1/개선2 동일.
- 실제 캡처:
  - outputs/quality-improvement-two-deploy/reference-live-qa/dbscan-1650.png
  - outputs/quality-improvement-two-deploy/reference-live-qa/hdbscan-1650.png
  - outputs/quality-improvement-two-deploy/reference-live-qa/hdbscan-390.png

## 주의
시각 디자인 레퍼런스의 정확한 픽셀 좌표/가상 지도와 1:1 일치하도록 데이터를 왜곡하지 않았습니다. 구현한 영역 구조·탭·버튼·색상·상단 컨트롤은 레퍼런스에 맞췄으며 데이터는 실제 계산 결과입니다.
