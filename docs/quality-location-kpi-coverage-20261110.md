# 개선 2안: 저QoE 위치 활용 카드 비율·정렬 수정 (2026-11-10)

## 요청 및 구현
- 저QoE 위치 활용: 237건 옆에 '저품질 통화 대비 15.0%' 배지 추가
- 원본 2026.10.26~30, 저QoE 1,580건 (QoE < 3.0, SIP Drop 보정 적용), GPS 131건 + 3사이트 RSRP 가중중심 근사 106건 = 237건
- 계산 237 / 1,580 * 100 = 15.0%. 소수 한 자리 표시
- 동일 기간·시간 범위의 해당 QoE 등급 통화 수를 분모로 사용; 보통/양호 등급 선택 시 분모와 배지 문구도 자동 전환
- 지도 추가 필터(시간대·행정동·GPS 유형·고객 그룹 등)는 위치 활용 분자를 줄일 수 있으며, 배지 툴팁에 계산 기준을 명시
- 위치 활용 카드 오른쪽 미니 그래프 제거. 나머지 4개 KPI의 미니 그래프 유지
- 글자 좌측 정렬 및 수치와 비율 배지 동일 기준선. 화면 폭이 좁아지면 배지가 안전하게 다음 줄로 배치됨
- 수정 파일: `components/analyst/quality-proposal-four.tsx`, `components/analyst/quality-proposal-four.module.css`
- 다른 화면, 지도 위치 원본, 후보 선정 알고리즘 등은 변경하지 않음

## 검증
- 새 테스트: `scripts/tests/quality-location-kpi-coverage-rate.test.cjs`, 실데이터 237/1580=15.0% 및 시간·등급 필터 검증
- 기존 맵/KPI 테스트 2개에 그래프 제거 및 배지 assertions 반영
- 관련 테스트 10건 통과, TypeScript 검사 통과
- 기존 `npm.cmd run test:quality-improvement` 20건, `npm.cmd run test:proposals` 15건 통과
- 실 Chrome QA: `scripts/tests/quality-location-kpi-coverage-browser-qa.cjs`. 실제 3016에서 1920px/1480px 화면 확인:
  - 5개 카드, 저QoE 위치 활용 237건 및 대비 15.0%
  - 위치 활용 카드 SVG 1개(아이콘), 나머지 4개 카드 SVG 2개(아이콘+미니 그래프)
  - 글자 잘림/가로 넘침 없음, 넓은 화면 수치 오른쪽 배지 동일 줄, 좁은 화면에서 줄바꿈
- 최종 3016 경로 4개 HTTP 200 및 Chrome 실제 DOM 검증 완료

## 배포
- 새로운 빌드: `outputs/quality-improvement-two-deploy/stage-location-kpi-coverage-20261110`
- 서버: `scripts/serve-quality-location-kpi-coverage-20261110.cjs`
- 기존 빌드 스테이지 및 원본 데이터 보존
