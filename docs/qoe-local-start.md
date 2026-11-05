# 재부팅 후 QoE 실행

프로젝트 폴더의 **`QoE 실행.cmd`를 더블클릭**하세요. 준비된 화면을 실행한 뒤 브라우저에서 아래 주소를 엽니다.

<http://localhost:3001/qoe/overview-proposal-4>

- 이미 실행 중이면 같은 서버를 재사용합니다.
- 실행 창이 닫혀도 화면은 계속 사용할 수 있습니다. PC를 종료하면 서버도 종료됩니다.
- 데이터 생성이나 빌드를 다시 실행하지 않습니다. 이 프로젝트의 `dist`, `node_modules` 폴더를 유지하세요.
- Node.js 22.13 이상이 필요합니다. 필요한 파일이 없거나 다른 프로그램이 포트를 사용하면 실행 창에 이유를 표시합니다.
- 최적화된 로컬 빌드는 `npm.cmd run build:local`로 준비합니다. 데이터 복사를 생략하므로 프로젝트의 `public` 폴더도 유지해야 합니다. 기존 `npm.cmd run build`는 데이터를 포함하는 기본 빌드로 유지됩니다.
- 접속은 이 PC에서만 가능합니다. 오류 로그는 `.tools/qoe-local-server` 폴더에 있습니다.

브라우저를 열지 않고 실행 상태만 확인하려면 프로젝트 폴더에서 다음 명령을 사용하세요.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-qoe.ps1 -NoBrowser
```
