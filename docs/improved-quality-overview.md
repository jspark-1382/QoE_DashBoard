## 별도 품질현황_개선 탭 (비교판)

**주소:** `http://127.0.0.1:3014/qoe/overview-improved`

기존 `품질 현황` 컴포넌트(`components/analyst/quality-overview.tsx`)는 변경하지 않았습니다. 기본 상단 탭에는 `MOS 알고리즘 비교` 오른쪽에 `품질현황_개선` 링크를 추가했습니다. 새 페이지는 다음 파일로 독립 운영됩니다.

- `app/overview-improved/page.tsx`
- `components/analyst/improved-quality-overview.tsx`
- `components/analyst/improved-quality-overview.module.css`
- `lib/analyst/improved-overview.ts`

### 비교판에서 제공하는 기능

1. **KPI:** 전체 CDR, 유효 MOS, MOS 불량, 미평가, 평균 MOS, 위치 연계 저품질 통화. 전체 CDR 분모는 유효 MOS 분포와 명확히 구분합니다.
2. **확대 지도:** 로컬 SHP 행정동 다각형 + 통화별 원본 GNSS(빨강)/무선 추정(주황) 위치 마커. 마커는 저MOS 통화의 위치 근거이지 MOS 저하 순간을 확정하는 지점이 아닙니다.
3. **행정동 순위:** 행정동별 연결된 저MOS 통화와 GNSS/추정 표본 건수, 고객 수. 행정동을 클릭하면 해당 지역의 위치 마커와 통화 목록을 함께 선택할 수 있습니다.
4. **시간대별 누적 차트:** 그 외 유효 MOS 통화(파랑) + 불량 통화(빨강) = 전체 유효 MOS. 차트에서 시간을 선택하면 지도와 지역별 통화 목록만 좁혀집니다.
5. **통화 조사:** 위치에 연결된 저MOS 통화 목록에서 통화 선택, 원본 MOS(v5)·RTP Loss/Jitter·RSRP/SINR 분석 패널. 고객·통화 분석 원본으로 이동하는 링크 제공.
6. **위치 근거 필터:** 전체/GNSS/무선 추정. 실제 확보한 부분표본과 전체 CDR KPI를 혼합하지 않습니다.
7. **기존 화면 비교:** 선택한 날짜/시간/시간대/행정동을 가능한 범위에서 기존 품질현황 링크로 전달합니다.

기존 10월 30일 CDR 자료 37,731건, MOS 유효 26,688건, 저품질 288건을 그대로 사용합니다. 원본 MDT는 MOS 3 미만 통화 중심 **부분표본**이며, 위치는 통화 단위 MOS와 연결된 관측·추정 위치입니다. **행정동별 불량률을 계산하지 않으며 원인 확정도 하지 않습니다.** 공간 연계는 통화 종료(CDR END TIME, SIP BYE 대용) 기준으로 저MOS 93통화(GNSS 28·3사이트 이상 추정 21·BYE 기지국 44), 통화당 대표 좌표 1개입니다. 60초 초과 시점 좌표는 제외했고, 개포1동에는 14통화가 종료 위치 기준으로 배정됐습니다. 원본 GNSS 이동경로는 유지합니다.

### 실행 및 검증

```powershell
npm.cmd run test:improved
npm.cmd run test:analyst
npm.cmd run test:voice1030
npm.cmd run build
npm.cmd run preview:mos
```

PC 3001 개발 서버는 사용자 작업을 위해 그대로 유지합니다. 프로덕션 미리보기는 `--hostname 127.0.0.1` 옵션으로 **로컬 인터페이스에만** 실행합니다.


### BYE Cell 기지국 기반 위치 (2026-11-03)

전체 CDR의 종료 Cell ID가 단일 기지국 RU에만 연결될 때 기지국 좌표를 별도 근거로 표시합니다. 이 좌표는 실제 UE 위치가 아닙니다. GNSS·3사이트 다변측량·BYE 기지국을 구분하며 모호한 Cell ID는 매핑하지 않습니다. 전체 CDR 위치 연결 7,218건, 저MOS 위치 연결 93건입니다. 지역별 전체 통화 불량률은 산출하지 않습니다.
