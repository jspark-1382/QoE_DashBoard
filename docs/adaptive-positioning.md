# Adaptive MDT 위치추정 구현 및 검증 보고서

검증일: 2026-09-08. 새 앱이나 별도 지도 페이지를 만들지 않고 기존 위치추정 지도 안에 통합했다. 기존 경험적 후보 영역 모드는 알고리즘 선택에서 계속 사용할 수 있다.

## 1. 기존 프로젝트 분석 결과

React 19 / Vinext / Vite 기반이다. `app/page.tsx`에서 Executive Dashboard를 사용하며 필터·콜 선택 상태는 `executive-dashboard.tsx`의 React 상태로 관리한다. 지도 확대, 콜 목록, 콜 요약, 차트 선택 흐름을 그대로 사용한다. 데이터용 Backend/API는 없고 Python 추출 → `public/mdt-data.json` → fetch → selectors → 지도 Props 순서다. 신규 API나 서버 의존성 없이 기존 계산 모듈과 동일하게 독립 TypeScript 서비스에서 계산한다. 별도 수동 변환 명령을 추가하지 않았다.

## 2. 지도 Library

Leaflet + VWorld Satellite 타일이다. 기존 `mdt-location-map.tsx`의 Map 인스턴스에 LayerGroup을 추가한다. Adaptive 레이어는 지도 객체를 생성하지 않는다. 기존 `qoe-map.tsx`, 실측 지도, Map 초기 좌표는 변경하지 않았다.

## 3. 수정한 파일

- `components/executive/mdt-location-map.tsx`: 알고리즘 선택과 Adaptive 레이어 연결, 기존 알고리즘 유지.
- `app/globals.css`: 기존 색상·컨트롤 형태에 맞춘 필터와 재생 컨트롤.
- `scripts/test-location-estimation.cjs`: Adaptive 회귀 테스트 및 실제 데이터 통계.
- 이전 데이터 업데이트 작업 포함: `scripts/extract_mdt_data.py`, `lib/location-estimation/types.ts`, `lib/location-estimation/index.ts`.

## 4. 추가한 파일

- `lib/location-estimation/adaptive-config.ts`: 미보정 모델·시간창·가중치·신뢰도·이동 조건.
- `lib/location-estimation/adaptive.ts`: Physical Site, 이상치, Adaptive Window, 거리, 최적화, 신뢰도 계산.
- `components/executive/adaptive-position-layer.tsx`: 기존 지도에 연결하는 레이어·필터·시간 선택·상세.
- `scripts/test_base_station_master.py`: DMS·중복 헤더·복수 주파수 검증.
- `scripts/qa-adaptive-map.cjs`: 로컬 브라우저 회귀 시나리오.
- `docs/adaptive-positioning.md`: 본 보고서.
- 이전 데이터 업데이트 작업의 `scripts/base_station_master.py`: 구형/신형 Master 읽기.

## 5. 알고리즘 구조

Cell/기지국/주파수 연결 → Physical Site → 중앙 위치 기준 이상치 제외 → 측정자 스트림 분리 → timestamp별 ±시간창 → Site 대표 RSRP → 거리/가중치 → Site 개수별 위치 → 잔차/배치 조건/신뢰도/불확실성 → 이동속도 검사 순서다.

단일 기록의 동시 3기지국 관측을 가정하지 않는다. 전후 시간창을 쓰는 오프라인 추정이므로 미래 관측도 포함한다. 시간창 내 실제 이동은 모델 오차를 만들 수 있다.

## 6. Cell → Physical Site

새 CSV의 첫 번째 CellID는 기지국 ID, 두 번째는 Cell ID로 읽는다. CP949/UTF-8, DMS, `1550+1694`를 지원한다. 16개 원본 행은 주파수 확장 후 27개 레코드가 되고 20m 이내 Cell들을 8개 Site로 묶었다. 그룹 내 모든 Cell 사이 거리를 확인해 연쇄 병합을 막는다. Site 좌표는 그룹 중앙값이다. 여러 Cell/주파수가 있어도 최적화 관측은 Site당 1개다.

## 7. Adaptive Window 결과

