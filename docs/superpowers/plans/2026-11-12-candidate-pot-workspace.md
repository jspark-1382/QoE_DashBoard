# Candidate POT Investigation Workspace Implementation Plan

> **For agentic workers:** Use the approved spec and implement the independent data, map and UI modules with focused verification. Steps use checkbox syntax.

**Goal:** 승인된 지도/분석 2열 UI를 실제 POT와 기지국 근거로 제공한다.
**Architecture:** 읽기 전용 candidate-context API + 실제 격자 지도 + 검증된 Qwen hypothesis 기반 원인/대상 선택. 다섯 분류는 내부 응답 계약이며 UI는 AI가 실제 선정한 원인만 제공한다. Qwen job 및 실제 요청·응답 inspector 보존.
**Tech Stack:** React 19, TypeScript, Leaflet, CSS modules, Node API.
**Spec:** docs/superpowers/specs/2026-11-12-candidate-pot-workspace.md

## Global Constraints
- 기존 dirty branch에서 이번 소유 파일만 변경한다. 기존 작업을 reset/commit하거나 원본 데이터를 수정하지 않는다. 기존 env 값은 보존하며, 실제 응답 잘림 해결에 필요한 후보 전용 추가 옵션만 아래 ledger대로 추가한다.
- 선택 POT/대역/날짜와 지도·분석의 일치, 미확보 상태 구분, 실제 전송 원문 보존.
- 분석 중에는 배경 지도를 제공하되 임의 원인/대상을 생성하지 않는다. 완료 후 첫 AI 원인·POT·대역 자동 선택. 가짜 기지국·확정 원인·임의 신뢰도 금지.

## Review Focus
- 상위6에 없던 POT 선택 및 후보/날짜 변경 시 이전 응답 혼입.
- 대역 결측, 0 측정, 공간 경계와 이웃 없는 POT.
- CellID 복수 등록을 최근접 하나로 선택하는 오연결.
- inspector가 기존 실제 요청·응답을 보존하는지.
- 1366x768/1920x1080에서 지도 높이, 본문 스크롤, 버튼 접근.

## Tasks
- [x] 1. scripts/candidate-pot-context.cjs + lib/analyst/candidate-pot-context.ts: 전체 POT 및 매칭 상태 API, revision/scope 검증과 의미 있는 테스트.
- [x] 2. components/analyst/candidate-investigation-map.tsx/.module.css: 실제 격자·등록 기지국, 클릭/키보드 선택, 줌/패닝/크기 갱신.
- [x] 3. lib/analyst/candidate-pot-review.ts + components/analyst/candidate-pot-workspace.tsx/.module.css: 5분류/3단계, 동일 날짜·대역 이웃 비교, 근거 접기, 지도 동기화.
- [x] 4. CandidateAiDialog: 승인된 헤더/레이아웃에 workspace 연결, 실제 Qwen inspector와 재시도/취소 보존.
- [x] 5. 타입검사/관련 회귀검사, local build, 실제 페이지 브라우저 시각·상호작용 검증 후 기존 로컬 실행에 반영.

## Decisions and verification ledger
- 사용자 승인 이미지가 설계 기준이며 추가 승인 대기 없이 구현한다.
- 서버에는 실제데이터가 존재하므로 이미지의 예시 기지국을 넣지 않고 연결 상태를 표시한다.
- MDT 직접비교와 Qwen 보고서를 구분해 실제 모델 발화 및 전송자료를 변조하지 않는다.

