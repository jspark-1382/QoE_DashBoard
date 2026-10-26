# QoE 분석 플랫폼 — 로컬 실행

이 폴더 안에서만 동작하는 로컬 웹 대시보드입니다. 배포 서비스와 연결되지 않습니다.

## 분석가 작업 화면

기본 `/qoe/`는 **품질 현황**, 원본 서비스계약번호를 선택하거나 기존 `?source=MDT&customer=...&date=...` 링크를 열면 **계약·통화 분석**으로 연결됩니다. 지역/시간을 조사한 뒤 통화를 선택하고, 지도·원래 단위의 무선 차트·원본 관측 근거를 함께 확인합니다. 실측 자료는 데이터 출처에서 선택합니다.

- 품질 현황의 `현재 조사`에서 시간·구역·위치 없음 조건과 결과 수를 확인하고 각각 해제할 수 있습니다. 구역 이름이 없으면 전체 일자 목록을 기준으로 고정한 `조사구역 N` 별칭을 사용하며, 원래 격자 ID와 중심 좌표는 구역 이름의 설명에 남깁니다.
- `목록 확장`은 더 많은 통화를 보여주고, 시간대 차트의 `건수 / 비율` 전환은 같은 시간대 평가 가능 통화를 분모로 사용합니다. 평가 없는 시간은 비율 0%와 구별합니다. 조사 조건과 보기 전환은 전체 분석 요약을 바꾸지 않습니다.
- 계약 분석에서는 통화 목록 접기와 `지도 중심 / 근거 중심` 보기를 선택할 수 있습니다. 시간축을 선택 시점 주변 1분/5분으로 확대하고 `다음 조건 관측 / 다음 Cell 변경 / 다음 30초 초과 공백`으로 이동합니다. 확대 중에도 슬라이더와 이전/다음은 전체 통화의 원본 관측 순서를 유지합니다.
- 지도 숫자 범례는 실제 색상 판정과 같은 기준을 사용합니다. SINR 지도 색상 3dB 기준과 관측 탐색 0dB 기준은 각각 표시하며, 위치 근거·기지국·원본 행·종료 코드는 접어서 확인합니다. 무선 위치의 반경은 검증된 정확도가 아니라 모델 불확실성 추정으로 표시합니다.
- 번호를 모르면 상단 `계약 목록 / 계약 선택`을 엽니다. 현재 일자의 목록을 입력 없이 탐색하고 페이지 이동·번호 일부 검색·`GNSS 없는 계약만` 필터로 대상을 고릅니다. 현황 표의 계약번호를 눌러 해당 통화를 열 수도 있습니다.
- 계약 분석은 통화 표 / 지도·RSRP·SINR / 선택 관측의 3단 화면입니다. `지도 옵션`과 `시간축 도구`, 오른쪽의 접힌 근거에서 상세 기능을 엽니다. 통화 목록의 `자료 전체 / MDT 있음 / CDR만`은 GNSS 유무와 별개입니다. CDR 전용 통화는 원본 시작·종료 Cell-ID를 표시하고 좌표 매핑이 없으면 위치를 미제공으로 남깁니다.
- 품질 현황은 상단 요약 / 분포·시간대·체감 차트 / 지도·구역 / 통화 목록 순서입니다. `평가 지표`에서 실제 MOS가 제공될 때만 MOS를 선택할 수 있으며 평균·불량 기준·지도·목록도 함께 전환됩니다. 색 구간과 체감 카드를 누르면 조사 조건에 교차 적용되고 상단 전체 분모는 유지됩니다. 미니 막대는 전일 비교가 아닌 시간 내 실제 집계입니다. 비정상 종료 분류나 연속 통화 순서를 확인할 수 없는 항목은 미제공으로 표시합니다.
- MDT 통화 지도 위의 `자동 위치 추정`은 GNSS 우선과 좌표 없는 시점의 무선 추정을 설명합니다. 3개 이상 기지국의 거리 기반 삼변·다변측량, 2개 기지국 가중중심, 단일/부족 근거의 위치 보류를 구분합니다. `무선 추정 시점으로 이동` 후 `추정 근거 보기`를 켜면 선택 관측의 사용 기지국·연결선·모델 거리 참고 원을 볼 수 있습니다. 근거 기지국 맞춤은 명시 버튼으로 수행하고, 연결선은 고객 이동 경로가 아닙니다.

