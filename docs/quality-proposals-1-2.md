# 품질현황 개선1안 · 개선2안 (UI 2종 비교)

**기존 ‘품질 현황’ 탭의 실제 화면과 계산 로직은 전혀 수정하지 않습니다.** 이전 개선 화면 `/qoe/overview-improved`도 삭제하지 않았습니다. 상단 `MOS 알고리즘 비교` 오른쪽에 두 개의 신규 링크를 배치했습니다.

| 화면 | URL | 설계 원형 |
| --- | --- | --- |
| 기존 품질 현황 | `/qoe/?source=MDT&view=overview&date=2026-10-30` | 현재 품질현황 (변경 금지) |
| 개선1안 | `/qoe/overview-proposal-1` | 첫 번째 제안 이미지: 네이비 내비게이션, 상단 KPI 7개, 왼쪽 세로 고객 체감품질 카드, 중앙 행정동 지도, 오른쪽 저품질 순위 |
| 개선2안 | `/qoe/overview-proposal-2` | 두 번째 제안 이미지: 화이트 내비게이션, 상단 KPI + 가로 고객 체감품질 카드, 넓은 행정동 지도·순위, 3색 시간대 그래프 |
| 이전 개선판 | `/qoe/overview-improved` | 이전 단계 별도 화면, 주소 유지 |

## 공통 실제 기능

- 2026-10-30 **SIP CDR 원본 MOS(v5)** 37,731건 및 행정동 SHP `BND_ADM_DONG_PG.shp` 공간결합 데이터 재사용.
- 상단 KPI: 전체 CDR 통화, 유효 MOS, 평균 MOS, 불량/보통/양호, 위치 연결된 저MOS 통화.
- 불량 MOS **3.0 미만** / 보통 **3.0~3.5 미만** / 양호 **3.5 이상**. 실제 원본 평가 26,688건, 미평가 11,043건은 분포 분모에서 제외.
- 시각적 **고객 체감품질** 카드는 MOS로 요약한 통화 품질의 간접 지표이며, 직접 설문 기반의 고객 만족 점수가 아님을 화면에 명시.
- 행정동 SHP 경계에 실제 통화 연계 위치를 GNSS 관측(빨강) / 무선 추정(주황)으로 구분하여 표시하고, 겹치는 마커는 개수로 묶음.
- 행정동 저품질 집중 순위는 **발생 건수** 기준. 저MOS 중심 MDT 표본을 전체 지역 품질의 불량률 분모로 사용하지 않음.
- 필터: 일자 2026-10-30, 시작·종료시각, 위치 근거 GNSS/추정, 시간대별 막대, 행정동 순위 및 지도 경계.
- 도넛/구성비 그래프, 시간별 누적 막대, 선택 통화 목록 및 MOS/RTP Loss/Jitter/RSRP/SINR 실측·추정 근거.
- 통화 상세 원본 연결: 기존 고객·통화 분석 탭으로 이동.
- 그림에 나오는 수치, 다른 일자·지역, 전월 대비 증감 및 확인되지 않은 RTP 단위는 **절대 사용하지 않음**.

## UI 구현 파일

- `app/overview-proposal-1/page.tsx`, `app/overview-proposal-2/page.tsx` — 별도 라우트
- `components/analyst/quality-proposals.tsx`, `quality-proposals.module.css` — 설계안별 레이아웃
- `lib/analyst/quality-proposal-metrics.ts` — 10월 30일 원본 MOS 분포 및 시간대 집계
- `scripts/tests/quality-proposals.test.cjs` — 두 탭/원본 보호/등급 집계/레이아웃 검증

## 원본 보호 확인

품질현황 본문 `components/analyst/quality-overview.tsx`와 스타일 `quality-overview.module.css`의 SHA-256 해시를 테스트에서 고정 검증하여, 실수로 변경될 경우 실패합니다. 상단 공통 내비게이션 `analyst-dashboard.tsx`에 링크 두 개만 추가·교체했습니다.

## 검증

```powershell
npm.cmd run test:proposals
npm.cmd run test:analyst
npm.cmd run test:improved
npx.cmd tsc --noEmit --incremental false
npm.cmd run build
npm.cmd run preview:mos
```

기존 3001 개발 서버는 변경하지 않습니다. **3014 로컬 미리보기는 `npm.cmd run preview:mos`로만 실행**하세요. Vinext 1.0.0-beta.5에서 `/qoe/_next/static/*` CSS/JS가 404가 되는 문제를 `scripts/serve-local-preview.cjs`가 로컬에서만 보완합니다. 스크립트가 `127.0.0.1`에만 바인딩하며, 원래 품질현황 화면 및 프로젝트의 사용자 설정 `next.config.ts`는 변경하지 않습니다. 

`vinext start`를 직접 실행하면 화면 글자만 나오고 스타일·동작이 사라질 수 있습니다. CDR 및 고객 연계 자료가 포함된 JSON은 외부 배포하지 마세요.
