# 개선 2안: 5개 대안 알고리즘의 체험형 시뮬레이터 (2026-11-07)

## 적용 및 접근
- 실제 3016 화면: http://127.0.0.1:3016/qoe/?variant=improvement2&dateStart=2026-10-26&dateEnd=2026-10-30&mapMode=improvement
- 메뉴: **개선 2안 → 개선 후보 분석 → 후보 산정 모델 선택**.
- DBSCAN(기존 기준)을 제외한 5개 모델(HDBSCAN, ST-DBSCAN, Adaptive KDE, Spatial Scan, Bayesian Empirical Bayes)을 하나씩 선택하고, **지도 전체 화면**을 누른다.
- 왼쪽 알고리즘 설명 패널 최상단의 **직접 조작하는 모델 학습**에서 다음을 조작한다.
  1. 가상 상황 선택: 기본(두 지역), 분산·시간차, 정상 표본 증가.
  2. STEP 1~7 버튼: 입력 관측 → 거리·가중치 → 핵심 수치 → 후보 형성 → 선정 기준 → 다른 날 검증 → 최종 비교.
  3. 모델별 파라미터 슬라이더. 실제 Python 모델로 미리 계산된 108개 결과 상태가 연결되어 있으며 변경 즉시 후보 수·구성점·원·수치가 변한다.
  4. 후보가 여러 개면 **가상 후보 선택(지역 1·2·...)**, 도식은 **전체 관측 / 선택 후보 확대**로 전환.
  5. 이전·다음·자동 재생(1.7초 간격)·일시정지·초기화.
  6. 끝부분 **실제 데이터 대입**: 오른쪽 지도/후보 목록에서 선택된 실제 후보의 승인된 저MOS 통화 구성점, 고유 고객 수, 일자, 검증일 새 고객, 대표 위치 및 실제 지도 표시 반경을 별도 그림으로 설명.
- 가상 시뮬레이터 수치 변경은 **원본 통화·실제 후보 지도·3016 실제 계산 결과를 변경하지 않는다.** 실제 데이터 예시만 화면 오른쪽의 후보 선택에 연동된다.

## 모델별 설명 도식
- **HDBSCAN**: 점별 core distance, 직접 거리와 MRD=max(coreA,coreB,d), MRD 최소신장트리, 실제 scikit-learn HDBSCAN의 결과 그룹, 최소 군집 크기 3/4/5, min_samples 2/3 및 3고객·2일/검증일 100m 조건, Minimax Medoid와 최종 표시 반경. MRD 트리는 밀도 계층 설명이며 단독으로 HDBSCAN 라벨을 산출하지 않는다는 점을 명시.
- **ST-DBSCAN**: 70/100/150m 공간 거리, 24/48/72시간, AND 이웃 판정, 실제 Python 시공간 연결선/그룹, 고객/일자 심사, 검증일 분리, 공간 거리와 최종 표시 원의 차이.
- **Adaptive KDE**: GNSS 기본 폭 70m·엄격 3-Site 160m의 가우시안 커널, 커널 폭 ×0.6/1/1.4, 피크 후보 검색 120/180/240m, 고객 반복 가중치, 실제 밀도 점수와 생성 그룹. 폭은 가정이지 실측 위치 오차가 아님. 저MOS KDE는 정상 대비 상대 위험도를 뜻하지 않음.
- **Spatial Scan**: 승인 위치 표본의 저MOS/정상·주의 점을 함께 표시, 100/200/400m 원형 검사창, 내부 저MOS 비율과 외부 표본, Bernoulli LLR, 99회 라벨 순열 최대통계량으로 조건부 p값, 고객·일자 및 새 고객 재관측. 실제 망 전체의 유의확률/불량률로 해석 금지.
- **Bayesian (Empirical Bayes)**: 위치 승인 표본 기준 p0, 공간 가중 폭 100/200/300m와 날짜 감쇠 0.7, Beta 사전 강도 5/20/50, α0/β0, 가중 저MOS·정상, SciPy에서 구한 사전/사후 Beta 밀도 곡선과 사후평균·95% 신용구간, 220m 구성 범위, 검증일. 정식 BYM2 공간 계층모형이 아니며 표본 편향과 의존성을 교정하지 못함.

## 원본·가상 구분
- 실제 후보 모델 자료: `public/quality-models/`, 기준 revision `79840583bdb8e36221c2`, 기존 5개 대안 보고서와 DBSCAN 산출 결과 불변.
- 체험형 데이터: **실제 고객 좌표를 사용하지 않는 독립적인 결정론적 합성 통화 좌표**를 `public/quality-model-simulations/v1/*.json`에 보관.
- 생성: `python scripts/build-quality-model-simulations.py`. 원본 Python 구현인 `scripts/build-quality-model-alternatives.py`의 각 모델 함수를 옵션 파라미터와 함께 실제 실행해 저장.
- Python 모델 함수에는 기본값을 그대로 보존하는 선택적 파라미터만 추가했다. 기존 사전 계산 모델 JSON, 원본 CDR/MDT/RTCP/GNSS, 모델 산정 기본값 및 3016 DBSCAN 자료는 변경하지 않았다.
- 108개 설정 상태: HDBSCAN 18, ST-DBSCAN 27, KDE 27, Spatial Scan 9, Bayesian 27.
- Synthetic 3종: 기본, 분산·시간차, 정상 표본 증가. 시간/공간 변화와 정상 표본 변화가 수치와 후보에 영향을 주는 것을 확인할 수 있도록 설계.
- 사용자는 옵션에 표시된 이산적인 단계만 선택할 수 있으며, 슬라이더 이동할 때마다 실시간 Python을 호출하는 것은 아니다. 각 상태는 사전 Python 계산 결과를 사용한다.
- 실제 모델 기본 데이터는 동일하며 5일 범위(2026-10-26~30)에서 DBSCAN 7곳, HDBSCAN 16곳, ST-DBSCAN 5곳, KDE 15곳, Spatial Scan 17곳, Bayesian 20곳 표시.

