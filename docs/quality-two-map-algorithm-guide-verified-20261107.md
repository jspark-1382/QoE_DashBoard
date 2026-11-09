# 개선 2안 — 지도 전체화면 왼쪽 알고리즘 설명 패널 (2026-11-07)

## 요구 및 UI 변경
개선 2안의 `조사 후보 지도 → 지도 전체 화면`을 열면 좌측에는 독립 스크롤 가능한 단계별 알고리즘 설명, 우측에는 기존 Leaflet 후보 지도를 계속 제공한다. 일반 지도에서는 설명을 숨기고 기존 구조를 유지한다. 680px 이하에서는 설명 위·지도 아래 배치하며 전체화면 ESC 종료를 지원한다.

### 설명 흐름 (실제 구현 기준)
1. 조회 조건: 개선 2안, 시작일/종료일, 시작/종료 시간, 전체 고객 기준 사전 산출물 조회. 후보 클릭은 재계산이 아님.
2. 원본: SIP CDR, RTCP MOS(v5), MDT 연결; 1≤MOS<3의 저MOS 통화를 후보용 원본에 사용.
3. 위치: CDR↔MDT 고유 연결 및 유효 좌표 심사를 통과한 GNSS/엄격 검토 3-Site만 채택. BYE Cell 기지국 단독 좌표는 제외.
4. DBSCAN: haversine eps=100m, min_samples=2, 클러스터에 고유 저MOS 고객≥3명, 저MOS 관측일≥2일.
5. 대표점: 클러스터 실제 관측점 중 최대 거리 최소화(minimax medoid); 표시 반경=ceil(max(100m, 중심에서 최원거리+20m)/10)*10. 군집 내 최대 점간 거리>200m이면 범위 검토 플래그 및 rank 미부여. 화면 후보 번호는 rank 아님.
6. 검증: holdout은 선택기간 마지막날을 검증일로 분리. 검증일 점이 군집 구성 점 중 어느 점에서든 100m 이내이면 인근 재관측. 발견기간에 없던 고유 고객≥2명이 저MOS 재관측을 보여야 ‘새 고객 재관측’.
7. 실무 해석: 현장 RF/SCAN/음성 검증 이전에 원인 확정 불가. 모델 입력 좌표는 RTCP MOS 열화 순간 정확한 위치 보증이 아님.

## 실제 예시
- scope: 2026-10-26~2026-10-30 / 00:00~23:59 / strict-3-site-v1
- 발견기간: 10/26~10/29; 검증일: 10/30.
- 엄격 위치 조사 후보 7곳 중 새 고객 재관측 3곳.
- 화면 후보 지역 1: 고유 저MOS 고객 5명, 발견기간 저MOS 통화 5건, 관측일 3일, 검증일 신규 고객 2명, GNSS 5통화. 중심에서 최원거리 약 145.4m, 두 구성점간 최대 약 208.9m. 표시 반경 170m. 200m 초과이므로 **재관측은 존재하지만 범위 검토로 순위는 미확정**. 동일 고객의 반복 저MOS 5명이라는 뜻이 아님.
- 설명 패널의 실제 사례는 선택된 후보 summary/detail에서만 읽으며, 다른 후보 마커 클릭 시 숫자가 즉시 갱신된다.

## 코드 및 동작 분리
- 신규: `components/analyst/quality-two-algorithm-guide.tsx`, `.module.css`
- 변경: `components/analyst/quality-two-candidate-workspace.tsx`, `.module.css`
- 알고리즘 원본: `scripts/voice_improvement_1.py`, `lib/analyst/voice-improvement-1/scope.ts`
- 전체화면 컨트롤 기존 `MapPanelFrame`과 Leaflet 인스턴스는 유지. 지도 컨테이너를 설명 패널의 형제 요소로 배치하고, 리사이즈 시 기존 map invalidation으로 크기를 갱신한다.
- 신규 테스트: `scripts/tests/quality-two-algorithm-guide.test.cjs`, `scripts/tests/quality-two-algorithm-guide.browser.cjs`
- 실사용 URL: http://127.0.0.1:3016/qoe/?variant=improvement2&dateStart=2026-10-26&dateEnd=2026-10-30&mapMode=improvement
- 실행/빌드: `scripts/serve-quality-algorithm-guide-preview.cjs` → `outputs/quality-improvement-two-deploy/stage-algorithm-20261107/dist`. 이전 배포본 `stage-usability-20261107`을 롤백용으로 유지.

## 검증
- TypeScript 검사, oxlint: PASS.
- JS 실데이터 기반 회귀/설명 테스트: 32/32 PASS.
- Python 원본 후보 산정 테스트: 15/15 PASS.
- 실제 Windows Edge 브라우저(배포 전 3019 및 배포 후 3016):
  - 전체화면 좌측 단계 안내와 우측 지도 분리, 패널 독립 스크롤.
  - 지도의 미선택 후보 마커 클릭 → 왼쪽 실데이터 예시 변경.
  - Leaflet 인스턴스 재생성 없이 진입/ESC 닫기, 지도 휠 줌.
  - 1440/1024/800/680/390px: 레이아웃 겹침/화면 넘침 없음.
  - 기존 후보 지도: 2560/1440/1280/1024/680/390px 레이아웃 정상.
  - 품질 현황/개선1/개선2 KPI 비교 (10/30): 37,731건 / 26,688건 / MOS 4.11 / 저품질 288건 일치.
  - 브라우저 JS pageerror: 0건.
- 실제 배포 스크린샷: `outputs/quality-improvement-two-deploy/algorithm-live-qa/algorithm-fullscreen-1440.png`, `algorithm-fullscreen-1024.png`, `algorithm-fullscreen-390.png`
- 데이터와 알고리즘 원본 수정 없음. 3001/3014 서버 별도 유지. 이전 3016 빌드는 별도 보존.