같은 측정자 스트림에서 ±5/10/20/30/60초를 검사하고 3개 Site가 모이는 최소 창을 사용한다. 60초까지 부족하면 1/2 Site fallback을 사용한다.

| 시간창 | 관측 수 |
| --- | ---: |
| ±5초 | 3 |
| ±10초 | 2 |
| ±20초 | 3 |
| ±30초 | 6 |
| ±60초 | 351 |

기본 대표 RSRP는 max이며 median/mean도 지원한다. 대표값과 가장 가까운 측정값의 시간차를 사용하고, 동률이면 현재 timestamp와 가까운 관측을 선택한다.

## 8. Multilateration 구현

`d = 100 × 10^((-65 - RSRP)/(10 × 3))`, 범위 20–5000m. 이는 사용자가 요청한 초기 모델이며 현장 Calibration 결과가 아니다. TOTAL 송신 전력은 사용하지 않는다. 주파수 수치로 MHz를 추론하거나 추가 물리 보정을 적용하지 않는다.

시간 가중치 `exp(-|Δt|/10)`와 RSRP 가중치 `clamp(10^((RSRP-최대RSRP)/20), 0.1, 1)`를 곱한다. WGS84는 기존 지구반경 기반 로컬 동·북 meter 좌표로 변환한다. 3-Site 이상은 가중 중심을 초기값으로 감쇠 Gauss–Newton 방식의 비선형 최소제곱을 최대 80회 수행한다. 목적함수는 가중 거리 잔차 제곱합이다. 2-Site는 같은 가중치의 중심, 1-Site는 Site 좌표, 0-Site는 INVALID와 null 좌표다.

## 9. 추가 Layer

기지국, 추정 UE, 점선 경로, 청록색 불확실성 반경, Debug Layer를 개별 ON/OFF할 수 있다. Debug는 기본 OFF다. Debug에는 사용 Site 연결선, 거리 원, RSRP, Weight, Δt, signed residual이 표시된다. 레이어 변경 시 자신의 LayerGroup만 정리한다. 최근 표시 관측은 최대 150개로 제한한다.

## 10. 지도 정보와 조작

기지국 팝업에 Site/기지국/Cell 목록, PCI, 주파수, 사용 여부, 대표 RSRP가 표시된다. UE 팝업과 요약에는 timestamp, 좌표, 방식, Site/Cell 수, 평균·최대 RSRP, 신뢰도·등급, 예상 불확실성, residual, 시간창 및 사용 Site/Cell이 표시된다.

기존 콜/차트 선택과 연동하고 이전/다음·재생/일시정지·시간 슬라이더를 제공한다. 표시 필터는 시간, Cell, Site, 주파수, PCI, 최대 RSRP 하한, 신뢰도, 추정 방식이다. 이 필터는 계산 결과를 선별하며 원래 계산에 사용한 근거 자체를 제거해 재계산하지 않는다. 분석은 현재 선택한 측정자 스트림을 따른다.

## 11. Confidence

Site 수 25%, 시간창 15%, RSRP 15%, 잔차 25%, 기하 배치 20%의 경험적 점수다. 가중 방향 정보행렬의 determinant/trace로 배치 조건을 계산한다. A≥80, B≥65, C≥50, D≥30, E<30. 1-Site 최대49, 2-Site 최대64, 가상/출처 미확인 최대79다. **신뢰도 /100은 실제 정확도 백분율이 아니다.**

불확실성은 잔차+가중 평균거리의 40%를 바탕으로 배치, 시간창, 약한 RSRP에 따라 확대한다. 최소50m이며 작은 값으로 보이도록 상한을 강제하지 않는다. 200km/h 초과 시 기본 점수를 절반으로 줄이고 경로를 끊는다. Config에서 exclude/smooth도 선택 가능하다. 다른 스트림, 120초 초과 공백, INVALID, 필터로 빠진 중간 관측도 선으로 연결하지 않는다.

## 12. 실제 데이터 결과

실제 Excel 926행 중 기존 분석 화면의 무선 관측 365개를 계산했다. 365개 모두 Master 연결에 성공했다. 두 개 측정자 스트림을 분리했다. 이상 Site에 연결된 13개는 주변 유효 근거도 없어 INVALID이다. 19개 결과에 이동속도 이상 표시가 있다.

