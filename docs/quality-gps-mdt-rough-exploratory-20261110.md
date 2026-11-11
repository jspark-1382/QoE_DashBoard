# GPS + MDT 근사 통합 DBSCAN 조사 후보 (2026-11-10)

## 범위와 정책
- 대상: 개선 2안 / 개선후보 분석 / 기본 DBSCAN, 전체 기간 및 날짜 분리 평가 모드
- 기존 GPS 엄격 검토 결과와 기존 8개 후보는 변경하지 않고 별도 새 산출물로 보존
- 기존의 동일한 Python Haversine DBSCAN 함수(`scripts/voice_improvement_1.py::_candidates`) 사용
- DBSCAN: eps 100m, min_samples 2, 고유 저QoE 고객 3명 이상, 관측 날짜 2일 이상
- 후보 표시는 대표 실제 관측 또는 근사 중심점에서 최대 거리+20m와 100m 중 큰 값을 10m 올림; 중심점은 GNSS 또는 검증 전 MDT 근사일 수 있음
- 순위는 고객 수 → 관측일 → 통화 수 → GPS 통화 수; 최대 구성점 간 거리 200m 초과 시 조사 범위 검토
- 입력 조건: 유효 SIP CDR MOS(v5) 1~3 미만, 원본 GPS 승인 통화 또는 RSRP 다중 RU/Cell 가중중심 추정이 존재하는 통화
- GPS가 있을 경우 GPS 우선(동일 통화 이중 계산 방지); BYE Cell 기지국 좌표 단독 입력은 사용하지 않음
- MDT 추정 유효성: 원본 CDR와 연결된 통화/일자/모델 버전/좌표 범위, 독립 RU/사이트 3곳 이상, 모델 관측 시간 및 600~5000m 조사 참고 반경, 원본 RF 측정 근거 보유
- **추정 좌표 정확도(GPS 대비 오차), RF 근본 원인 검증은 수행하지 않음**. 위 자료 유효성 검사는 소프트웨어 데이터 조인·형식 검사일 뿐 위치 정확도 검증이 아님
- 실제 단말 위치, RF 음성 열화 순간 위치, 90% 신뢰구간, 확정 장애 원인을 의미하지 않음

## 2026-10-26~30 전체 기간 결과
- GPS 원본 채택 저QoE 131통화
- MDT RSRP 근사 저QoE 106통화
- 총 237개 *서로 다른* 통화 좌표 입력
- 이전 GPS-only DBSCAN 후보 8곳 → 통합 GPS+MDT DBSCAN 후보 **22곳**
- 통합 후보 22곳 중 MDT 근사 통화 구성원 포함 **19곳**
- 별도 독립 고객 기준 통합 후보 영향 고객 **143명** (후보 구성 고객 중 중복 제거; 저QoE 전체 고객 수와 같지 않음)
- 데이터 5일 분석은 5일 전부 후보 생성용으로 사용, 별도 독립 평가일 미실시

## UI 표현
- 개선후보 지도: 기본 DBSCAN을 통합 결과로 변경. 지도 원 및 후보 목록, 고객·통화 수, 발견 날짜, 순위, 대표 중심점 등 새 후보 데이터 반영
- 선택 후보마다 GPS 구성 통화 수, MDT 근사 구성 통화 수 별도 표시
- 새 22개 후보 중 1번: GPS 8통화 + 근사 10통화 = 구성 18통화, 고유 고객 18명
- MDT 근사는 주황색 빈 마름모, 원본 GPS는 기존 RF 마커. 지도에서 선택 후보 구성 근사 점만 표시
- 기지국 3개 이상 입력 근거의 RU/Cell/RSRP 팝업 유지; 선택 후보 근사에 사용한 기지국은 강조
- 후보 상세에서 MDT 근사 결정은 `status:'provisional'`, `reasons:['position-accuracy-unvalidated']`, `kind:'rough'`으로 기록. '검토 통과'로 표시하지 않음
- 원본 GPS-only 결과는 `public/quality-improvement-full`, `public/quality-improvement`에 그대로 보존
- **나머지 5개 대안 모델**은 종전 GPS/엄격 증거 기준 산출물을 유지. UI에 서로 다른 모집단임을 명시하여 통합 DBSCAN과 직접 수치 비교 금지. 향후 별도 재산정 필요

## 산출물 및 검증
- 재현 코드: `scripts/build-quality-mixed-candidates.py`
- 전체 기간 15개 범위: `public/quality-improvement-mixed-full`
- 후속 날짜 분리 6개 범위: `public/quality-improvement-mixed-evaluation`
- 새로운 데이터는 원본 CDR/MDT/GPS/RTCP, 기존 엄격 검토 결정 또는 다른 알고리즘 산출물을 수정하지 않음
- JSON sourceRevision 및 날짜 범위, 원본 통화 ID 대조, CDR 위치 근거 불일치 검출, 후보별 고유 고객/통화/일자 집계, 원본 GPS 131과 근사 106 교차 검산 테스트
- 검증된 것은 계산·집계 무결성이지 위치 정확도·현장 품질 개선 효과가 아님