## Initial UI verification — 2026-11-12 (superseded by selected-AI correction)
- [x] 5분류·좌측 실제 지도·우측 POT별 3단계 UI 통합 완료. 기존 Qwen 입력·응답 검사창과 전체 보고서는 유지하고 전체 보고서는 기본 접기.
- [x] 전체 타입 검사 `npx tsc --noEmit --incremental false` exit 0. 변경 TSX/TS/API/테스트 범위 oxlint exit 0.
- [x] 후보 context/이웃 비교/API/클라이언트/세션/기존 3단계·진단 UI 관련 회귀 60/60 통과.
- [x] `npm run build:local` 최종 성공. 기존 로컬 preview 프로세스만 식별·교체하고 정상 launcher로 3014 및 3001 실행 확인.
- [x] 실제 후보23( spatial-74cf136978399144 ) 84 POT, 38507_77757의 900 11.16%→북쪽 인접 POT 22.73%, 1.8광 4.92% 확인.
- [x] 실제 브라우저에서 5분류/대역/POT/기지국 선택, AI 검사창 System·User·전송 데이터·응답·검증, 닫기·재열기 확인. 런타임·콘솔 오류 0.
- [x] 1920x1080 및 1366x768 캡처 확인. 1366에서 3단계 하단 687.44px ≤ 분석 패널 하단 709.56px. 가로 넘침 없음.
- [x] 독립 검토 반영: 원인별 확인할 POT 분리, 기지국 3가지 연결 관계 범례, 지도 최소 높이 충돌 해소, 키보드 포커스 복구, 선택/비교 POT 이름표 겹침 해소.
- Qwen 검증 범위: 실제 모델 요청 및 System/User 전송 사본 표시. 이번 UI 검증에서는 모델 완료 응답을 기다리지 않았고 테스트 생성 미완료 작업만 취소함.
- 검증 기록: outputs/candidate-pot-workspace-qa.json / outputs/candidate-pot-workspace-build.log.
- 실제 화면 캡처: outputs/candidate-pot-workspace-1920x1080.png / outputs/candidate-pot-workspace-1366x768.png.

## Selected-AI correction — 2026-11-12

**User finding:** 전체 다섯 분류를 수동 선택하는 화면은 AI 결과 화면의 의도와 다르다. 이전 UI는 `reviewPot()` 규칙을 사용했고 실제 Qwen hypothesis를 연결하지 않았다. 이전 'MDT 직접비교' 검증은 AI 원인 선정 검증을 대신하지 못한다.

- [x] Qwen prompt v4에서 `category`를 필수 열거형으로 정의. 근거가 있는 0~3개 원인만 선정하고 모든 분류를 채우지 않도록 한다.
- [x] 서버·클라이언트 양쪽에서 현재 prompt/SOP 버전, 원인 분류, target/evidence/SOP 연결과 대상별 SOP 존재를 검증. 근거 없는 MDT 커버리지 단정 및 이전 응답 재사용 차단.
- [x] `getCandidateSelectedFindings()`를 통해 실제 `supported/possible` hypothesis만 표시. 첫 실제 대상/POT/대역 자동 선택, 1개 결과는 정적 표시, 복수 결과는 해당 결과 사이에서만 이동.
- [x] 우측 1 문제 / 2 원인 / 3 확인·개선은 실제 hypothesis·연결 원본 지표·해당 대상 SOP를 사용. pending/failed/stale/empty 상태에서는 임의 분류 및 규칙 결과를 생성하지 않음.
- [x] 지도에서 AI가 선정하지 않은 배경 POT를 눌러도 선택 원인이 바뀌지 않음. 기지국의 BYE/등록 관계는 참고 근거임을 보존.
- [x] 상위6개 MDT 대상 제한 제거. 후보23은 84/84 POT, 334/334 유효 날짜·대역 조합, 1128 인접 관계를 포함. `38507_77757`의 네 대역 모두 입력에 포함.
- [x] 모델 입력 124,599자. 160,000자 초과 후보는 조용히 누락시키지 않고 명시적 입력 범위 오류 반환. 대규모 후보의 일괄/분할 추론은 이번 변경 범위 아님.
- [x] 최종 관련 회귀140/140, 전체 TypeScript 검사 exit0, 변경 범위 lint exit0, build:local 완료.
- [x] 정상 launcher로 기존 preview만 교체하여 3001 서비스 반영.
- [x] 독립 검토 추가 반영: 1150px 이하 다중 원인 이름 보존, 현재 완료 결과의 무동작 재분석 버튼 제거, 왼쪽 요약도 동일 선정 helper 사용.
- [x] 실제 Qwen 첫 응답 검증에서 발견한 거리 재반올림/RSRP 지표명 생략에 대해 prompt 출력 지시를 보강. 원래 수치·의미 검증은 유지하고 해당 실패를 회귀로 보존. 원본 응답과 attempt1 진단을 변경하지 않음.
- [x] 후보 전용 `QWEN_CANDIDATE_EXTRA_BODY_JSON` 설정·진단·캐시 분리 검증. 확인된 SGLang 연결의 후보 요청에만 `chat_template_kwargs.enable_thinking=false`를 명시하며 미설정 기본값과 고객 요청은 유지한다.
- [x] 최종 실제 Qwen 완료 응답과 UI 원인·POT·대역·SOP·검사창 및 1920/1366 시각 대조.

Verification logs: `outputs/candidate-ai-selected-regression.log`, `outputs/candidate-ai-selected-build.log`.

