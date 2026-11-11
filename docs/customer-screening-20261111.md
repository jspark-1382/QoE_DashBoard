# 고객 선별 대시보드 (2026-11-11)

## 적용 범위
- 신규 독립 URL: \`/qoe/customer-screening\`
- 기존 7개 탭은 그대로 두고 공통 \`QualityTopNav\` 끝에 **고객 선별** 링크만 추가
- 기존 데이터·컴포넌트·분석 정책은 수정하지 않음
- 현재 운영 미리보기: \`http://127.0.0.1:3016/qoe/customer-screening\`

## 실제 원본
- \`public/voice-1030.json\` manifest + 일별 \`public/analyst-overview/MDT/{date}.json\` 5개
- 생성: \`node scripts/build-customer-screening.cjs\`
- 생성 파일: \`public/customer-screening-data/2026-10-26_2026-10-30.json\`
- sourceRevision: \`79840583bdb8e36221c2\`
- 원본 수: 통화 184,232건, QoE 평가 가능 130,940건, 저품질 통화 1,580건, SIP Drop 257건, 기간 내 고유 고객 ID 46,640개
- 전화번호가 항상 존재하는 것은 아님: 원본 서비스계약번호를 문자열 그대로 표시 (UE... 또는 숫자 문자열)

## 지표 계산
- QoE = RTCP MOS(v5), SIP 11.REASON Drop일 경우 원본 MOS에 -2.5 보정 (원본 미평가는 그대로 미평가)
- 저품질 = 평가 가능 QoE < 3.0; 저품질 비율 = 저품질 / **평가 가능** 통화
- 반복 불량 = *서로 다른 날짜 2일 이상* 저품질 통화
- 집중 고객 = 저품질 10건 이상 또는 평가 가능 통화 5건 이상 중 저품질 비율 50% 이상
- Drop 다발 = 3건 이상 또는 전체 통화 5건 이상에서 Drop 10% 이상
- 동일 행정동 반복 = 같은 행정동에서 **2일 이상** 저품질 관측
- 고객군 도넛은 배타적 우선 분류(집중 → 반복 → Drop → 일시적 → 그 외). 상단 KPI는 독립 조건이므로 교집합 가능
- 기본 TOP10은 저품질 건수 순, Drop/반복 탭으로 재정렬 가능
- 기간·시간·고객 조건·검색 입력에 따라 동적 계산

## 지도 (2026-11-11 행정동 개편)
- 기본 모드 **행정동별 고객**: `data/행정동경계` SHP에서 생성된 5일 원본 overview의 실제 행정동 경계 39개를 GeoJSON으로 추출하여 색상 채움
- 형상 파일: `public/customer-screening-data/administrative-boundaries-v1.json` · 원본 리비전 일치 검사
- 기본 집계는 BYE Cell 대응 행정동(고객의 확정 위치 아님) 기준 **지역별 서로 다른 저품질 경험 고객 수**
- 색상 지표 선택: 저품질 경험 고객 / 2일 이상 반복 고객 / 저품질 통화 / SIP Drop 통화(모든 Drop 포함)
- 지역 클릭 시 그 행정동 통화만 재집계하여 오른쪽 고객 비교 4명과 상세 미리보기 연동. 상단 전체 KPI와 TOP10은 전체 기간 기준 유지
- **기지국·셀별** 모드: BYE Cell 식별자로 집계하되 원형 마커의 지리 좌표는 원본 BYE 기지국 인벤토리 참고 위치에서만 가져옴. GNSS 단말 좌표를 기지국 좌표로 사용하지 않음
- **GNSS 실측** 모드: 유효한 GNSS 저품질 통화만 약 200m 격자로 집계. GNSS 미확보 통화 제외
- 기본 축척은 상위 5개 저품질 고객 밀집 행정동 중심이지만 전체 39개 폴리곤을 확대·이동으로 탐색 가능
- 측위 정확도나 실제 원인 확정은 지도로 주장하지 않으며, 모든 지도 값은 독립 고객/관측 통화 기준
- 기존 격자 원형 버블 지도는 고객 선별 탭에서 더 이상 사용하지 않음

## 테스트
- \`node --test scripts/tests/customer-screening.test.cjs scripts/tests/quality-tabs.test.cjs scripts/tests/quality-customer-picker.test.cjs\`
- \`npx tsc --noEmit --incremental false\`
- \`npm run build:local\`
- \`$env:QOE_QA_ORIGIN='http://127.0.0.1:3016'; node scripts/tests/customer-screening-browser-qa.cjs\`
- 브라우저 화면 캡처: \`outputs/customer-screening-ui-3016.png\`

## 운용 주의
- 공개 소스 JSON과 응답의 sourceRevision을 검증해야 하므로 신규 원본으로 데이터가 갱신되면 집계 스크립트 재실행 후 배포
- \`/customer-screening\`과 동일한 이름의 \`public/customer-screening\` 폴더는 Vinext 로컬 정적 파일 핸들러와 URL 충돌 → 반드시 \`public/customer-screening-data\` 사용
- 기존 실행 스크립트는 건드리지 않았으며 신규 \`scripts/serve-customer-screening-preview.cjs\`를 포트 3016으로 실행함

## 고객 선택 시 통화 위치흐름 (2026-11-11 추가)
- 신규 고객 선별 탭에서 TOP 10 행, 고객 목록 검색, 비교 카드 클릭 시 자동으로 '고객 경로' 모드로 전환.
- 모든 고객 통화에 대해 원본 BYE 종료시각 및 GNSS 또는 BYE Cell 참고 좌표를 별도 원본 데이터에 저장. 기존 다른 탭 원본 및 분석 결과는 변경하지 않음.
- 셀 기지국 좌표는 동일 기간 BYE Cell 인벤토리 참고 관측으로만 생성하며, GNSS 좌표를 기지국 좌표로 대체하지 않음.
- GNSS 위치는 초록색 실측점, BYE Cell 참고 위치는 주황색; 저품질 QoE 통화는 빨간 외곽선.
- 종료 시각 기준 정렬. GNSS-GNSS 관측점은 녹색 점선, 기지국 참고점이 포함되면 회청색 점선 연결.
- 이 선은 서로 다른 관측점의 시간순 직선 연결이며 실제 단말 이동경로·도로 이동·정확한 위치라고 주장하지 않음.
- 다른 날짜, 90분 초과 시간차, 30km 초과 거리, GNSS-GNSS 160km/h 초과 구간은 미연결.
- 좌표 없거나 위치 근거 부족한 통화는 별도 개수로 표시하며 관측 지점으로 창작하지 않음.
- 전체 날짜 또는 특정 날짜 선택, 마커 클릭시 날짜·종료 시각·QoE·Drop·BYE Cell·근거 표시.
- 고객 목록은 최대 200명까지 렌더링하지만 계약번호 검색은 전체 고객 데이터에서 필터링.
- 관련 구현: lib/analyst/customer-screening-route.ts, components/analyst/customer-screening-map.tsx, scripts/build-customer-screening.cjs.
- 검증: scripts/tests/customer-screening-route.test.cjs, scripts/tests/customer-screening-browser-qa.cjs.


## 고객군 분포 압축 · 지도 확대 (2026-11-11)
- 별도 고객 선별 탭에 한정한 UI 변경. 기존 7개 탭 및 통화/고객/Drop 집계 데이터 정책은 변경하지 않음.
- 저품질 경험 고객 비율은 전체 고객 대비 비율바(실측 기준 1,359/46,640 = 2.9%)로 교체; 나머지는 양호/미평가 포함으로 표기.
- 소형 유형 카드: 저품질 집중, 2일 이상 반복, Drop 다발, 배타적 분류 기준 일시적 불량. 조건별 카드 수가 중복될 수 있음을 화면에 표시.
- TOP10 10행 유지하며 1600x900에서 상단 패널 약 224px로 압축, 남은 공간은 행정동/SIP/GNSS/BYE Cell 및 고객 경로 지도 높이로 배분.
- 고객 선택/경로 선택, 지도 타입 3종, 우측 고객 비교 4명 및 상세 미리보기 기존 기능은 유지.
- 브라우저 QA: scripts/tests/customer-screening-layout-qa.cjs, customer-screening-browser-qa.cjs.
- Chrome 저장: outputs/customer-screening-layout-1600x900.png, outputs/customer-screening-customer-route-3016.png.