브라우저에서 확인한 10:24:30 결과 예: 35.216280, 126.859911, 3 Site, MULTILATERATION, ±60초, 신뢰도52/C, residual742m, 예상 불확실성 약±8636m. 이 큰 불확실성은 거리모델·배치 조건이 관측을 충분히 설명하지 못한다는 뜻이다. 주어진 과거 고객 좌표로 결과를 유도하거나 점수를 보정하지 않았다.

## 13. 방식 비율

전체 365개 기준:

| 방식 | 수 | 비율 |
| --- | ---: | ---: |
| MULTILATERATION | 38 | 10.41% |
| WEIGHTED_2_SITE | 102 | 27.95% |
| CELL_SITE | 212 | 58.08% |
| INVALID | 13 | 3.56% |

등급은 A0/B27/C39/D170/E129이다.

## 14. 브라우저 검증

앱 내 제어 연결이 Transport closed로 사용할 수 없어 별도 로컬 Chromium 브라우저 자동화를 사용했다. 앱을 새로 만들거나 다른 HTML 결과로 대체하지 않고 실제 `localhost:3000/qoe/`를 1920×1080에서 검사했다.

지도 타일28/28 로딩, 기지국 팝업, UE 직접 클릭과 팝업, Zoom/Pan, 지도 확대/복귀, Debug/불확실성 반경 토글, 다중 Site 필터, 빈 A등급 결과, 시간 범위, 이전/다음 및 재생/일시정지를 확인했다. 스크린샷은 `outputs/adaptive-map-qa.png`에 저장했다. 출력 경로는 Git 제외 대상이다.

## 15. 기존 기능 Regression

기존 경험적 알고리즘 전환, 위치 추정 OFF, 실측 데이터 전환과 기존 지도를 브라우저에서 확인했다. 실측 스크린샷은 `outputs/measured-map-regression.png`이다. 계산 테스트14개 그룹 및 Python Master 테스트2개, production build 통과. 전체 TypeScript 검사에는 이전부터 있던 Engineering 페이지 타입 오류3개가 있고 새 모듈 오류는 없다.

## 16. 발견한 데이터 이상

`RQKG73364T`/`13779214`의 위도 `37-19-30.092`는 다른 광주권 Site와 크게 떨어진다. 지역 중심 중앙값에서 30km를 초과해 SITE_008로 제외된다. 원본 좌표를 임의 수정하지 않았다. 새 CSV에 송신전력 종류와 is_virtual 필드가 없어 출처 미확인으로 표시한다. 주파수는 채널번호로 보일 수 있으나 단위 확정 근거가 없으며 거리모델에서 추가 주파수 보정은 하지 않는다.

## 17. 현재 한계

비동시 관측을 최대 ±60초로 합치므로 빠른 이동에서는 오차가 커진다. max 대표값은 반경을 작게 추정하는 편향이 있을 수 있다. 기준 RSRP와 n은 미보정 초기값이고 안테나 방향·높이·실내 손실·지형을 알 수 없다. 비선형 최소제곱은 초기값과 배치에 따라 국소 해가 나올 수 있다. 1/2-Site fallback은 실제 단말 위치를 식별한 결과가 아니다. 수 km 불확실성이 나오는 결과를 정밀 위치처럼 해석하면 안 된다. 지역 중심 이상치 규칙은 여러 도시가 섞인 Master에 그대로 적용하면 정상 Site도 제외할 수 있으므로 지역별 데이터 분리가 필요하다. 대규모 이력은 서버 사전계산/Worker로 옮길 여지가 있다.

## 18. 추가로 필요한 데이터

검증된 기지국 좌표, 주파수 단위, 안테나 방향/높이/패턴, 기준신호 전력, 동시 Neighbor 측정, 충분한 GPS ground-truth 샘플과 시간 동기화가 필요하다. 여러 위치에서 얻은 실측으로 P0/n/불확실성을 보정하고 별도 검증 구간에서 평가해야 한다. 현재 보고서의 신뢰도와 불확실성은 현장 정확도 검증 수치가 아니다.
