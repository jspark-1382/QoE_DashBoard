# QoE 개선 2안 — 6종 후보 선정 모델 선택·실제 데이터 비교
검증일: 2026-11-07
프로젝트: QoE_Metrics / Windows 로컬 QA 포트: 3016

## 실행 화면
http://127.0.0.1:3016/qoe/?variant=improvement2&dateStart=2026-10-26&dateEnd=2026-10-30&mapMode=improvement

화면에서 `개선 2안 → 개선 후보 분석 → 후보 산정 모델 선택`으로 6종을 선택한다. 기본 선택은 **기존 DBSCAN**이며, 기존 대표점/반경/시뮬레이터와 MOS 카드도 변경하지 않았다. 대안 모델로 전환하면 지도, 후보 목록, 관련 원본 저MOS 통화, 고객 수·관측일·검증일 신규 고객 수 및 모델 설명이 바뀐다. 선택 모델 지도에서 '지도 전체 화면'으로 모델별 알고리즘/검증 한계를 읽을 수 있다.

## 분석 원본과 모집단 경계
- 원본 버전: `79840583bdb8e36221c2` (`public/quality-improvement/index.json`)
- SIP CDR, RTCP MOS(v5), 승인 GNSS/엄격 3-Site. CDR↔MDT 고유 연결 + 위치 승인 + 유효 MOS 조건을 만족하는 통화만 모델 입력.
- 원본 2026-10-26~30, 15개 날짜·시간 범위 전체일 사전 계산.
- 기간 3일 이상은 마지막 날을 독립 검증일로 분리. 후보 생성에 검증일 통화를 넣지 않는다.
- 기존 DBSCAN 100m, minSamples 2, 고유 저MOS 고객 3명/관측 2일 이상, 신규 고객 2명 재관측, 군집 전체 최대 점간 거리 200m 초과시 순위 보류 유지.
- 5일 MOS 평가 자료: 저품질 1,403건 중 위치 승인 131건, 나머지 129,537건 중 위치 승인 294건. **두 집단의 위치 확보율이 매우 다르므로 승인 위치만의 불량률을 네트워크 전체 불량률로 확대 해석할 수 없다.**
- Python 환경: scikit-learn 1.9.0(HDBSCAN 포함), scipy, numpy. 모델 재계산: `python scripts/build-quality-model-alternatives.py`. 현재 코드의 대상 기간은 위 5일로 고정되어 있으며, 새 날짜가 추가되면 입력 인덱스·기간 처리·테스트를 확장해야 한다.
- 모든 모델은 원본 Call ID, 고객 ID, 날짜, MOS, 위치 근거를 읽기 전용으로 사용. 화면에는 고객명을 A/B/C 익명 별칭으로 표기.

## 모델별 실제 산출(2026-10-26~30, 발견 26~29, 검증 30)
| 모델 | 조사 후보 | 계산 원리 | 해석 |
|---|---:|---|---|
| DBSCAN (기존 승인) | 7곳 | Haversine 이웃 100m, 고유 고객 3명/2일 조건 | 현재 기준 |
| HDBSCAN | 16곳 | Haversine 계층 밀도 군집, min_cluster_size 3, min_samples 2 | 공간 군집 비교 |
| ST-DBSCAN | 5곳 | 통화시각+거리: 100m·48h, minSamples 2 | 공간·시간 군집 |
| Adaptive KDE | 15곳 | 가우시안 커널, GNSS 폭 70m·3-Site 160m, 후보 지지 범위 180m | 밀도 피크 탐색 |
| Spatial Scan | 17곳 | 100/200/400m 원창, Bernoulli LLR, 모든 승인 위치 중심의 미리 지정된 창, 라벨 99회 순열 최대통계량 | **표본 편향: 탐색 전용** |
| Bayesian (Empirical Bayes 근사) | 20곳(화면 상위 제한) | 200m 공간 가중·하루당 0.7 시간 감쇠 + 강도 20 Beta 사전분포, 220m 후보 근방 | **표본 편향: 탐색 전용, BYM2 아님** |

후보 개수 자체로 모델의 품질을 평가할 수 없다. 각 모델의 후보 경계가 달라 후보 7곳과 16곳은 1:1 대응하지 않는다. KDE 폭 70/160m는 GNSS/3-Site의 관측 오차 추정치가 아닌 *시뮬레이션 가정*. Scan의 99회 순열 p값은 모집단 확률이 아닌 위치 승인 표본 내부의 조건부 탐색 통계이며, 고객별 반복·관측 선택 편향을 교정한 유의확률이 아니다. Bayesian의 사후 비율 및 구간은 경험적 가중 Beta-binomial 근사로서 독립 사례 가정을 완전 만족하거나 관측 편향을 해소한 계층적 공간 위험모형이 아니다.

