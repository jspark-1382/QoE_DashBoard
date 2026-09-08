# QoE 분석 플랫폼 — 로컬 실행

이 폴더 안에서만 동작하는 로컬 웹 대시보드입니다. 배포 서비스와 연결되지 않습니다.

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
```

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
```

MDT 화면만 사용할 경우 `py -3 scripts/extract_mdt_data.py`만 실행해도 됩니다. 이 경우 실측/Engineering 화면의 데이터는 별도로 준비해야 합니다. MDT 추정 기능에는 기지국 Master도 필요합니다.

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

### Executive Dashboard

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
