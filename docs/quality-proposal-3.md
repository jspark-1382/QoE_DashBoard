# 품질현황_개선3안 — 품질 분석 통합형

새 화면: `http://127.0.0.1:3014/qoe/overview-proposal-3`

**기존 품질 현황과 개선1안·2안의 라우트/구성을 유지합니다.** 기존 `quality-overview.tsx`와 스타일은 SHA-256 보호 테스트로 검사합니다. 상단 MOS 알고리즘 비교 오른쪽에 1안·2안·3안 탭을 순서대로 표시합니다.

## 기존 + 개선2안에서 가져온 장점

- 개선2안의 밝은 상단 내비게이션, 카드 색상, MOS(v5) 실측 KPI 기반
- 최상단 KPI는 **전체 통화 / MOS 평가 가능 / 평균 MOS(v5) / 저품질 통화 4개**로 간소화. 저품질 경험 고객과 위치 연계 통화는 중복 KPI 카드로 표시하지 않음
- 다음 한 줄은 **작은 MOS 점수 분포 / 넓은 시간대별 통화 품질 / 고객 체감품질(고유 고객 기준)** 3개 카드로 구성. MOS 도넛·범례 크기를 줄이고 중복된 하단 구성비 막대를 숨겨 빈 공간 최소화
- 그 아래 큰 **행정동별 저품질 위치 지도 + 행정동별 저품질 순위** 2열을 유지
- 지도에서 개별 통화를 열면 하단 MOS/RTP/무선 관측 근거로 조사
- GNSS(빨강)·무선 추정(주황) 마커를 확대 수준에 따라 군집화하며, 확대 시 원래 좌표 마커로 분리. 기존 화면·개선1안·2안은 군집 기능 꺼짐
- 고객 체감품질에 MOS 비율을 중복하지 않음. 기존 `overview-analytics.ts`와 **정확히 같은** 고유 고객 집계(저품질 1회 이상/2회 이상/2회 연속) 사용. 카드를 선택하면 해당 고객 유형의 지도·목록만 표시하되 상단 전체 CDR KPI는 그대로 유지

## 2026-10-30 원본과 주의사항

- 전체 CDR 37,731, 유효 MOS 26,688, 불량 288, 보통 442, 양호 25,958, 미평가 11,043
- 고객 체감 요약: 저품질 경험 267, 반복 불량 18, 연속 불량 18 (고유 고객 17,765명 기준)
- CDR 종료 시각 기준 위치가 연결된 저MOS 통화 93건 (GNSS 관측 28, 3사이트 추정 21, BYE Cell 기지국 44), 행정동 13곳에 통화당 최대 1개 대표 위치 (60초 초과 위치 3건 제외)
- 고객 체감품질은 **MOS로부터 계산한 간접 지표**이며 고객 설문 결과가 아님. MDT는 저MOS 중심 부분표본이므로 행정동별 불량률을 계산할 수 없음
- CDR MOS는 통화 단위 수치이므로 지도 마커가 순간적으로 MOS 하락한 정확한 좌표를 나타내는 것은 아님
- 원본 SHP, CDR, MDT 자료는 수정하지 않음

## 구현 구성

- `app/overview-proposal-3/page.tsx`: 독립 라우트
- `components/analyst/quality-proposals.tsx`: 버전3 전용 상단 그래프, 고객 경험 카드, 지도/순위. 기존 1안·2안 분기는 보존
- `components/analyst/quality-proposals.module.css`: 버전3 전용 4 KPI / 3열 분석 카드 / 2열 지도·순위 / 반응형 스타일
- `lib/analyst/improved-overview.ts`: 고객 그룹 필터 옵션 추가(기본 미설정으로 기존과 호환)
- `components/analyst/analyst-map.tsx`: 지도 군집 옵션 `clusterOccurrences` 추가(기본 false, 3안에만 true)
- `scripts/tests/quality-proposal-3.test.cjs`: 원본 보호, 실제 고객 수치, **KPI 4개와 3열 카드 배치**, 지도 그룹/문구/라우트 확인

## 실행 및 테스트

```powershell
npm.cmd run test:proposals
npm.cmd run test:analyst
npm.cmd run test:voice1030
npx.cmd tsc --noEmit --incremental false
npm.cmd run build
npm.cmd run preview:mos
```

프로덕션 미리보기는 로컬 주소 `127.0.0.1:3014`에서만 실행하며, 기존 3001 개발 서버는 변경하지 않습니다. Vinext 배포 환경에 따라 정적 리소스 오류가 있을 수 있으니 `npm.cmd run preview:mos`로 실행합니다.


### BYE Cell 기지국 대체 매핑 (2026-11-03)

위치 선정 우선순위는 GNSS → 검토 통과 3사이트 이상 → 유일한 BYE Cell 기지국입니다. BYE Cell은 UE 좌표가 아닙니다. 저MOS 지도 기본 표시 93건(GNSS 28, 3사이트 21, BYE 기지국 44)이며 기지국 기준 행정동은 실제 단말의 위치와 다를 수 있습니다. CDR MOS와 원본 GNSS 이동경로는 유지합니다.
