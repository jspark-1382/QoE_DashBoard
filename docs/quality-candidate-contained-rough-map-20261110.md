# 개선후보 내부 삼각 측량 근사 위치만 표시 (2026-11-10)

## 변경 이유와 화면 결과
기존 개선후보 분석 지도는 전체 저QoE 삼각 측량 근사 106개를 후보 지역 바깥까지 표시하여 후보 분석 화면과의 관련성을 오해할 수 있었음. 현재 지도에 그려지는 후보의 **중심과 표시 반경**을 그대로 사용하여 추정 중심이 원 내부에 있는 좌표만 표시.

2026.10.26~30 DBSCAN 전체 기간 실데이터:
- 저QoE 삼각 측량 근사 전체: 106건
- 8개 후보 지역 내부(원 중심~근사 좌표의 Haversine 거리 ≤ 표시 반경): 서로 다른 통화 9건
- 1번 후보 1건 / 2번 0건 / 3번 3건 / 4번 5건 / 5~8번 0건
- 후보 밖 97건은 개선후보 지도에서 숨김. 원본 자료 및 기존 현황 지도에는 그대로 존재
- 최초 선택 1번 후보 내부 근사 1건이 별도 강조 표시됨
- 범례: '삼각 측량 근사 · 후보 내 9건 / 전체 106건 · 선택 1건'
- 지도 팝업: 해당 근사점을 포함하는 후보 번호, 중심~추정 좌표 거리, 후보 표시 반경, 각 기지국 원본 RSRP 및 조사 참고 반경

## 원칙
- 후보 표시 반경은 DBSCAN의 이웃 거리 eps(100m)나 단말 위치 정확도/신뢰구간과 동일하지 않음
- 근사 점의 **계산된 중심**이 후보 반경에 들어간다는 의미일 뿐, 실제 단말이 후보 안에 있었다는 검증 결과가 아님
- 여러 후보 원이 겹치면 좌표 마커는 통화당 1개만 그리되, 팝업에 해당 후보를 모두 표기
- 선택한 후보에 들어가는 마커만 더 진한 주황색으로 강조, 기타 후보에 속한 마커는 테두리형 마름모 유지
- 후보 선정, DBSCAN/대안 알고리즘 입력, 후보 목록/순위, 신규 고객·반복 검증 건수, GPS 근거는 일절 수정하지 않음
- BYE 기지국 참고 좌표는 기존대로 표시하지 않음

## 구현
- `lib/analyst/quality-candidate-rough-membership.ts`: 후보 원 내부 판정 및 중복 통화 제거 (Haversine 거리)
- `components/analyst/quality-two-candidate-workspace.tsx`: DBSCAN 지도 포함 좌표 수·선택 지역 수 및 지도 전달
- `components/analyst/quality-model-alternative-workspace.tsx`: 대안 모델 각 후보 원 기준 동일 판정
- `components/analyst/improvement-candidate-map.tsx`: 전달된 후보-위치 매칭 재검증, 선택 지역 마커 강조, 후보 거리 팝업
- `components/analyst/improvement-candidate-map.module.css`: 선택 마커 강조
- `scripts/tests/quality-candidate-rough-membership.test.cjs`: 실제 5일 9건, 후보별 1/0/3/5/0/0/0/0, 경계값, 겹침 중복, 코드 불변 검증

## 검증 및 배포
- 관련 테스트 20건 통과, TypeScript 검사 통과
- 기존 회귀 테스트 `test:quality-improvement` 20건, `test:proposals` 15건 통과
- 새로운 별도 빌드 `outputs/quality-improvement-two-deploy/stage-candidate-contained-rough-20261110`
- 실행 서버 `scripts/serve-quality-candidate-contained-rough-20261110.cjs` / 127.0.0.1:3016
- 실제 Chrome (3021 QA 및 3016 운영): 마커 9개 / 선택 후보 강조 1개 / 후보 내 9건 · 전체 106건 표시 확인
- 원본 JSON, 위치 추정 알고리즘, 기존 8개 DBSCAN 후보 및 다른 모델 산출물은 미변경