```powershell
npm.cmd run data:mdt
npm.cmd run data:overview
npm.cmd run dev -- --port 3001
```

- `data:mdt`는 `data/MDT_New`가 있으면 우선 사용하고 고객·일자별 상세와 목록을 원자적으로 생성합니다. `-- --source-dir data/MDT`로 구형 입력도 지정할 수 있습니다. 기존 데이터가 있다면 재추출 없이 `data:overview`와 `dev`만 실행해도 됩니다.
- 현황은 일자별 요약 파일을 읽고, 계약을 선택할 때 해당 상세만 읽습니다. 원본을 갱신한 후에는 `npm.cmd run data:overview`도 실행합니다. MDT만 갱신하려면 `npm.cmd run data:overview -- MDT`입니다. 없는 선택 출처는 기본 전체 갱신에서 건너뜁니다.
- 현재 MDT_New의 좌표계는 사용자가 확인한 **UTMK / EPSG:5179**입니다. 원본 계약번호 문자열과 독립 통화 기록을 보존하며, 정확도가 없는 GNSS에는 정확도를 만들지 않습니다. 다른 좌표계의 자료는 `-- --gnss-crs unknown`으로 변환을 끕니다.
- 저품질 기준은 `meta.poorQoeThreshold`(기본 QoE < 2.5)로 통일합니다. 평가 가능 통화를 비율 분모로 사용하며 평가 불가·위치 없음 통화도 별도로 집계합니다. 지도와 순위는 같은 60m 격자입니다.
- 원본 GNSS는 그대로 사용합니다. 좌표가 없는 시점의 무선 추정은 기존 모델을 통화 안에서 적용하며, 단일 기지국을 고객 좌표로 복사하지 않습니다. 모델 후보 반경은 측정 정확도 보장이 아닙니다.
- 원본 데이터·생성 상세·일자별 요약·실제 데이터가 보이는 QA 캡처는 Git에서 제외됩니다. 설계 문서와 설명용 시안은 `docs/superpowers/specs`에 있습니다.

검증: `npm.cmd run test:analyst`, `node scripts/test-location-estimation.cjs`, `py -3 -m unittest discover -s scripts -p "test_*.py"`, `npx.cmd tsc --noEmit --incremental false`, `npm.cmd run build`.

## Windows 설치 및 실행

아래 명령은 **Windows PowerShell** 기준입니다. 모든 프로젝트 명령은 `package.json`이 있는 폴더에서 실행합니다.

### 1. 필수 프로그램 설치

- Git for Windows: 저장소 다운로드에 사용합니다. ZIP으로 받는 경우 생략 가능합니다.
- Node.js: 프로젝트 요구 버전은 **22.13.0 이상**입니다. Node.js 설치 시 npm도 함께 설치합니다.
- Python 3: 데이터 변환에 사용합니다. Python 3.11 이상 환경을 준비하고 설치 시 Python Launcher 또는 PATH 등록을 활성화합니다.

설치 후 PowerShell 창을 새로 열어 확인합니다.

```powershell
git --version
node --version
npm.cmd --version
py -3 --version
```

`py`가 없고 `python --version`이 정상 동작하면 아래의 `py -3`를 `python`으로 바꿔 실행합니다. 데이터 추출 스크립트는 Python 표준 라이브러리만 사용하므로 별도의 pip 패키지는 필요하지 않습니다.

### 2. 프로젝트 다운로드 및 의존성 설치

원하는 작업 폴더에서 실행합니다. 이미 프로젝트를 받은 경우 `git clone`은 생략하고 기존 폴더로 이동합니다.

```powershell
git clone https://github.com/jspark-1382/QoE_DashBoard.git
cd QoE_DashBoard
npm.cmd ci
```

현재 PC의 기존 프로젝트를 사용하는 경우 경로에 공백이 있으므로 따옴표로 감쌉니다.

```powershell
cd "C:\Users\jae-sang\Downloads\GPT개발\QoE_Metrics"
```

`npm.cmd`는 PowerShell에서 `npm.ps1` 실행 정책 오류를 피하기 위한 표기입니다. 시스템 실행 정책을 변경할 필요는 없습니다.

