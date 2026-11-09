# 개선 2안 시뮬레이터 — 100m 이웃 원과 최종 조사 원 구분 (2026-11-07)

## 사용법
1. http://127.0.0.1:3016/qoe/?variant=improvement2&dateStart=2026-10-26&dateEnd=2026-10-30&mapMode=improvement 접속
2. '조사 후보 지도'의 '지도 전체 화면' 선택.
3. 왼쪽 체험형 시뮬레이터에서 STEP 4 '지역 묶기', STEP 5 '범위 판단', STEP 7 '최종 결과' 선택.
4. '관측점 사이 거리' 슬라이더를 조작하면 군집의 대표점, 최대 거리, 최종 원 반경이 함께 변경.
5. 실제 후보는 시뮬레이터 아래 '실제 데이터에 대입해 보기'에서 동일한 두 원을 별도 그림으로 확인.

## 두 원의 차이
- 각 관측점별 100m 청록 점선 원: DBSCAN이 이웃을 찾는 계산 범위. 고객 1명당 1개가 아닌 저MOS 관측점 1개당 1개로 표현한다. 실제 지도에 이 원을 모두 표시하지 않음.
- 대표점 기준 주황 실선 원: DBSCAN 이후 선정된 실제 관측점 Minimax medoid를 중심으로 후보당 1개를 표시하는 최종 조사 범위.
- 표시 반경 공식: ceil(max(100m, 대표점~최원거리(m) + 20m) / 10) × 10m.
- 군집 전체 최대 점간 거리 >200m이면 범위 검토가 필요하며 조사 순위는 보류. 이것은 표시 반경과 별개의 값이다.
- STEP 4에는 관측점별 100m 원만, STEP 5·7에는 그 원과 최종 원 1개를 함께 표시.
- STEP 5에는 대표점에서 최원거리 선과 최대 점간 거리 선을 구분해 표시.
- STEP 7에는 100m 검색 반경, 관측점 수, 대표점~최원거리, 최종 표시 반경, 최대 점간 거리, 범위 검토 여부 등을 표시한다.
- 실제 선택 후보의 승인된 발견 통화 GNSS/검토 통과 3-Site 위치에도 관측점마다 100m 원 및 대표점 기준 최종 원을 색으로 구분해 그린다. 실제 후보의 원본 데이터나 알고리즘 계산 결과 자체는 수정하지 않았다.

## 실제 수치
- 가상 직선 예시: 관측점 5개, 이웃 원 각각 100m, 간격 45m => 대표점~최원거리 90m, 최종 원 반경 110m.
- 관측점 간격 65m로 변경 => 최대 점간 거리 260m, 대표점~최원거리 130m, 최종 원 반경 150m, 범위 검토 필요.
- 실제 후보 지역 1 => 관측점 5개, 대표점~최원거리 약 145.4m, 최종 표시 반경 170m, 최대 점간 거리 약 208.9m. 범위 검토 필요.
- 도식의 원은 설명용이며 지오데식 측위 오류 반경, MOS 열화 순간의 정확한 위치, 무선 원인을 증명하지 않는다.

## 변경
- lib/analyst/quality-two-simulation.ts: SIM_NEIGHBOR_EPS_M=100, SIM_DISPLAY_MARGIN_M=20.
- components/analyst/quality-two-simulator.tsx: 동적 SVG 두 종류의 원, 최대 거리/대표점~최원거리 연결선, 4·5·7단계 범례와 계산식, 결과 수치.
- components/analyst/quality-two-real-geometry.tsx: 실제 후보 점별 100m 원 및 최종 원. 축척을 조정해 원 전체가 잘리지 않게 함.
- components/analyst/quality-two-simulator.module.css: 색상별 범례, 계산 설명 패널.
- scripts/tests/quality-two-circles.test.cjs, scripts/tests/quality-two-circles.browser.cjs: 원 개수·SVG 축척·최종 반경·실제 후보 일치 검증.

## 검증 (배포 전 3019, 배포 후 3016)
- 관련 Node 유닛 20/20 통과, TypeScript 검사 통과, oxlint 통과.
- 단계 시뮬레이터 기존 브라우저 검사 통과, 전체화면 지도 설명 검사 통과, 후보 화면 레이아웃 검사 통과.
- 3016 실서버 Playwright/Edge 테스트: STEP 4 100m 원 5개, STEP 5 최종 원 1개, 기본 최종 원/이웃 원 반경비 1.1, 간격 65m인 경우 1.5, 실제 후보 1의 1.7, SVG 원 잘림 없음, 선택 후보 변경 시 원 변경, 브라우저 JS 오류 0.
- 3016 실서버 기존/개선1/개선2 공통 KPI(10/30): 통화 37,731 / MOS 평가 26,688 / 평균 MOS 4.11 / 저품질 288, 일치.
- 기존 3001/3014 서비스, 원본 CDR/MDT/RTCP/GNSS, Python 산정 로직 불변.

## 안전성과 복구
- 현재 3016: scripts/serve-quality-two-circles-preview.cjs → outputs/quality-improvement-two-deploy/stage-circles-20261107/dist
- 이전 3016: scripts/serve-quality-two-simulator-preview.cjs → outputs/quality-improvement-two-deploy/stage-simulator-20261107/dist
- 이전 빌드는 보존. 3016만 대상으로 이전 스크립트 재기동해 복원 가능. 3001/3014는 건드리지 말 것.
- 테스트 캡처: outputs/quality-improvement-two-deploy/circles-live-qa/step4-neighbors.png, step5-two-circles.png, actual-two-circles.png.