## 구현 구조
- `scripts/build-quality-model-alternatives.py`: 별도 대안 모델 산출. 기존 `scripts/voice_improvement_1.py` 변경 없음.
- `public/quality-models/index.json` + `public/quality-models/<revision>/<scopeKey>.json`: 15개 범위, 5개 대안 모델 각각 계산 결과·구성 통화·검증일 통화·범위와 모델 파라미터; 기존 strict 결과와 서로 별개.
- `lib/analyst/quality-model-alternatives.ts`: sourceRevision, scope, scopeKey, 정합성/검증일/후보 구성 통화 검증 및 모델 설명.
- `components/analyst/quality-improvement-candidate-panel.tsx`: `후보 산정 모델 선택` (기존 DBSCAN + 5개 대안). 기존 기본값·모드 전환 유지.
- `components/analyst/quality-model-alternative-workspace.tsx`, `.module.css`: 지도·후보 목록·익명 고객별 원본 저MOS 통화 표·검증일 신규 고객 수·탐색 전용 경고·모델별 전체화면 방법론 설명.
- `scripts/serve-quality-multimodel-preview.cjs`: 3016 서버, 독립 빌드 경로 `outputs/quality-improvement-two-deploy/stage-multimodel-20261107/dist`. VWorld API 환경 설정 `.env.local`을 빌드 단계에 포함하여 지도 배경 정상 로딩.
- 롤백용 이전 빌드: `outputs/quality-improvement-two-deploy/stage-circles-20261107/dist` 및 `scripts/serve-quality-two-circles-preview.cjs`. 3001/3014 서버·원본 파일 변경 없음.

## 테스트 및 발견/수정 결함
- 실제 원본 15개 범위와 모델별 후보 ID·고객 수·날짜·MOS, 발견/검증 분리, 원본 revision 일치 검사 PASS.
- Python 합성 표본 알고리즘 테스트 6/6: Haversine 미터 변환, HDBSCAN 독립성, ST-DBSCAN 시간 차단, KDE, Scan/Bayes 탐색 상태, 마지막 날 누수 방지.
- Node 모델·기존 데이터 회귀 테스트 17개 + 기존 확대 회귀 29개 PASS; tsc/oxlint PASS.
- Edge/Playwright 3019 사전 검사 및 3016 적용 후 동일 검사 PASS:
  * 모델 6종 전환·모델별 지도·목록·상세 통화·후보 선택·전체화면·ESC 정상.
  * 2560/1440/1280/1024/800/680/390 화면 폭 중 신규 모델 1440~390 전 구간 레이아웃 충돌·가로 넘침 없음.
  * 390 모바일 전체화면에서 모델 설명이 약 108px로 압축되는 문제를 발견: `data-map-surface` 속성 누락이 원인. 수정 후 설명과 지도 동시 표시 검증.
  * 후보 통화 조사 버튼 연결, 1일만 선택했을 때 고유 2일 조건으로 후보 0곳 표시 정상.
  * 기존 DBSCAN의 5점×100m 원 및 최종 조사 원, 지도 모드의 KPI 유지: 37,731 / 26,688 / 4.11 / 288.
  * VWorld 배경지도 타일 HTTP 200, 타일 로딩 실패 0건, JS pageerror 0건.
- 테스트: `scripts/tests/test_quality_model_alternatives.py`,
 `scripts/tests/quality-model-alternatives.test.cjs`,
 `scripts/tests/quality-multimodel.browser.cjs`,
 `scripts/tests/quality-multimodel-edge.browser.cjs`,
 `scripts/tests/quality-multimodel-tiles.browser.cjs`.

## 사용 제약/후속 검증
- 사용자 시간 필터가 사전 산출된 전체일 범위를 벗어나면 "해당 조건 결과 미생성"으로 표시하며 다른 시간대의 결과로 바꿔 보여주지 않음.
- "최선의 알고리즘"은 현재 확정하지 않음. 훈련일/검증일 분리 외에도 더 긴 후속 관측일, 같은 고객 재통화 과대 편향, 정상 통화 위치 표본 확보율 개선, GNSS/3-Site 오차 민감도, 현장 RF·SCAN 확인을 거쳐야 한다.
- Scan/Bayes의 점수와 p값/사후확률을 공식 현장 개선 우선순위로 사용하지 않음.