### 3. 데이터 배치

원본 데이터는 Git에 포함되지 않으므로 별도로 복사해야 합니다.

```text
data/
  실측/
    20260821_행정동.xlsx
    복사본 RTCP_NEW_0714.xlsx
  MDT/
    VT_VOLTEMDT_20260907172438.xlsx
  BaseStation/
    virtual_base_station.csv
    BaseStation_new.txt
  lte+mdt(개포4동_계약번호 추가).xlsx
```

`data` 최상위의 `lte+mdt` 파일은 선택 항목으로, 계약번호가 포함된 통합 MDT 원본(영어 스키마)을 `extract_mdt_merged.py`가 화면 데이터로 변환합니다. 통합 원본이 있으면 `data:mdt`의 기존 MDT 파이프라인 대신 통합 파이프라인을 사용합니다.

Excel 파일명은 예시입니다. 실외 데이터는 파일명에 `행정동`, 인빌딩 데이터는 `RTCP`가 포함되어야 합니다. MDT는 `data/MDT`의 `.xlsx` 파일을 읽습니다. 파일 내용은 기존 추출 스크립트가 지원하는 컬럼 형식이어야 합니다. 기지국 Master 경로와 파일명은 위와 동일하게 사용합니다.

### 4. 지도 키 설정

프로젝트 최상위 폴더에 `.env.local` 파일을 만들고 다음을 입력합니다. 기존 파일이 있다면 다른 설정을 지우지 말고 해당 항목만 추가·수정합니다.

```dotenv
VITE_VWORLD_API_KEY=발급받은_VWorld_키
```

실제 키와 원본 측정 데이터는 저장소에 올리지 않습니다. 지도 키가 없거나 외부 지도 연결이 실패하면 배경 지도가 보이지 않을 수 있습니다.

### 5. 화면용 데이터 생성

전체 데이터가 준비된 경우 다음 명령을 순서대로 실행합니다. 각 명령이 오류 없이 끝났는지 확인한 뒤 다음 명령을 실행합니다.

```powershell
py -3 scripts/extract_qoe_data.py
py -3 scripts/extract_indoor_data.py
py -3 scripts/extract_executive_data.py
py -3 scripts/extract_mdt_data.py
py -3 scripts/extract_mdt_merged.py
```

MDT 화면만 사용할 경우 `py -3 scripts/extract_mdt_data.py`만 실행해도 됩니다. 이 경우 실측/Engineering 화면의 데이터는 별도로 준비해야 합니다. MDT 추정 기능에는 기지국 Master도 필요합니다.

통합 MDT 원본(`data/lte+mdt*.xlsx`)은 `py -3 scripts/extract_mdt_merged.py`(별명 `npm.cmd run data:mdt-merged`)로 변환하며, 결과가 같은 `public/mdt-data.json`에 쓰이므로 기존 MDT 파이프라인 대신 사용할 수 있습니다. 크기 추정(원본 행×260B)이 80MB를 넘으면(이 파일이 해당) 원본 행 100개 미만 계약이 자동 제외되며 `--min-samples`로 조정합니다. 원본 GNSS 좌표(`gnss_utmkx/utmky`)는 `BaseStation_new.txt` 실기지국 마스터로 캘리브레이션한 affine 변환(중위 오프셋 약 210m)으로 고객 실좌표로 사용하고, 좌표가 없는 측정 행은 그 행이 첨부한 기지국의 좌표를 사용합니다.

### 6. 서버 실행 및 접속

```powershell
npm.cmd run dev
```

서버가 시작되면 브라우저에서 엽니다.

