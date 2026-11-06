# 5G 기지국 인벤토리 반영

원본 `data/BaseStation/수도권_5G_261106.xlsx`의 등록 정보를 기지국·PCI 화면에 추가한다. LTE/5G 버튼으로 통신 방식을 고른 뒤 RU·Cell·PCI 검색, 50행 페이지 이동, 선택 기지국의 등록 위치와 출처를 확인한다. 선택을 바꾸면 이전 통신 방식의 검색 조건과 지도 선택을 초기화한다.

## 원본과 집계

- 단일 시트, 헤더 `ru_id, cell_id, pci, latitude, longitude`.
- 입력 76,161행, 유효 RU+Cell·좌표가 있는 75,629개를 등록한다. Cell ID와 PCI가 없는 532행은 등록 대상에서 제외한다.
- 등록된 행의 PCI는 모두 유효하며 서로 다른 값 1,008종을 포함한다. PCI 0은 결측이 아니다.
- 5G/LTE 사이에 같은 Cell ID 45개가 존재한다. 통신 방식과 RU+Cell을 함께 식별자로 사용하고, 서로 다른 통신 방식의 셀을 합치지 않는다.
- 원본 파일은 수정하지 않는다. 출력에 파일명·SHA256·파일 날짜를 기록한다.

## 분석 범위

MDT 무선 관측은 LTE 부분표본이지만, SIP CDR에는 5G VoNR 통화도 포함되어 있다. 선택된 종료 Cell과 같은 BYE 메시지의 PANI에서 종료 통신 방식을 보존하고 해당 LTE/NR 인벤토리 안에서 조회한다. 복수 후보는 같은 통화의 MDT 장비 일치를 우선하고, 결정할 수 없으면 원본 목록의 첫 유효 후보를 선택한다. 종료 통신 방식이 미상이면 두 인벤토리에서 조회한다. [현재 BYE 선택 정책](bye-site-selection-20261107.md)에 따라 선택 근거를 표시하며, 기존 GNSS·검토 가능한 무선 위치를 우선하고 BYE는 단말 위치로 취급하지 않는다.

5G 관측 PCI나 MDT/GNSS 측정값을 새로 만들지 않는다. MOS, 통화·고객 식별자와 원본 관측은 유지한다. 화면의 동일 PCI 등록 셀 수도 선택한 통신 방식 안에서만 센다. NR 인벤토리 해시를 고객 데이터의 revision에 포함하므로 인벤토리 변경 후에는 현황과 종속 자료를 함께 재생성해야 한다.

LTE PCI 0~503과 5G NR PCI 0~1007을 구분해 검증·검색한다. NR 범위는 [ETSI TS 138 211, 7.4.2.1](https://www.etsi.org/deliver/etsi_TS/138200_138299/138211/18.08.00_60/ts_138211v180800p.pdf)의 1,008개 물리 셀 식별자에 따른다.

## 갱신

`npm run data:stations:5g`로 최신 `수도권_5G_YYMMDD.xlsx`를 읽어 `public/nr-station-catalog.json`을 생성한다. `--nr-master` 또는 `QOE_NR_MASTER`로 파일을 지정할 수 있다. `--public-dir` 또는 `QOE_PUBLIC_DIR`로 별도 출력 디렉터리에 먼저 생성·검증할 수 있다. 출력 파일은 임시 파일을 완성한 뒤 원자적으로 교체한다.

`npm run data:stations:all`은 LTE와 5G 검색 목록만 갱신한다. 이 명령이나 서버 재시작만으로 현황용 BYE 위치가 다시 계산되지는 않는다. BYE 위치에도 새 Cell을 반영하려면 [인벤토리 갱신 순서](station-pci-refresh-20261106.md)에 따라 원본 CDR의 종료 RAT, overview 및 종속 자료를 별도 staging에서 일괄 재생성·검증한 뒤 함께 교체한다. 원본 재생성기의 `--nr-master`/`QOE_NR_MASTER`로 사용할 NR 파일을 지정할 수 있다.

`npm run test:stations`로 LTE/5G 인벤토리, 식별자·좌표·PCI 검증, UI 전환과 기존 PCI 비교를 함께 확인한다.
