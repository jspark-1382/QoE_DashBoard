# 기지국 인벤토리 및 PCI 반영

## 반영 범위

원본은 `data/BaseStation/수도권_LTE_261104.xlsx`이며 파일 날짜는 2026-11-04다. 측정 데이터는 2026-10-26~30이므로 이 파일을 당시 운영 구성의 이력으로 단정하지 않는다. Excel은 읽기 전용으로 사용한다.

- 입력 87,562행, 식별자·좌표가 유효한 RU+Cell 87,322개, 제외 240행.
- 유효 셀 중 등록 PCI 87,321개, 미제공 1개, 서로 다른 PCI 495개.
- 기존 정확 매칭 기지국 252개의 좌표는 모두 동일하다.
- CDR 연계 MDT 93,312건 중 RU+Cell 정확 일치 78,830건. PCI 비교 가능 43,417건은 모두 일치한다.
- 등록 셀 미확인 14,482건과 정확 일치 셀에서 PCI 비교 불가 35,413건을 별도로 표시한다.

`/qoe/stations`에 전체 기지국 검색, PCI 필터, 미확인 필터, 페이지 이동, 선택 셀의 등록 위치·출처를 추가했다. 전체 인벤토리를 지도에 한꺼번에 그리지 않는다. 고객·통화 분석에서는 원본 관측 PCI와 등록 PCI를 분리하고 RU+Cell 정확 일치 기준으로 비교한다. CDR BYE 기지국의 등록 PCI는 관측 PCI로 취급하지 않는다.

## 데이터 정책

- 등록 PCI는 정수 0~503만 유효하며 0을 결측으로 처리하지 않는다.
- 좌표가 유일하더라도 등록 PCI 값이 충돌하면 임의로 하나를 선택하지 않는다.
- 동일 PCI만으로 셀을 연결하지 않는다. 셀의 동일성은 RU+Cell 기준이다.
- 존재하지 않는 과거 TXT를 새 데이터의 매칭 근거로 사용하지 않는다.
- manifest에 인벤토리 파일명과 SHA256을 기록한다. 파생 데이터 생성 시 다른 파일·내용이 전달되면 중단한다.
- MOS, 계약 식별자, 통화 식별자, 원본 관측 PCI와 GNSS는 변경하지 않는다. 새 인벤토리로 위치 근거만 다시 계산한다.
- 기존 연구 보고서는 당시 결과로 보존한다. 현재 화면용 요약·3사이트·조사 후보·무선 참고 자료는 현재 revision으로 재생성한다.

## 재생성 순서

실행 중인 `public`에 차례로 덮어쓰면 파일 간 revision이 달라질 수 있다. 별도 staging public에서 아래 순서로 생성하고 검증한 뒤 함께 교체한다. `$stage`는 새 임시 public 디렉터리, `$master`는 사용할 인벤토리 경로다.

```powershell
python scripts/build_voice_1030.py --out "$stage/voice-1030.json" --lte-master $master --audit "$stage/../outputs/voice-quality.json"
node scripts/build-analyst-overview.cjs MDT --public-dir $stage --bye-catalog $master
python scripts/build_three_site_rough.py --public-dir $stage --lte-master $master
python scripts/analyze_improvement_candidates_20261104.py --public-dir $stage --lte-master $master --out "$stage/../outputs/screening.json"
python scripts/build_improvement_candidate_ui.py --public-dir $stage --lte-master $master --screening-report "$stage/../outputs/screening.json"
python scripts/build_radio_investigations.py --public-dir $stage --lte-master $master
python scripts/build_station_catalog.py --public-dir $stage --lte-master $master
python scripts/build_nr_station_catalog.py --public-dir $stage
```

기본 인벤토리 선택 순서는 명시 경로 → `QOE_LTE_MASTER` → 파일명 날짜가 가장 최신인 workbook이다. `QOE_PUBLIC_DIR`도 지원한다. 단일 파일의 UI 목록만 다시 생성할 때는 `npm run data:stations`, 등록·관측 PCI 관련 검증은 `npm run test:stations`를 사용한다.

5G 등록 목록은 별도 `nr-station-catalog.json`이며, [5G 인벤토리 반영 문서](nr-station-inventory-20261106.md)의 갱신 명령과 범위를 따른다. MDT 관측 매칭과 CDR BYE 매칭은 구분한다. BYE는 같은 종료 메시지의 PANI에 따른 LTE/NR과 Cell ID로 조회하며, 통신 방식이 미상이면 두 인벤토리에서 조회한다. 복수 후보의 화면 표시는 [MDT 우선·첫 유효 후보 선택 정책](bye-site-selection-20261107.md)을 적용하고, 통계 분석용 유일성 판정은 유지한다. 원본 생성기는 같은 인벤토리 디렉터리의 최신 NR 파일을 선택하고 `meta.byeStationInventories`와 원본 revision에 LTE·NR 파일 해시를 포함한다. `build-analyst-overview.cjs --nr-catalog`는 선언된 NR 파일·해시가 일치하는 경우에만 허용한다.

## 다음 분석의 우선순위

1. **RU+PCI 보조 후보**: 정확 RU+Cell 미확인 관측 중 8,096건은 RU와 등록 PCI가 일치한다. 원본 Cell 변경 이력과 GNSS 근거로 검증한 뒤 별도의 참고 후보로 제시하면 위치 미확인 원인을 줄이는 데 도움이 된다. 현재 정확 매칭이나 고객 위치로 승격하지 않았다.
2. **관측 PCI 변화와 품질 비교**: 같은 통화의 PCI 변화 시점에 RSRP·SINR·MOS·종료 원인을 함께 보여준다. 단순 PCI 변화는 실제 핸드오버 성공·실패를 입증하지 않으므로 RRC/핸드오버 로그와 대조한다.
3. **인접 셀 PCI 재사용 조사**: 가까운 기지국의 동일 PCI를 지도에서 조사 후보로 묶을 수 있다. 충돌·혼동 판단에는 EARFCN/주파수, 섹터 방향, 인접 관계와 현장 관측이 추가로 필요하다. 현재 파일에는 해당 정보가 없다.
4. **인벤토리 변경 감사**: 다음 파일부터 추가·삭제된 RU+Cell, 좌표 이동, PCI 변경·결측을 이전 파일과 비교해 갱신 영향과 검토 대상을 보여준다. 실제 적용일 컬럼이 있으면 측정일에 맞는 이력 매칭까지 확장할 수 있다.

PCI 유효 범위는 [ETSI TS 136 211](https://www.etsi.org/deliver/etsi_ts/136200_136299/136211/08.06.00_60/ts_136211v080600p.pdf)을 참고한다. PCI 충돌·혼동 조사의 구분은 [Qualcomm SON test plan](https://www.qualcomm.com/content/dam/qcomm-martech/dm-assets/documents/son_test_plan_qc_website_final_v3.pdf)을 참고한다.
