# 개선 2안 — 체험형 후보 산정 시뮬레이터·실제 관측점 그림 (2026-11-07)

## 요청과 적용 화면
- 문제: 기존 전체화면 왼쪽 설명이 긴 글로 구성되어 처음 보는 사람이 알고리즘을 이해하기 어려움.
- 실제 적용: `http://127.0.0.1:3016/qoe/?variant=improvement2&dateStart=2026-10-26&dateEnd=2026-10-30&mapMode=improvement`
- 화면: **개선 2안 → 개선 후보 분석 → 지도 전체 화면**. 좌측에 단계별 조작형 시뮬레이터, 우측 기존 Leaflet 지도. 작은 화면에서는 상하 배치.
- 기존 글 설명은 `계산 규칙 · 단계별 상세 설명 펼치기`로 기본 접힘.
- 실제 후보를 클릭하면 하단 `실제 데이터에 대입해 보기`에 통화별 GNSS/3-Site 위치 관측점과 대표 중심 및 표시 반경의 개념도 표시. 원본 데이터와 가상 실험을 배경/명칭으로 명확히 분리.

## 시뮬레이터 7단계
1. 조건: 원본 선택일의 발견/검증 구분 달력 그림.
2. MOS: 1~5 조절 슬라이더와 저품질/주의/양호 게이지. 후보 채택 MOS 범위는 1 이상 3 미만.
3. 위치: CDR→MDT 고유 연결 및 GNSS/엄격 3-Site/기지국 BYE 비교 흐름. 유효 증거 제외 동작 확인.
4. 지역: 5개의 **가상** 관측점, 고객 A~E와 100m 이하 이웃 연결선, 3명 이상·2일 이상, 거리 슬라이더로 DBSCAN 군집 조건 변화를 확인. 100m보다 멀어지면 군집이 없어지고, 고유 고객 1명은 반복 통화를 하더라도 후보 미선정.
5. 범위: 대표점과 표시 반경 및 군집 내 최대 점간 거리. 200m 초과 시 범위 검토/순위 보류.
6. 검증: 가상 신규 고객 F~H의 검증일 점을 추가하며 거리 및 고객 수를 바꿔 재관측 기준(새 고객 2명+100m 이내)을 확인.
7. 요약: 현재 조절한 가상 입력을 바탕으로 군집 수·고유 고객·날짜·최대 거리·표시 반경·검증일 신규 고객·후보 판정.
- 프리셋: 기준 통과 / 지역 범위 초과 / 한 고객만 / Cell만 존재 / 재관측 거리 밖.
- 초기화/이전/다음/단계 직접 선택 가능.
- **가상 예시를 조작해도 기존 7곳의 실제 후보 및 우측 지도나 원본 파일에 변경 없음.**

## 알고리즘 정확성
- 시뮬레이션: `lib/analyst/quality-two-simulation.ts`는 단계별 정책을 재현하는 독립 순수 함수로, 사용자 설명용 가상 직선 좌표의 평면 거리만 사용함.
- 실제 산출: `scripts/voice_improvement_1.py`는 위경도 Haversine DBSCAN을 사용함. 시뮬레이터가 실제 지역 후보를 다시 계산하는 것은 아님.
- 스텝별 규칙:
  - `1<=MOS<3`, 고유 MDT 연결, GNSS/검토 승인 3-Site 좌표만 후보 입력.
  - DBSCAN eps=100m, min_samples=2 (자기 점 포함), 집계된 군집에 고유 고객≥3, 날짜≥2.
  - 대표점은 원본 구성 관측점 중 최대 거리 최소화(미니맥스 메도이드).
  - 표시 반경=ceil(max(100, 대표점과 최원점 거리+20)/10)*10m.
  - 구성점 최대 점간 거리 >200m이면 범위 검토, rank 미확정.
  - 검증일 발견 구성점 100m 이내 새 고객≥2명으로 재관측.
