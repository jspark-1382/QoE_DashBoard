# 개선 2안 - 모든 6개 알고리즘 GPS/MDT RSRP 통합 (2026-11-10)

## 원칙
- 6개: DBSCAN, HDBSCAN, ST-DBSCAN, Adaptive KDE, Spatial Scan, Bayesian.
- 6개 모두 2026-10-26~30 동일한 저QoE 통화 위치 입력: GPS 131건 + MDT 다중 기지국 RSRP 가중중심 106건 = 237개 **중복 없는 통화**.
- GPS 위치와 유효 MDT 근사 위치는 원본 callId 및 관측시각/모델 표기를 유지하며 서로 중복 계산하지 않음.
- 추정 좌표는 GPS 정확도·실측 위치·음성 열화 순간 좌표로 간주하지 않음. 독립 검증은 후속 과제.
- 기지국 BYE 등록 좌표만 있는 통화는 단말 위치로 계산하지 않음.
- HDBSCAN 등의 계산식과 파라미터는 기존과 동일하며 입력 위치 모집단만 통일. RSRP는 **MDT 위치 근사 좌표 산출에 사용**. GPS의 주파수(EARFCN)와 RSRP는 **지도 RF 관측 근거로 표시**하며, 군집 거리·밀도·우도·베이지안 점수에 별도 밴드 가중치를 추가한 것은 아님.

## 대안 모델 전체 기간 재계산 결과
| 모델 | 입력 저QoE (GPS/MDT) | 표시 후보 | MDT 구성원 포함 후보 |
| --- | --- | --- | --- |
| DBSCAN | 131/106 | 22곳 | 19곳 |
| HDBSCAN | 131/106 | 상위 20곳 | 17곳 |
| ST-DBSCAN | 131/106 | 상위 20곳 | 16곳 |
| Adaptive KDE | 131/106 | 상위 20곳 | 18곳 |
| Spatial Scan | 131/106 | 상위 20곳 | 20곳 |
| Bayesian | 131/106 | 상위 20곳 | 20곳 |

- 대안 모델은 기존 상위 20개 결과 표시 상한 유지. 20곳은 전체 유효 후보의 수라는 의미가 아닐 수 있음.
- Spatial Scan/Bayesian의 참조 모집단은 저QoE와 동일한 위치 적격성 규칙을 적용한 QoE 정상/주의 통화: GPS 294건 + MDT 근사 159건 = 453건. 표본 선정 편향 및 위치 정확도 미검증이므로 네트워크 전체 불량률·검증된 유의성·확정 위험 순위가 아님.
- '성능 검증' 모드 2026-10-26~30: 10/26~29에서 GPS 101, 근사 83 입력으로 발견 후보 생성; 10/30은 후속 평가만 수행. 해당 모드는 전체기간 모드와 구분.
- 모든 15개 전체기간 범위, 6개 유효 날짜분리 범위 결과 생성.

## UI
- 알고리즘 선택 시 각 모델별 후보, 통화·고객·날짜, GPS/MDT 근사 건수, 지도 및 기지국이 일관되게 갱신.
- 선택 후보에 해당하는 MDT 근사 구성 통화만 주황색 빈 마름모로 표시. GPS는 주파수(1.8광, 1.8협, 900, 2.1, 기타) 형상 및 RSRP(−105dBm 기준 빨강/초록/미확보) 마커로 표시.
- 각 근사 좌표 팝업은 사용 기지국/RU/Cell·RSRP와 종료시간 대비 관측시각 근거를 표시. 단말 정확도 검증 전 안내 명시.
- 기존 전체화면 범례뿐 아니라 일반 지도에서도 GPS 주파수·RSRP·MDT 근사 범례가 보이도록 수정.
- 선택 후보 구성 MDT 좌표는 일부 모델의 표시 원 바깥에 있어도 원본 통화 ID가 해당 후보 구성원이면 지도에 표시; 표시 반경은 위치 오차 신뢰구간이 아님.

## 산출물과 변경 파일
- 새 재현 스크립트: `scripts/build-quality-models-mixed.py`
- 별도 모델 JSON 15개: `public/quality-models-mixed-full`
- 별도 날짜분리 JSON 6개: `public/quality-models-mixed-evaluation`
- 변경 TS/TSX/CSS: `lib/analyst/quality-model-alternatives.ts`, `components/analyst/quality-model-alternative-workspace.tsx`, `components/analyst/quality-model-alternative.module.css`, `components/analyst/improvement-candidate-map.tsx`, `components/analyst/quality-improvement-candidate-panel.tsx`
- 원본 및 기존 엄격 산출물 `public/quality-models-full`, `public/quality-models`, `public/quality-improvement-full` 등 그대로 보존.
- 테스트: `scripts/tests/quality-mixed-all-models.test.cjs`, `scripts/tests/quality-mixed-six-model-browser-qa.cjs`

## 검증
- 모델별 15+6 범위, 기간·CDR ID, 237 입력 동일, 정상/주의 참조 입력, 위치 미검증 표시, 원본 파일 격리, 고객/통화/날짜 집계 및 후보 구성 MDT ID 대조.
- 통합 테스트 29건, 기존 품질 분석 20건, 제안 화면 15건 및 TypeScript 검사 통과.
- Chrome 실제 후보 모델 전환 시 DBSCAN, HDBSCAN, ST-DBSCAN, Adaptive KDE, Spatial Scan, Bayesian 각 첫 번째·두 번째 후보의 GPS/MDT 마커 건수 및 RSRP 색상·범례·기지국을 확인.
- 이 검증은 **계산·UI 연결 무결성**이며 위치 정확도 또는 무선 장애 원인 검증을 대신하지 않음.
