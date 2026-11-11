# 개선후보 분석 지도: 삼각 측량 근사 좌표 표시 (2026-11-10)

## 사용자 노출
- 기존 현황과 동일한 3사이트 RSRP 가중중심 **삼각 측량 근사**(검토 전, 조사 참고) 표시
- 속이 빈 주황색 점선 마름모(22px). **검토 통과 삼각 측량의 보라색 점 및 GPS 대역별 도형과 구분**
- 클릭 시 원본 호출 일자, 좌표, MDT 관측시각, CDR 종료 시간차, 사용 기지국(최소 3개 RU/Cell 및 각각 RSRP), 조사 참고 반경, 정확도/후보 산정 제외 안내 및 원본 통화 상세 링크
- 지도 범례에 '삼각 측량 근사 106건'처럼 현재 기간·시간 조건에 따른 건수 표시
- DBSCAN 기본 모델과 대안 알고리즘의 지도에 같은 **시각화 전용** 근사 좌표 레이어 표시

## 데이터 선정 기준과 보안
- 읽기 전용 원본: `public/three-site-rough/<date>.json`, `AnalystOverview`
- `sourceRevision`, 날짜, `coarse-three-site-v1` 스키마, `THREE_SITE_RSRP_CENTROID` 정책 및 자료 구성 일치 필수. 한 날짜라도 누락/불일치면 무효 처리
- `overlayThreeSiteRough`를 그대로 재사용해 좌표/사이트 분리/RSRP/반경 등 기존 출처 검증을 유지
- `buildImprovedView`를 재사용해 SIP Drop 보정 포함 저QoE<3.0, 날짜·시각 필터와 원본 GPS 우선순위를 일치
- 지도에 보여주는 `roughPoints`는 후보 목록, DBSCAN, 엄격 채택 GPS·삼각 측량 근거, 신규 고객/일자 반복 검증, 알고리즘 비교 입력에 **전혀 전달하지 않음**
- 추정 중심은 단말 실제 위치나 QoE 저하 시점 좌표가 아님. 조사 반경은 측위 정확도 신뢰구간이 아님
- BYE 기지국 단독 참고 좌표는 계속 지도에서 제외

## 검산
- 2026.10.26~30, 전체 시간: GPS 승인 저QoE 131건, 삼각 측량 근사 106건, 엄격 검토 통과 삼각 측량 0건
- 일별 근사 13 / 25 / 20 / 25 / 23건
- 2026.10.30 단독: 근사 23건
- 기존 DBSCAN 5일 전체 후보 산출물 8곳은 불변
- `scripts/tests/quality-candidate-rough-layer.test.cjs` 등 22개 관련 테스트 통과. `test:quality-improvement` 20개, `test:proposals` 15개 통과. TypeScript 검사 통과
- 실제 Chrome 지도 DOM: 3016에서 근사 아이콘 106개 / 5일 범례 106건, 단일일 아이콘 23개 / 범례 23건 일치

## 배포
- 별도 빌드: `outputs/quality-improvement-two-deploy/stage-candidate-rough-layer-20261110`
- 실행 서버: `scripts/serve-quality-candidate-rough-layer-20261110.cjs`, 127.0.0.1:3016
- 원본 CDR, MOS(v5), MDT 측정, GPS, 측위 정책, 후보 산출물은 변경하지 않음