- 실제 후보 근거 시각화는 **실제 상세 후보 원본** `nearbyPoints`, `medoid`, `displayRadiusM`만 사용함. 현장 불량 위치/원인 확정은 하지 않는다.

## 코드
- 신규 `lib/analyst/quality-two-simulation.ts`
- 신규 `components/analyst/quality-two-simulator.tsx`, `.module.css`
- 신규 `components/analyst/quality-two-real-geometry.tsx`
- 수정 `components/analyst/quality-two-algorithm-guide.tsx`, `.module.css`
- 수정 `components/analyst/quality-two-candidate-workspace.module.css`: 800px에서 좌측 설명 최소 너비 확보.
- 추가 검사 `scripts/tests/quality-two-simulator.test.cjs`, `quality-two-simulator.browser.cjs`, `quality-two-simulator-screenshot.browser.cjs`.
- 단계 상세 설명/전체화면 회귀 스크립트 `quality-two-algorithm-guide.browser.cjs`도 기존 글 펼치기 방식으로 조정.

## 발견/수정한 실제 UI 결함
- 최초 화면 시뮬레이터가 화면에는 존재하지만 일부 컨트롤이 표시되지 않음.
- 원인: 왼쪽 `.articles` flex-column의 자식이 flex-shrink=1 기본값으로 약 200px로 축소되고, `.simulator{overflow:hidden}`이 아래 SVG/슬라이더를 잘라내고 있었음.
- 해결: `.articles > *{flex:0 0 auto}` 적용 후 브라우저 캡처로 SVG·슬라이더가 나타나는 것을 직접 확인.
- 스텝 4에서는 신규 F/G 검증점이 미리 나타나지 않게 하고, 스텝 6부터만 표시.
- 800px 레이아웃에서 좌측 폭 288px(실제 컨텐츠 267px) → 좌측 폭 320px로 넓힘.

## 검증 결과
- `tsc --noEmit`, oxlint: PASS.
- 신규 순수 시뮬레이터 테스트: 8/8 PASS (MOS 경계, GNSS/Cell, 같은 고객, 일자, DBSCAN 단절, 연결 사슬, 최대 점간 거리, 검증일 신규 고객).
- UI/원본 회귀 테스트 실행: 31/31 PASS, 추가 관련 테스트 12/12 PASS.
- Python 원본 후보 산정 테스트: 15/15 PASS.
- 실제 Edge/Playwright: 새 `quality-two-simulator.browser.cjs` PASS, 기존 `quality-two-algorithm-guide.browser.cjs` PASS, `quality-two-usability.browser.cjs` PASS. 임시 3019 사전 검사, 최종 3016 배포 후 동일 검사를 재실행하여 PASS.
- 시뮬레이터 단계 버튼/슬라이더/프리셋/초기화/그림·판정 동기화, 선택 실제 후보와 연동, 기존 지도 마커, 휠 줌, ESC 및 전체화면, 1440·1024·800·680·390px 레이아웃, 브라우저 pageerror 0.
- 실서버 KPI(2026-10-30) 품질 현황/개선1/개선2 일치: 37,731 / 26,688 / 평균 MOS 4.11 / 저품질 288.
- 실서버 3016: 새 독립 빌드 `outputs/quality-improvement-two-deploy/stage-simulator-20261107/dist`; `scripts/serve-quality-two-simulator-preview.cjs` 사용. 3001·3014 서버 및 원본은 변경 없음.
- 이전 배포본 `stage-algorithm-20261107/dist`를 복구용으로 보존함.

## 현장 정확도 경계
- 가상 좌표의 거리 시뮬레이션은 학습용이며 실제 GNSS 오차/3-Site 위치 정확도나 실제 무선 불량 원인을 산정하지 않는다.
- 실제 후보의 독립 재관측 여부와 모호한 위치의 현장 원인 검증은 서로 다른 문제다.
- 원본 RTCP MOS(v5) Call 단위로 실제 열화 순간을 확정할 수 없다.