## 변경 파일
- `scripts/build-quality-model-alternatives.py` — 기존 기본 결과를 유지하면서 각 알고리즘에 시뮬레이션용 선택적 파라미터를 추가.
- `scripts/build-quality-model-simulations.py` — 모델별 합성 입력, Python 계산 실행, 결과 사전 생성, 해시/index 출력.
- `public/quality-model-simulations/v1/index.json` + 다섯 모델 JSON — 총 108 상태.
- `lib/analyst/quality-model-education.ts` — 모델·스코프 선택과 분리된 가상 계산 결과 검증 로더 및 타입.
- `components/analyst/quality-model-simulator.tsx` & `quality-model-simulator.module.css` — 7단계, 조작 컨트롤, 그림, 공식, 실제 후보 기하 그림, 자동 재생, 범례 및 경고.
- `components/analyst/quality-model-alternative-workspace.tsx` — 전체화면 왼쪽에 선택 모델의 시뮬레이터/실제 후보 연동.
- `components/analyst/quality-model-alternative.module.css` — 시뮬레이터 높이 유지, 긴 내용의 패널 내 스크롤, 기존 방법 설명과 충돌하지 않도록 selector 범위 정리.
- `scripts/tests/test_quality_model_simulations.py` — 108가지 Python 재계산 일치, 시각화 사전 데이터 해시, 검증일 누수 및 구성 고객/날짜 검증.
- `scripts/tests/quality-model-simulators.browser.cjs` — 3016에서 5모델 각각 7단계·파라미터·3종 상황·원본 후보 연동·복귀 확인.
- `scripts/tests/quality-model-simulators-zoom.browser.cjs` — 확대/전체 축척, 자동 재생과 일시정지 테스트.
- `scripts/serve-quality-model-simulators-preview.cjs` — 독립 배포 빌드의 3016 로컬 서버.

## 검증
- Python 108개 생성 상태 각각 실제 Python 모델 재계산 및 ID·고객·날짜·검증·후보 일치. Python 단위 테스트 4/4 통과.
- 기존 모델 Python 테스트 6/6 및 관련 Node 회귀 통과; TypeScript noEmit, oxlint 통과.
- Edge Playwright에서 3019 사전/3016 실서버 검증 통과:
  - 5개 모델 모두 7단계 버튼·공식·수치·3종 상황/파라미터 조작·실제 오른쪽 후보 선택 연동.
  - 기본 시뮬레이션 가상 후보 2(HDBSCAN), 2(ST), 2(KDE), 5(Scan), 2(Bayesian) 산출(실제 모델 후보 수와는 독립적).
  - 확대/전체 뷰: 5모델 모두 구성점 수/축척 변화 검증. HDBSCAN 좌표 확대율 1.44배, ST 1.44배, KDE 1.16배, Scan 1.44배, Bayes 1.4배.
  - 자동 재생·일시정지 확인, 모바일 전체화면·기존 후보 조사 버튼 연결 확인.
  - 기존 DBSCAN STEP 4에 100m 이웃 원 5개, STEP 5에 최종 원 1개, 실제 후보 지역 1의 170m, SVG 원 잘림 없음.
  - VWorld 지도 타일 일반 지도/전체화면 및 모델 전환 시 HTTP 200, 로드 실패 0, JS pageerror 0.
  - 기존 품질 현황/개선 1안/개선 2안 KPI 37,731 / MOS 26,688 / 평균 4.11 / 저MOS 288 동일.
- 발견/수정: MethodPanel 내부 긴 시뮬레이터가 flex 축소로 단계 버튼 클릭을 가림 -> `flex:0 0 auto`, 모델 설명 CSS selector direct-child 제한. 외곽 전체 관측으로는 일부 집합이 너무 작게 보여 `선택 후보 확대` 전환 추가.

## 운영 상태/롤백
- 새 3016: `scripts/serve-quality-model-simulators-preview.cjs` → `outputs/quality-improvement-two-deploy/stage-model-simulators-20261107/dist`
- 직전 안정 빌드: `scripts/serve-quality-multimodel-preview.cjs` → `outputs/quality-improvement-two-deploy/stage-multimodel-20261107/dist` 보존.
- 모든 빌드는 로컬 127.0.0.1 전용. 신규 stage는 `.env.local`(VWorld 설정 포함)을 값 노출 없이 복사했다.
- 3001/3014 기존 서버 및 실측 원본 데이터는 보존. 3019 임시 QA만 종료.

## 추가 연구 필요
실제 현장 위험 우선순위를 자동 확정하는 기능이 아니다. GNSS/3-Site 위치오차 표본 확보, 정상통화 위치 모집단 균형, 다른 날짜의 전향적 검증, 반복 고객 종속성 보정, 현장 VoLTE·RF·HO 증거 확인을 해야 한다.
