# QoE 산식 변경: SIP Drop MOS(v5) 패널티 (2026-11-09)

## 산정 기준 (화면 표시 및 초기 생성 모두 동일)
- RTCP 원본 MOS(v5)는 그대로 보존한다 (\`mos\`, \`mosV5Original\`).
- SIP CDR 11.REASON이 공통 \`classifySipReason11\`에 의해 \`drop\`이면 \`qoe = originalMosV5 - 2.5\`.
- 기타/Normal은 \`qoe = originalMosV5\`.
- 원본 MOS 범위 1..5 밖, 결측/NaN은 \`qoe=null\`로 미평가 처리. 음수 QoE는 유효한 저품질 조정 결과이며 인위적으로 1점에 맞춰 잘라내지 않는다.
- QoE 등급: 불량 <3, 보통 3~<3.5, 양호 >=3.5. Drop 평가 가능한 통화의 최고값은 2.5이므로 양호 0건.
- 재차 로드하거나 데이터를 집계할 때는 이미 계산된 qoe가 아니라 항상 **원본 MOS(v5)** 를 사용해 이중 차감을 방지한다.

## 데이터 처리 및 UI 경로
- 최초 CDR 생성식: \`scripts/build_voice_1030.py::derive_call_qoe\`. 기존 발행 JSON 원본을 덮어쓰지 않음.
- 현재 발행 데이터에 대한 최초 로드 보정: \`lib/analyst/data-loader.ts::readOverview\`, \`lib/analyst/data.ts::normalizeDay\`. 날짜별 기존 원본 MOS·SIP REASON에서 qoe 파생.
- 공통 TS 산정: \`lib/analyst/derived-qoe.ts\`. 기존 SIP reason classifier 사용.
- 품질 분포/시계열/통화 등급/저품질 통화·지역 분석: \`lib/analyst/quality-proposal-metrics.ts\`, \`quality-proposal-four.ts\`, \`improved-overview.ts\`, \`overview.ts\`, \`overview-analytics.ts\`.
- \`components/analyst/quality-proposal-four.tsx\`: Drop 분포, KPI, 통화 목록, CSV, 선택 통화 팝업에서 보정 QoE를 표시하고 원본 MOS를 별도 보존 및 표기. 고객 통화 상세의 QoE 등급도 \`qoe\` 값에 연동.
- CSV에는 보정 QoE와 원본 MOS(v5) 열을 모두 제공함.
- 기존 \`public/voice-1030-data\`, \`public/analyst-overview\` 발행 파일과 GNSS/MDT/RTCP 원본 파일은 수정하지 않음.

## 실제 검산
2026-10-30: SIP Drop 53, 유효 45, 미평가 8, Drop 보정 후 불량 45 / 보통 0 / 양호 0. 일 전체 저QoE 325 (기존 원본 MOS<3 288).
2026-10-26~30: 전체 SIP CDR 184,232 / 원본 MOS 유효 130,940 / 전체 보정 후 저QoE 1,580 (기존 1,403). Drop 257 / 평가 가능 201 / 보정 후 불량 201 / 보통 0 / 양호 0.

## 검증/서버
- \`scripts/tests/derived-qoe-drop.test.cjs\` (원본 불변성, H: Drop/복합 reason, -1.5~2.5 유효 처리, 실제 10/30 평가, 로딩 단계 보정).
- 사용자 화면/일별 집계/절단 등급/품질 제안/기존 MOS 실험실 관련 회귀 검사 및 TypeScript/Python 컴파일 확인.
- 3016 실행 빌드: \`outputs/quality-improvement-two-deploy/stage-sip-drop-qoe-20261109\`.
- 서버: \`scripts/serve-quality-sip-drop-qoe-20261109.cjs\`. 3016의 현재·Drop 모드/통화 상세/GPS RF 데이터 HTTP 200 검증.

## 별도 후속 검증 대상
- 위치기반 DBSCAN 및 대안 알고리즘의 **기존 발행 후보 산출물**(\`public/quality-improvement[-full]\`, \`public/quality-models[-full]\`)은 원본 MOS 저하 기준으로 과거에 계산된 결과다. 본 변경에서 이 감사 산출물은 덮어쓰거나 자동으로 다시 계산하지 않았다.
- 새로운 QoE 기준의 반복 지역/후보 수를 공식적으로 제시하려면 전 기간 승인 GPS/삼각 측량 근거에 대해 후보 산출·모델 평가·독립 감사까지 별도 재생성해야 한다. 신규 결과를 과거 원본 후보 수와 혼합하여 정확한 수치로 주장하지 말 것.
