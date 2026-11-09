# 품질 현황 개선 2안 구현·검증 기록 (2026-11-07)

## 목적
사용자 제공 『음성 체감지표 본부장님 보고』(3쪽)의 즉시 검증·시연 요구를 기존 개선 1안에 대한 **별도 비교 모드**로 반영한다. 정확한 저품질 발생 위치와 원인 확정은 증거 없이는 주장하지 않는다.

## 진입
- `/qoe/?variant=improvement2` (배포 기본 경로 `/` + `basePath=/qoe`)
- 상단 품질 현황 / 개선 1안 / 개선 2안 탭으로 전환. 기간·시간·고객·MOS/Drop·지도/후보·검색 상태 URL 보존.
- 기존 current/개선 1안/기존안 코드를 유지한다. 원본 `data/`, `public/voice-1030.json`, `public/analyst-overview`는 수정하지 않았다.

## 개선 2안 UI
1. 기존 현황 분석: KPI 4개, MOS 분포, 시간대 그래프, 고객 체감, 위치 지도/순위, CSV·통화 상세 유지. 전용 지도 영역 확대.
2. 데이터 수집/활용: 선택한 동일 기간·시간·고객에서 CDR (N) → MOS (M) → MDT 연결 (D) → GNSS (G)/엄격 3-Site (T) → 최종 U=G+T. 각 단계 절대 건수와 분모/비율, 감사 미완료 상태 표시. GNSS와 3-Site는 병렬이며 단순 직렬 퍼널 아님.
3. 개선 후보 분석: 1안의 기존 검토된 Rule-based 후보/지도/도트와 상세를 재사용, 선택 후보별 고객·발견/검증 통화 MOS·SIP 이력 추가. 배경지도의 일반 GNSS/3-Site/BYE와 지역 개선 후보 채택 정책을 구분.
4. 후보 비교: 원본 버전 및 정확한 2026-10-26~30 00:00~23:59 조건에서만 이전 혼합 후보(위치 3 + Cell 2)와 엄격 후보(7곳)를 수치로 비교. 기존 위치 후보의 중심에서 가장 가까운 신규 후보 중심의 구면 거리·순위는 **공간 참고**로만 보여주고 동일 원인 또는 개선 효과로 단정하지 않는다. 기존 Cell 후보는 제외.
5. 현장 검증·로드맵: 음성/실측 MOS·RF, 연구소 SCAN, 강원도 등 저밀도 외곽, 시간 구간 MOS 데이터의 **미검증/미확보** 표시. NQI·WING, 위치 시스템/동의·법적 검토, 비용·기간·서버 부하는 후속 평가로 명시.

## 기준과 한계
- 저품질: 원본 MOS(v5) 1 이상 3 미만.
- DBSCAN 100m는 이웃 거리. 회의에서 언급된 약 1km 반경과 동일한 허용 오차·전체 군집 반경이 아님.
- 3-Site 근사 및 BYE 기지국 좌표는 UE 실제 열화 위치로 단정 금지.
- 10초/30초 MOS 원본, 실제 음성 녹음, 현장 RF/SCAN 비교는 자료 미확보. UI에서 허위 완료로 표시하지 않음.
- 기존 혼합 후보와 엄격 후보는 다른 선정 규칙/입력에 의존한다. 단순 후보 수 변화는 원인 개선 효과나 정확도 상승의 검증이 아님.
- 15개 날짜 범위 후보 요약은 00:00~23:59 조건으로 생성됨. 추가 시간 범위는 미산정 가능; 미산정 표시를 유지.
- 위 개선 2안은 **기존 연구 결과를 시각화하고 검증 항목을 추가**한 것으로, 새로운 원본 측위 정확도 검증, 강원도 현장 시험, 음성 파일 확보, SCAN 비교를 완료한 것은 아니다.

## 변경 파일
- 공통 라우트/탭: `app/page.tsx`, `components/analyst/quality-top-nav.tsx`, `lib/analyst/quality-comparison-state.ts`
- UI 공유/2안 연결: `components/analyst/quality-proposal-four.tsx`, CSS, `components/analyst/quality-improvement-candidate-panel.tsx`, `components/analyst/improvement-candidates.tsx`, CSS
- 신규 2안: `components/analyst/quality-improvement-two.tsx`, `components/analyst/quality-improvement-two.module.css`, `lib/analyst/quality-improvement-two-comparison.ts`
- 테스트: `scripts/tests/quality-improvement-two.test.cjs`, `scripts/tests/quality-improvement-two.browser.cjs`

## 검증 결과
- TypeScript `tsc --noEmit --incremental false`: 통과
- 수정 TSX 및 비교 로직 `oxlint`: 통과
- 품질·후보·지도·탭·비교 및 2안 회귀 테스트: **41/41 통과**
- 브라우저 E2E 검사는 **미완료**. 기존 빌드 dist를 덮어쓰지 않도록 새 개발 서버 3018의 초기 의존성 스캔을 확인했으나 서버가 리스닝에 도달하지 못해 기동을 중단했다. 기존 3001·3014·3016 프리뷰 프로세스와 그 빌드를 교체하지 않았다.
- 비공개 데이터 원본과 현재 시연 사이트는 건드리지 않는다. 별도 실행/빌드 후 `scripts/tests/quality-improvement-two.browser.cjs`로 KPI 일치, 후보 지도·팝업·고객 전환과 1440/680 반응형을 확인해야 한다.

## 다음 검증 항목
1. 별도 검증 빌드 또는 개발 환경에서 실 브라우저 E2E·지도 줌·레이아웃 확인
2. 이전 방식·신규 방식의 후보 중첩/분리 기준 정의 및 개포동 대표 사례 재현
3. 외곽 지역, 현장 음성/RF 및 SCAN 동일 모집단 검증 자료 확보
4. 기존 필터/선택 고객 범위별 데이터 활용률 공인 값 대조