### Real-model failure diagnosis retained
- Attempt1: 실제 응답148.279초, 입력68,747토큰, 출력3,926(추론2,960). geometry170.529425를170.5로 반올림하고 MDT 지표명 생략하여 원본 수치/의미 검증에서 보류. 원문 변경 없이 prompt지시 보강.
- Attempt2: 실제 모델 `qwen3.8-flash-next`, 입력68,815토큰, 출력4,096 중 추론3,927, `finish_reason=length`. 불완전 JSON을 성공으로 처리하지 않음.
- 읽기 전용 /models 확인 결과 `owned_by:sglang`. 공식 Qwen 모델카드의 non-thinking 요청 형식 확인: https://huggingface.co/Qwen/Qwen3.8-Flash-Next#instruct-or-non-thinking-mode
- 기존 `.env` 값과 출력 토큰 한도는 보존하고 후보 전용 `QWEN_CANDIDATE_EXTRA_BODY_JSON={"chat_template_kwargs":{"enable_thinking":false}}` 한 항목만 추가. 실패 진단은 attempt1/attempt2 사본으로 보존.

## Final verification completed
- 실제 모델 완료 작업 `eb457b49-fb54-4518-8cc6-f064729cf82e`: 응답64.199초, completion1082/4096토큰, reasoning0, finish_reason=stop. 실제요청의 enable_thinking=false 및 모델명 일치 확인.
- AI가 실제 선정한 coverage/equipment 두 결과만 표시. 최초 대상은 `38507_77751 / 900 / EARFCN3743` 자동 선택. 위치 없는 종료 근거는 POT 미연결 상태 유지.
- 실제 browser QA17개 통과, 런타임/콘솔 오류0. 원인/대상 전환·미선정 배경 클릭·원문 inspector까지 대조. 원문 성공 diagnostics 및 completed job 보존.
- 1920→1366 축소 후 선정 POT가 화면 밖으로 나가던 문제를 실제 캡처로 발견해 map resize 이벤트에도 panInside를 연결. 관련 lint/전체 TypeScript 검사 및 최종 build:local exit0.
- 최종 지도 수정은 보존한 실제 완료 job/diagnostics를 변경 없이 재사용하는 별도 browser replay로 검증. 두 해상도 모두 선정 폴리곤 전체와 중심이 map viewport 안에 있음을 수치·육안 확인. replay의 실제 서버 모델 POST0, 원문 파일 hash 변경 없음.
- 최종 서비스3001 반영. 실제 추론 결과와 replay 결과를 분리해 보존: `outputs/candidate-ai-selected-qa.json`, `outputs/candidate-ai-selected-replay-qa.json`. 최종 캡처는 `outputs/candidate-ai-selected-replay-1920x1080.png`, `outputs/candidate-ai-selected-replay-1366x768.png`.

## 재검증 및 오탐 수정 — 2026-11-13 (한국 시간)
- 사용자 재확인 요청으로 신규 실제 분석 수행. 입력에 있는 RSRP 관측 비율을 설명한 `20.52%로 음영 가능성`을 수치 신뢰도로 오인하는 validator 오류 재현.
- 직접 확률 표현과 관측 비율 뒤의 정성적 가설을 구분하도록 후보 validator의 해당 판정만 수정. 원본 수치·대상 의미·지역 불량률 검증 유지. 실제 원문 허용, 허위 확률/신뢰도/혼합 및 역순 표현 거부 회귀 추가.
- 최종 관련 회귀142/142 및 scoped lint 통과. QA는 재사용된 사용자 작업을 취소하지 않도록 소유권 판정 보완.
- 수정 후 신규 live Qwen 작업 `6b738eaa-01b3-44f9-a4a2-9c6e307caa99` 완료: 39.458초, output1192/4096, reasoning0, finish stop, validation passed.
- 실제 선정 coverage/supported(POT38507_77751·900)와 equipment/possible(위치 없는 종료 근거) 두 결과만 표시. 첫 POT 자동선택, 1920/1366 지도 내부 표시, 원인 전환·inspector 포함17개 browser검증 통과. 런타임/콘솔 오류0.
- 최종 증거: `outputs/candidate-ai-selected-rerun-regression.log`, `outputs/candidate-ai-selected-qa.json`, `outputs/candidate-ai-selected-final-live-job.json`, `outputs/candidate-ai-selected-final-live-diagnostics.json`. 앞선 실패 원문과 이전 검증 결과는 별도 보존.
