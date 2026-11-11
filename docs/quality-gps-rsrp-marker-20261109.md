# 개선후보 지도 GPS 아이콘 / RSRP 표시 (2026-11-09)

## 화면 기준
- GPS 관측점의 모양: 1.8광(네모), 1.8협(마름모), 900(원), 2.1(삼각형), 기타(육각형).
- GPS 색상: 원본 RSRP <= -105 dBm 빨강, > -105 dBm 초록, 불명확한 값 회색. **-105 dBm 정확히 빨강**.
- 임의 분류 금지. 현재 원본의 명시적 DL EARFCN만: 1550=1.8광, 1694=1.8협, 3743=900, 475=2.1. 그 밖의 EARFCN은 기타.
- 조사 후보 중심/조사 반경과 검토 통과 삼각 측량 마커는 GPS 심볼과 별개로 유지.

## 원본 RF 매칭
- 원본: public/quality-improvement/index.json의 5일 승인 위치, public/analyst-overview/MDT/<date>.json의 저QoE 통화, public/voice-1030.json의 고객 날짜별 데이터 경로 및 public/voice-1030-data/<revision>/*.json의 원본 MDT 샘플.
- **동일 날짜 + 동일 고객 + 동일 원본 Call ID + 동일 GPS 관측 epoch 시각**인 원본 MDT 행만 사용. 시간 추정, RSRP 보간, 다른 통화 RF 대체 없음.
- 결과: public/quality-improvement/gps-marker-rf-v1.json. 전혀 다른 원본 JSON의 필드를 바꾸지 않음.
- 5일 승인 저QoE GPS 131점 중 131점 정확한 시각 매칭, RSRP <= -105 5점 / > -105 126점 / 미확보 0점.
- 주파수 점수: 1550 80개, 1694 14개, 3743 32개, 475 5개.
- 10/30 하루: 30점(빨강 2점, 초록 28점).
- 원본 버전 동일할 때만 sidecar를 지도에 적용. 불일치·로드 실패 시 육각형/회색으로 표시하고 임의 추정하지 않음.

## 검증/적용
- 재생성: node scripts/build-qoe-gps-marker-rf.cjs
- 검증: node --test scripts/tests/qoe-gps-marker-style.test.cjs (실측 건수·시각·도형·경계값·UI 경로)
- 3016 stage: outputs/quality-improvement-two-deploy/stage-gps-rsrp-symbols-20261109
- 서버: scripts/serve-quality-gps-rsrp-symbols-20261109.cjs
- 10/26~30 및 10/30 후보 페이지와 원본 통화 상세, sidecar GET 모두 HTTP 200 확인.
- 지도 GPS 위치는 저QoE 연관 시각의 위치 근거이며 실제 저하 발생 순간의 확정 위치가 아님.

## 주파수 기준 참조
- 1.8광/협 EARFCN은 통신사별 B3 센터 채널 자료와 대조한 현재 프로젝트의 4개 실제 EARFCN만 매핑한 것.
- KT 1550/19550 1.8GHz 광대역, 1694/19694 B3 보조 10MHz, 3743/21743 900MHz, 475/18475 2.1GHz (https://seore.org/w/LTE).
- 향후 다른 통신사/중심채널 자료가 추가되면 EARFCN 매핑은 별도 검증 후 갱신 필요.
