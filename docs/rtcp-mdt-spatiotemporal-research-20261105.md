# SIP·RTCP·MDT·GNSS 통화 불량 시점/위치 추정 — 원본 기반 1차 연구 검증

작성: 2026-11-05 · 대상: \`QoE_Metrics\` · 원본 리비전 \`557c39d2c6a9a5b4c69b\`

## 0. 판정 (허위 정밀도 금지)

- **통화 품질 저하 발생 초(실측): 검증 불가.** 해당 5일 원본에는 시간 구간별 RTCP SR/RR/XR 패킷 또는 RTP 시퀀스/손실 시계열이 없으며, MDT \`rtcp_mos\`는 같은 통화 안에서 변하지 않는 통화 수준 값이다.
- **독립 측량 단말 위치 기반 P50/P90/P95: 검증 불가.** 장비에서 얻은 GNSS 위치 정확도 및 RTK/현장 측량 정답이 없다.
- **GNSS 위치 숨김 진단: 실행 및 수치 검증 완료.** 단, 같은 장비가 보고한 GNSS를 일부 숨긴 *대리 정답*으로서 실제 불량 위치 정확도와 동일하지 않다.
- **확정된 무선 원인: 0건.** 동일 고객/날짜/종료시각 및 시작시각 유일성 게이트를 통과한 통화에서 저RSRQ/저SINR 등의 상관 근거만 있다.
- **복잡한 모델을 운영에 반영하지 않음.** 시간 보간이 개발 데이터에서는 개선됐지만 독립 표본에서는 악화됐다.

현재 운영 지도와 기존 불량 후보 파일은 **수정하지 않았다.**

## 1. 실제 원본 및 증거 분리

| 원본 | 확인 범위/건수 | 해석 |
|---|---|---|
| \`data/MDT_New/261026_1030_SIP_Call_All_1 (개포동 전체)_전달용_v1.xlsx\` | 184,278행(헤더 포함), 143열 | 통화 수준 RTCP MOS(v5), RTP/RTCP 집계 지표, SIP 이벤트, 시작/종료 Cell |
| \`data/MDT_New/261026_1030_VoLTE+MDT_강남구 개포동_전달용.xlsx\` | 원본 데이터 541,811행, 39열 | 이벤트 시간 \`occ_dt\`, RSRP/RSRQ/SINR, \`trigr_ev\`, \`gnss_utmkx/utmky\`, 반복된 통화 수준 \`rtcp_mos\` |
| \`data/BaseStation/수도권_LTE_261103.xlsx\` | 실 기지국 목록 | LTE RU+Cell 유일 매칭을 충족하는 **기지국 위치**, 단말 위치 아님 |
| \`data/실측/복사본 RTCP_NEW_0714.xlsx\` | 2026년 **7월 14일** | 별도 실측 RTCP 자료. 10월 통화와 조인하거나 10월 불량 발생 시점의 정답으로 사용하지 않음 |

원본 크기·시트·행수와 SHA-256은 \`outputs/spatiotemporal-research-v1/report.json > sourceAudit.sourceWorkbooks\`에 있다. 검증은 원본 이름, 크기, 출처 리비전, SHA-256을 명시한다.

### 원본 RTCP 결정적 발견

MDT \`rtcp_mos\`는 327,683개 원본 행에 존재하지만 기존 전체 원본 감사에서 **같은 통화 내 복수의 MOS 값이 발견되지 않았다**. 10월 30일에는 MDT 이벤트 MOS 기록이 확인되지 않는다. 통화의 집계 RTCP MOS(v5)를 \`Call_1\`, \`Call_2\` 시각에 복제해 놓고 그 시각을 저하 시점이라고 주장하면 잘못이다. 따라서 실제 시간별 불량 탐지 Precision/Recall은 \`null\`이다.

## 2. 구현한 알고리즘

\`scripts/qoe_spatiotemporal_core.py\`

1. **RTCP 구간 탐지:** 동일 시계 기준으로 검증된 시간 구간 RTCP 보고서에만 적용. 정상 구간 다음, MOS <3 또는 손실률 ≥5% 또는 지터 ≥30ms인 구간이 연속 2건 발생해야 탐지한다. 숫자는 조정 가능한 **연구 가설 임계값**이며 운영 표준 판정선이 아니다. 결과는 한 시각이 아니라 정상 보고서 종료~첫 불량 보고서 종료의 **발생 가능 시간 구간**. 통화 집계나 중첩 보고서에는 \`NOT_IDENTIFIABLE\`.
2. **시계 정렬:** 물리적으로 동일한 이벤트의 독립 시계 앵커가 4개 이상일 때만 오프셋을 중앙값/MAD로 추정. CDR START vs MDT START는 서로 다른 SIP/세션 단계일 수 있어 시계 오차의 정답으로 사용하지 않는다. 유효 앵커가 없다면 \`null\`.
3. **GNSS 유효성:** 투영계 선택을 명시(프로젝트는 EPSG:5179로 설정됨). 원본 공급사 좌표계·장비 수평 오차가 확인되지 않았으면 측량 수준 정확성 인증을 하지 않는다. 위경도 0/0 등 잘못된 수치를 위치로 간주하지 않는다.
4. **최근 GNSS 유지:** 타깃 시각보다 **이전** GNSS만 사용. 180초 경과 또는 위치 불명은 유효 위치 없음. 이동 가능 거리 \`v_max × Δt\`는 물리적 가정 시나리오, 확률적 신뢰 반경 아님.
5. **등속 속도 외삽:** 이전 GNSS 2개, 표본 시간 차 3~180초, 이동 속도 상한(33.3333 m/s) 조건에서만 계산. 비현실적 이동이면 거부.
6. **시간 보간:** 이전/이후 두 GNSS를 사용하는 **사후** 분석 전용. 시간 간격 및 속도 게이트 적용. 미래 측정이 필요한 알고리즘을 실시간 예측으로 오해하지 않는다.
7. **무선 위치:** RU/Cell 유일 매칭과 물리적으로 다른 기지국 3개 이상 및 앞선 30초 RSRP를 충족할 때에만 **기지국 신호 가중 중심** 비교. 단말 정밀 위치나 물리적 삼변측량으로 표기하지 않는다.
8. **조건부 확률 융합:** GNSS/무선의 독립적인 위치 오차 표준편차, 시계 동기화/오차, 독립 RF 모델을 모두 확인할 때만 Gaussian precision weighting 가능. 현재 원본에는 해당 교정 자료가 없어 결과를 **미산출**. 수식의 모델-가정 반경과 독립 현장 검증을 통과한 P90 신뢰반경을 구분.
9. **원인 가설:** RTCP 저하 시간 구간과 MDT 시계 동기화가 확인된 경우에만 주변 RSRP/RSRQ/SINR/HO 단서를 결합. 원인을 확정하려면 대조군, 동일 셀 PM, RTP 손실 시간대와 실측 재현이 추가로 필요.

불확실성 시나리오 상한의 예시:

\[
R_{\mathrm{scenario}}=R_{\mathrm{device}}+v_{\max}(\Delta t+\Delta t_{\mathrm{clock}})
\]

이 값은 측위 정확도 P90이 아니며, 개별 인자의 정확도·독립성이 검증돼야 확률적 오차 전파를 시도할 수 있다.

## 3. 실제 GNSS 숨김 검증 결과

\`scripts/run_qoe_spatiotemporal_study.py\`: 원본-연계 파티션의 GNSS 관측을 마지막 1개 또는 통화 중간 1개 숨겨 위치를 예측. **미래 GNSS는 시간 보간에만 허용**, 이전 위치 유지/속도 모델/무선 중심에는 목표 GNSS 좌표나 미래 데이터가 유입되지 않도록 차단.

- GNSS 관측이 존재하는 연결 통화: **580개**, GNSS 표본 **3,595개**.
- 마지막 GNSS 숨김 평가 가능 통화: **304개**.
- 중간 GNSS 숨김 및 앞뒤 시간 보간 가능: **138개**.
- 개발: 10월 26~28일. 검증: 10월 29~30일, **개발 고객 및 관측 Cell 모두 제외**.
- 엄격 검증: **34개 사례**(마지막 GNSS 21개, 중간 GNSS 13개). 일부 고객은 두 사례 유형에 포함될 수 있으므로 34명을 뜻하지 않음.

| 검증 집단 / 방법 | 사례 n | P50 m | P90 m | P95 m | 중요 한계 |
|---|---:|---:|---:|---:|---|
| 마지막 GNSS 숨김 / 최근 좌표 유지 | 21 | 0 | 0 | 4.48 | **90.48%가 직전 대비 0.5m 미만 움직임** |
| 마지막 GNSS 숨김 / 등속 모델 | 8 | 0 | 5.01 | 5.64 | 동일한 paired set 아님 |
| 중간 GNSS 숨김 / 최근 좌표 유지 | 13 | 0 | 0.95 | 5.36 | 보간과 같은 사례에서 비교 가능 |
| 중간 GNSS 숨김 / 시간 보간 | 13 | 0 | 34.62 | 95.57 | **실제 검증에서 최근 좌표 유지보다 악화** |
| 중간 GNSS 숨김 / 3사이트 신호 중심 | 1 | 32.2 | — | — | 1건으로 일반화 불가 |

**위 표는 실제 불량 위치 정확도가 아니다.** P50이 0m인 것은 GNSS 값의 정지/반복 특성이 강하기 때문이다. 엄격 검증에서 실제 5m 이상 위치 변동을 보인 사례는 마지막 GNSS 1건, 중간 GNSS 1건뿐이다. 외부 RTK/측량 정답이 없으므로 실제 P50/P90/P95, 90%/95% 반경 포함률 인증은 \`null\`.

### 모델 개선 가설 → 구현 → 독립 검증 → 기각

\`scripts/validate_spatiotemporal_model_selection.py\`

- 시간 보간을 얼마나 허용할지 **개발 92건만으로** 최적화. 개발 평균오차: 최근 GNSS **19.02m** → 전면 시간 보간 **11.09m** (개발 데이터만 보면 개선).
- **완전히 별도의 13건**에서 평균오차: 최근 GNSS **0.985m** vs 전면 시간 보간 **17.785m** (**16.8m 악화**).
- 12명 고객 묶음 부트스트랩으로 계산한 평균오차 차이의 95% 범위: **−0.203~47.974m**. 0 포함, 표본 부족.
- **프로덕션 적용 거부**. 새 모델의 성능 향상을 독립 데이터로 입증할 수 없었다.

기기 자체의 GNSS 보고 오차가 없고 정지 사례가 많아, 이러한 데이터로 단말 측위 정확도 P95를 인증해서는 안 된다.

## 4. 원본 CDR–MDT 연결 검증 및 무선 가설

\`scripts/analyze_raw_candidate_radio_context.py\`

익명화 고객+날짜+**CDR·MDT 종료 시각 동일**+MDT 시작이 CDR 시작 후 최대 30초 이내+**정확히 하나의 원본 통화 키**를 모두 충족하는 경우만 연결. 시작 시각 차이를 시계 오차로 보정하지 않는다.

- 기존 개선 후보 5개의 원본 CDR 대표 통화 **21건** 중 **20건 연결**, **1건 근거 부족**으로 제외.
- 실제 MDT 원본에서 연결된 이벤트 **272행**.
- 통화 수준 점검 플래그: 저RSRP 포함 **1건**, 저RSRQ 포함 **8건**, 저SINR 포함 **12건**, MDT 트리거 존재 **15건**. 플래그는 겹칠 수 있고 특정 시각의 원인 증거는 아니다.
- **확정 원인 0건**. 통화 내부 RTCP MOS 값은 1개 이하이며 RTCP 불량 순간에 무선 증상이 있었다는 증거가 없다.

우선 현장에서는 C 후보의 SINR/RSRQ와 RTCP 손실 시간 정렬, 3470091 Cell의 약전계 및 HO 이벤트/PM 점검을 고려할 수 있으나, 이는 **확정 처방이 아닌 조사 항목**이다.

## 5. 목표 대비 검증 상태

| 사용자 요청 측정 | 값 | 이유 |
|---|---|---|
| RTCP 불량 구간 Precision/Recall | **미측정** | 동일 날짜·통화 시간별 RTCP 정답 없음 |
| 절대 SIP–MDT–RTCP 시간 정렬 오차 | **미측정** | 동일 물리 이벤트 독립 시계 앵커 없음 |
| 측량 정답 기준 위치 P50/P90/P95 | **미측정** | GNSS pseudo-target은 측량 정답 아님 |
| 실제 불량 위치가 추정 P90 반경 내 존재 비율 | **미측정** | 진짜 불량 순간과 위치가 확인되지 않음 |
| 원인 귀속 Precision/Recall | **미측정** | RF·PM·RTP 동기화된 정답 라벨 없음 |
| 위치 추정 실패/검증 불가 | 평가 대상/정의별 분리해 저장 | MOS 불량 발생 순간에 한정하면 전체 **시점 미식별** |
| 알고리즘 GNSS pseudo-target 오류 | 위 표 실측 | 외부 측량 정확도와 혼동 금지 |

## 6. 추적 가능한 산출물

- \`scripts/qoe_spatiotemporal_core.py\` — RTCP 구간 탐지, 시계 오프셋 게이트, GNSS 시간 보간/속도, 위치 오차 시나리오, 조건부 융합, 무선 원인 가설
- \`scripts/run_qoe_spatiotemporal_study.py\` — 출처 검증, GNSS 숨김 평가, 개발/검증 분할, 알고리즘별 P50/P90/P95
- \`scripts/analyze_raw_candidate_radio_context.py\` — CDR→원본 MDT 유일 조인 및 무선 지표/트리거
- \`scripts/validate_spatiotemporal_model_selection.py\` — 탐색 날짜로만 선택, 검증 날짜에 성능 향상 검증/기각
- \`outputs/spatiotemporal-research-v1/report.json\` — 원본 SHA-256, 방법별 지표, 미측정 데이터 현황
- \`outputs/spatiotemporal-research-v1/evaluation-cases.json\` — 익명화된 평가 사례·날짜·Cell·방법별 오차(숨긴 GNSS 원래 좌표 및 전화번호 제외)
- \`outputs/spatiotemporal-research-v1/strict-heldout-evidence.json\` — 출처 파티션 및 익명 통화 키의 소수 대표 증거
- \`outputs/spatiotemporal-research-v1/candidate_radio_context.json\` — 원본 연결 및 실제 무선 이벤트 근거
- \`outputs/spatiotemporal-research-v1/model_selection_review.json\` — 개발만으로 튜닝한 모델의 엄격 검증 결과
- \`scripts/tests/test_qoe_spatiotemporal_core.py\`, \`scripts/tests/test_qoe_spatiotemporal_outputs.py\` — 함수/출처/누수/과신 방지 자동검사

실행:

\`\`\`powershell
python scripts/run_qoe_spatiotemporal_study.py
python scripts/analyze_raw_candidate_radio_context.py
python scripts/validate_spatiotemporal_model_selection.py
python -m unittest scripts/tests/test_qoe_spatiotemporal_core.py scripts/tests/test_qoe_spatiotemporal_outputs.py -v
\`\`\`

## 7. 다음 독립 검증에 필요한 원본 자료

1. 동일 10월 통화에 대한 **실제 시간 구간 RTCP SR/RR/XR**, RTP 시퀀스 및 시각, 또는 매초 손실·지터·MOS: 구간 길이와 누적/구간 정의까지 필요.
2. 동일한 SIP INVITE/200OK/BYE, RTCP 보고, MDT 이벤트를 **같은 수신기로 찍은 독립 시간 앵커**와 GNSS UTC/NTP/PTP 동기화 상태: 장비별 시계 오프셋·드리프트 검증에 필요.
3. 현장 RTK/독립 GNSS 위치 정답, GNSS 수평 오차/HDOP 및 장비 원시 샘플의 원래 좌표계: 실제 위치 P50/P90/P95와 포함률 인증에 필요.
4. 동일 셀·시간대의 PRB/BLER/HO 성공률/무선링크 실패 PM, Neighbor 리스트 및 HO 세부 이벤트: 무선 원인과 타 원인의 구분에 필요.
5. 고객/날짜/Cell/공간 블록을 독립 분리한 신규 현장 데이터 및 실제 불량 주입/정상 대조 세션: Detection Precision/Recall·원인 검증에 필요.

**결정:** 현재 근거로는 GNSS 마지막 관측의 제한적 표시와 무선 원인 *조사 가설*까지만 허용한다. 새 위치 정확도나 품질 저하 순간을 UI에 확정 표시하지 않는다. 새로운 정답 자료가 제공되면 같은 검사기를 재실행해 모델의 독립 성능 개선이 확인된 경우에만 배포 대상으로 승격한다.
