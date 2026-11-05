# 기존 개선4안 ‘3사이트 추정’ GNSS 누락 통화의 대략 위치 표시 (2026-11-04)

## 요구사항 및 구현
새 페이지를 만들지 않고 기존 **/qoe/overview-proposal-4** 지도와 ‘3사이트 추정’ 필터, 통화 목록/분석 팝업에 **GNSS가 없는 CDR 통화**의 대략적인 위치 후보를 표시한다.

- 원본 SIP CDR Excel, MDT Excel, 기지국 Excel, 기존 5일 분석 JSON의 좌표/MOS는 수정하지 않음.
- 서버 빌드에서 기존 /qoe/radio-investigation 페이지는 제거함.
- 정확한 삼변측량이라고 부르지 않음: **30초 이내 관측한 서로 다른 기지국 사이트의 위치와 RSRP의 가중중심**을 현장 조사 후보 중심점으로 사용함.
- 시간: 동일 통화 및 CDR 종료 대리 시각 180초 내, 후보 중심 시각 이전 30초만 사용. GNSS가 있으면 원본 GNSS를 우선함. 실제 RTP/RTCP 품질 저하 시각은 별개임.
- 입력: \`matchStatus=MATCHED\`이고 \`baseStationMatched=true\`인 관측만 사용. \`수도권_LTE_261103.xlsx\`의 고유 RU+Cell 매핑 좌표를 이용하고 같은 위치 20m 이내의 복수 섹터는 하나의 사이트로 묶음. 서로 다른 3사이트 미만은 제외.
- 사이트 간 최대 거리 4,000m 이내, 조사 반경 700~5,000m. 반경은 **현장 조사에 사용하는 임의의 영역 가정**이며, 실제 UE 위치 오차 상한이나 90% 신뢰 반경이 아님.
- 실측 GNSS와 BYE 기지국 위치는 건드리지 않음. BYE 기지국 필터는 원래 좌표를 그대로 사용하며, ‘전체’와 ‘3사이트 추정’에서 GNSS 없는 통화에 한해 대략 후보를 우선 표시.
- 행정동 분류는 가중중심이 들어간 행정동 기준이며 실제 고객 단말이 그 행정동에 있었다고 확정하는 자료가 아님.
- 지도 마커/통화 팝업에는 3사이트 후보, 대략 조사 반경, 참조 RU·Cell·RSRP를 분리 표시. 위치 좌표 자릿수를 줄여 정확하게 측정한 위경도처럼 보이지 않도록 함.

## 실제 데이터 생성 결과

| 날짜 | GNSS 없는 통화의 3사이트 후보 | 그중 MOS(v5) < 3.0 |
|---|---:|---:|
| 10/26 | 38 | 13 |
| 10/27 | 78 | 25 |
| 10/28 | 75 | 20 |
| 10/29 | 54 | 25 |
| 10/30 | 55 | 23 |
| **합계** | **300** | **106** |

생성 파일: \`public/three-site-rough/YYYY-MM-DD.json\` (5개), 원본 manifest 리비전 \`557c39d2c6a9a5b4c69b\`.

소스 구현:
- \`scripts/build_three_site_rough.py\`: GNSS 없는 통화의 실제 MDT·사이트 기하·RSRP 가중중심 후보 생성
- \`lib/analyst/three-site-rough.ts\`: 기존 overview를 수정하지 않는 **뷰 전용** 위치 후보 오버레이
- \`components/analyst/quality-proposal-four.tsx\`: 기존 3사이트 필터/팝업과 데이터 연동
- \`components/analyst/analyst-map.tsx\`: 대략 조사 영역·참조 사이트 표시
- \`lib/analyst/types.ts\`: 참조 반경/사이트 및 추정 근거 필드

## 독립 GNSS 보류 진단 결과와 한계

\`scripts/evaluate_three_site_rough_gnss_holdout.py\` → \`outputs/three-site-rough-holdout.json\`

동일 통화 마지막 **서로 다른** GNSS 좌표를 보류하고 이전 시각의 무선 관측만 입력한 10개 통화 대상:
- 3사이트 RSRP 가중중심 오차 중앙값 **213.48m**, P90 **740.42m**, 500m 이내 **70%**.
- 같은 10통화에서 최신 GNSS 유지 오차 중앙값 **3.51m**, P90 **158.03m**.
- 10표본은 매우 적고 동일 수집계통 GNSS여서 독립 현장 측량 정답이 아니다. 높은 위치 정확도를 보증하지 않는다.
- 진단 사례에서 설정한 조사 반경에 포함된 GNSS는 100%이나, 이것으로 보정된 신뢰구간이라 주장하지 않는다.
- 따라서 **GNSS가 있는 통화를 무선 근사로 대체하지 않는다**. GNSS가 없는 3사이트 후보에만 사용한다.

## 검증
- \`python -m unittest scripts/tests/test_build_three_site_rough.py\`: 6개 통과
- \`node --test scripts/tests/three-site-rough-ui.test.cjs\`: 2개 통과, 원본 GNSS/모델 보존, 300/106 집계 확인
- \`npx.cmd tsc --noEmit --incremental false\`: 통과
- 기존 quality-proposal-four/GNSS/position review: 20개 통과
- **별도 staging 빌드 완료**, 3001 로컬 포트 서비스 새 빌드 반영. 기존 빌드 백업: \`.tools/qoe-local-server/dist-before-three-site\`.
- 실제 Chrome DOM 확인: 10/30 원본 저MOS 288건 중 ‘3사이트 추정’ 선택 시 **23건**, GNSS 0건, BYE 0건. BYE 필터를 따로 선택하면 기존 사이트 좌표 49건 표시. 통화 분석 팝업에서 약 1,290m 조사 반경 안내 및 참조 기지국 확인. CSS/JS/원본 CDR JSON 요청 정상, 로딩 오류 없음.

## 주의
이 구현은 **개략적인 위치 참고 기능**이다. RSRP 기반의 실제 위치를 독립 측량으로 확증하거나 MOS 저하 발생 시각을 식별한 것은 아니다. 인빌딩/산악/분산안테나 환경에서는 수 km 이상의 오차가 발생할 수 있다. 현장에서는 후보 주변 기지국·섹터·신호 품질을 점검하고 별도 단말 실측으로 실제 위치를 좁혀야 한다.
