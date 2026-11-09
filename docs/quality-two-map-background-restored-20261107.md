# 개선 2안 지도 배경 복원 (2026-11-07)

## 원인
개선 2안의 후보 점과 조사 원은 보이지만 VWorld 지도 배경이 회색으로 표시됨. 3016 전용 독립 빌드 폴더 stage-circles-20261107 생성 시 .env.local이 복사되지 않아, 클라이언트 빌드에서 VITE_VWORLD_API_KEY가 비어 있었음. 프로젝트 루트의 설정 파일에는 키가 존재했고 값은 출력하거나 기록하지 않음.

## 조치
루트 .env.local을 독립 stage-circles-20261107에 다시 복사하고 vinext build --mode local-preview 재빌드. 3019 임시 QA 서버에서 화면을 검증한 다음, 3016 전용 프로세스만 재기동. 3001, 3014와 원본 CDR/RTCP/MDT/GNSS 데이터 및 후보 계산식 불변.

## 검증
Edge Playwright 3016 실사용 경로에서 일반 지도 타일 15/15 및 전체화면 타일 20/20 성공(HTTP 200). 지도 타일 경고 없음, 브라우저 JS 오류 0. 기존 circle 시뮬레이터 테스트도 성공(관측점별 원 5개, 최종 원 1개, 실제 후보 1 표시 반경 170m).
검사 스크립트 scripts/tests/quality-two-map-background.browser.cjs, scripts/tests/quality-two-circles.browser.cjs.

## 배포 재발 방지
새 독립 빌드 폴더 생성 시 .env.local을 함께 복사하고 변수 존재만 검사한다(키 내용/타일 URL 공개 금지). 지도를 실제 브라우저에서 열어 타일 img의 naturalWidth > 0, tile 응답 200 여부까지 확인한다.