- 기본 대시보드: [http://localhost:3000/qoe/](http://localhost:3000/qoe/)
- MDT 대시보드: [http://localhost:3000/qoe/?source=MDT](http://localhost:3000/qoe/?source=MDT)
- Engineering 화면: [http://localhost:3000/qoe/engineering](http://localhost:3000/qoe/engineering)

서버 실행 중에는 PowerShell 창을 열어 둡니다. 종료하려면 해당 창에서 **Ctrl+C**를 누릅니다. 다시 실행할 때는 프로젝트 폴더에서 `npm.cmd run dev`를 실행하면 됩니다. 이 명령은 원본 데이터를 재추출하지 않습니다.

### 데이터 변경 후 / 자동 추출 실행

원본 Excel 또는 Master CSV를 변경했다면 해당 추출 스크립트를 다시 실행하고 브라우저를 새로고침합니다. `.env.local` 변경은 서버를 종료한 뒤 다시 실행해야 적용됩니다.

현재 `package.json`의 `data:*` 명령은 `python3` 명령을 사용합니다. Windows에서 `python3 --version`이 정상 동작하고 실외·인빌딩 원본까지 모두 준비된 경우에만 다음 자동 추출 실행을 사용할 수 있습니다.

```powershell
npm.cmd run local
```

`npm run local`은 실행 전 전체 데이터를 재생성합니다. `python3`가 없으면 앞서 설명한 **`py -3`로 데이터 생성 → `npm.cmd run dev`** 방식을 사용합니다.

### 실행 문제 확인

- `node`/`npm.cmd`를 찾지 못함: Node.js 설치 및 PATH 등록을 확인하고 터미널을 새로 엽니다.
- Python 실행 시 Store가 열림: 설치된 Python의 `py -3` 또는 정상 동작하는 `python` 명령을 사용합니다.
- 데이터 추출 중 파일 없음/`StopIteration`: 원본 파일 경로와 `행정동`/`RTCP` 파일명을 확인합니다. 없는 종류의 데이터 추출은 생략합니다.
- 화면에 데이터를 불러오지 못했다고 표시됨: `public/executive-data.json` 또는 `public/mdt-data.json`이 생성됐는지 확인합니다.
- 3000 포트 사용 중: 기존 서버 창이 있는지 확인합니다. 서버가 다른 포트를 안내하면 터미널에 표시된 포트의 `/qoe/`로 접속합니다.
- 접속 거부: 서버 터미널이 종료됐거나 시작에 실패한 상태인지 확인합니다.

선택적으로 빌드 및 위치 추정 계산 테스트를 실행할 수 있습니다.

```powershell
npm.cmd run build
node scripts/test-location-estimation.cjs
```

테스트의 로컬 MDT 데이터 검증은 `public/mdt-data.json`이 있을 때만 실행됩니다. 위 설치 절차는 기존 프로젝트 설정을 기준으로 정리했으며, 새 Windows PC에서의 전체 신규 설치 검증은 별도로 필요합니다.

## 데이터 갱신

- 실외 원본: `data` 폴더의 파일명에 `행정동`이 포함된 Excel
- 인빌딩 원본: `data` 폴더의 파일명에 `RTCP`가 포함된 Excel
- `npm run local` 실행 시 두 원본을 자동으로 읽어 화면용 분석 데이터를 다시 생성합니다.
- 실행 중 원본을 교체했다면 서버를 다시 시작합니다.

### 통합 MDT 데이터 (이전 화면·비교용)

이 절은 이전 Executive 화면과 `data:mdt-merged` 비교 파이프라인의 동작 기록입니다. 현재 기본 화면·데이터 갱신은 위 **분석가 작업 화면** 절을 따릅니다.

- `data` 폴더 최상위에 `lte+mdt`가 이름에 포함된 Excel 원본을 둡니다(계약번호 컬럼 포함 영어 스키마).
- `py -3 scripts/extract_mdt_merged.py`를 실행하면 계약·콜 단위로 집계해 `public/mdt-data.json`을 다시 만들고, `data/BaseStation/BaseStation_new.txt`(형식: `기지국ID,위도,경도`, 1행 1기지국)를 실기지국 마스터로 화면에 주입합니다. 가상 기지국은 생성하지 않습니다. 화면 갱신은 브라우저 새로고침입니다.
- 화면에서 고객 측정점(고객체감품질 지도의 품질색 점선)과 기지국(`SITE_xxx` 마커)는 별도로 표시됩니다. 지도에는 선택한 고객이 관측한 기지국만 표시되어 마스터 전체(999국)가 그려지지 않습니다. 좌표가 없는 구간은 RSRP 기반 위치추정(Adaptive · 다중 Site)이 보간합니다. 추정 모드에서 `기지국` 토글(기본 OFF)로 사이트 마커를, `측정 트랙`으로 고객 GNSS 실측정 궤적을 추정 점과 겹쳐 볼 수 있습니다.
- 첫 화면은 고객 선택의 `전체 · 저QoE 분석`입니다. 전체 계약에서 QoE 3.0 이하 관측만 60m 격자로 집계한 저QoE 지도(점 크기=밀도, 색=평균 QoE)와 시간대 분포, 최악 200개 콜 테이블이 먼저 나타납니다. 지도의 점이나 콜 테이블 행을 클릭하면 그 콜의 고객이 선택되어 해당 고객의 하루 전체 데이터로 전환됩니다. `?customer=` URL은 그대로 그 고객부터 열립니다.
- 첫 화면에는 저QoE 격자 상위 12개와 저QoE 관측 최다 PCI 상위 10개를 두 열로 보인 `저품질 클러스터 순위` 패널이 있습니다. 행 클릭은 그 클러스터 최악 콜의 고객으로 이동합니다. `주요 원인` KPI는 저하 에피소드가 없어도 표시 구간 전체를 근거로 산출하며, MDT(MOS 없음)에서는 `무선 정상인데 QoE 3.0 미만` 근거와 `Handover·셀 재선택 빈번(distinct PCI 3개 이상)` 신규 근거를 사용합니다.
- 세 지도(첫 화면·추정 OFF·추정 ON) 모두에서 `행정경계` 토글로 VWorld WMS의 시·군·구(`lt_c_adsigg`)와 시·도(`lt_c_adsido`) 점선 경계를 위성 배경 위에 겹쳐 볼 수 있습니다(투명 PNG 타일, 기본 OFF, 키가 WMS 서비스를 허용해야 함).
- 고객 선택 창은 계약별 `좌표 없음 %`를 표시하고 `좌표 많은 순` 토글로 정렬할 수 있습니다. 추정 OFF 화면의 `경로: 선/점` 토글로 측정 경로를 연결선 또는 개별 점으로 비교합니다. 추정 ON의 지도는 항상 **표시 범위 전체를 한 번에** 보여 줍니다 — 전체 보기면 하루 전체, 콜 선택 시(`CI NNN 콜만 ✕` 칩)에는 그 콜만. 시간 바(슬라이더)는 점을 숨기는 게 아니라 선택 점을 옮깁니다.
- 원본의 `gnss_utmkx/utmky` 좌표계는 아직 확인되지 않아, 위치는 사이트(개포4동) 대표 좌표를 사용합니다. 좌표계(EPSG)가 확인되면 `scripts/gnss_utm.py`의 `CHOSEN`만 갱신하면 실제 경로 표시가 켜집니다.
- 원본 Excel과 생성된 JSON·CSV는 Git에 포함되지 않습니다.

### Executive Dashboard (이전 화면)

- 기본 경로 `/qoe/`는 고객 전화번호를 마스킹한 고객·일자별 Executive Dashboard입니다.
- 고객별 측정 경로와 KPI는 `public/executive-data.json`에서 읽으며 `npm run data:executive`로 다시 생성합니다.
- 고객명은 원본에 없으므로 임의 생성하지 않고 `측정 고객 NN`으로 표시합니다.
- 기존 Engineering/Inbuilding 화면은 `/qoe/engineering` 경로에 유지됩니다.

### 인빌딩 데이터

- `data` 폴더에 `RTCP`가 포함된 인빌딩 Excel 파일을 넣습니다.
- `npm run data:all`을 실행하면 실외와 인빌딩 분석 데이터를 함께 갱신합니다.
- 대시보드 지도 패널의 `인빌딩` 버튼을 누르면 층별 건물 보기를 사용할 수 있습니다.
- 원본 Excel과 생성된 `public/indoor-data.json`은 Git에 포함되지 않습니다.

## VWorld 지도 키

프로젝트 폴더의 `.env.local`에 아래 값을 설정합니다.

```text
VITE_VWORLD_API_KEY=발급받은_VWorld_키
```

`npm run local`로 다시 시작하면 자동으로 적용됩니다. 키와 `.env` 파일은 Git에 포함되지 않습니다. 키가 없어도 측정점과 품질 분포는 로컬 배경 위에서 확인할 수 있습니다.
