# QoE 분석 플랫폼 — 로컬 실행

이 폴더 안에서만 동작하는 로컬 웹 대시보드입니다. 배포 서비스와 연결되지 않습니다.

## 실행

터미널에서 이 폴더로 이동한 뒤 아래 명령을 실행합니다.

```bash
npm run local
```

브라우저에서 `http://localhost:3000`을 열면 됩니다.

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
