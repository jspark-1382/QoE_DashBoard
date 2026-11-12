# Qwen 고객·통화 분석 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** 승인된 고객 상세 UI에 AI 분석 버튼·탭을 추가하고, 원본 버전에 묶인 통화 근거를 집계한 뒤 .env의 Qwen 서버를 호출해 검증 가능한 한국어 결과를 표시한다.

**Architecture:** 기존 Node 로컬 API와 Vite middleware를 함께 지원하는 서버 전용 분석 서비스. 읽기 전용 SQLite 조회로 수치를 계산하고, 모델에는 제한된 근거 묶음만 전달한다. 비동기 작업 ID·진행 단계·취소·명확한 오류와 고정된 결과 대상을 제공한다.

**Tech Stack:** 기존 React/TypeScript, Node CommonJS, node:sqlite, native fetch/AbortController, node:test. 새 런타임 의존성 없음.

**Spec:** 2026-11-12 대화에서 승인된 고객 상세 AI 분석 이미지 및 로컬 계산+AI 근거 해석 설계. Qwen .env 연결은 사용자의 추가 확정 요구.

## Global Constraints

- 상단 4개 고객 비교 카드와 기존 지도·고객 현황을 보존한다.
- AI 분석 버튼은 고객·통화 상세 왼쪽, 고객 현황/AI 분석 탭은 고객 정보 줄 아래에 배치한다.
- 군집화 알고리즘과 기존 품질 정의를 변경하지 않는다. 원 MOS·보정 QoE·Drop을 구분한다.
- 현재 선택 고객 전체의 동일 날짜·시간 범위를 집계한다. 화면 페이지·상위 N 표본을 전체 집계로 사용하지 않는다.
- BYE 대표 위치를 실제 저하 구간 위치로 단정하지 않는다. 원인·위치의 검증 수준을 표시한다.
- Qwen URL/model/key/timeout/token/temperature/optional JSON or thinking extras는 서버 전용 .env 설정이다. 브라우저에서 직접 Qwen 호출하지 않는다.
- 인증키, 원문 고객 식별자, 전체 원본 덤프를 모델/클라이언트 진단 로그에 내보내지 않는다. 증거 식별자는 앱 내부에서 원본과 연결한다.
- 사용자 기존 변경사항 및 .env.local을 보존하고, 파괴적 초기화·자동 stash·일괄 commit을 하지 않는다.
- UI 버튼 추가만으로 실제 모델 연결을 완료했다고 보고하지 않는다. 실제 서버 값 미제공 시 모의 연결 검증과 실연결 미검증을 구분한다.

## Review Focus

1. 고객/기간 변경 및 동시에 들어온 이전 응답이 다른 대상의 결과에 덮어쓰지 않아야 한다.
2. 누락 MOS·Drop·중복 및 비교 분모가 기존 화면과 일치해야 한다.
3. 설정 누락, 잘못된 모델, 인증/네트워크 오류, timeout, 취소, 빈/잘린/잘못된 모델 응답을 구분해야 한다.
4. 모델이 없는 근거 ID나 새로운 숫자를 만들면 검증 실패/명시적 한계를 표시해야 한다.
5. live local preview와 dev middleware 모두 동일 API를 제공하며 .env 비밀은 번들/응답/오류에 노출되지 않아야 한다.

## Workspace ruling

현재 feature checkout codex/include-additional-mdt-sources에는 144개 선행 변경사항이 있고 승인된 UI도 미커밋 상태다. HEAD 기반 새 worktree는 현 사용 화면과 다른 기준이 되므로 현 작업 폴더에서 범위를 제한하여 수정한다. 기존 대상 파일은 outputs/qwen-analysis-dev/baseline에 저장하고 세션 기준 변경만 검토한다. 재확인 승인 없이 이미 승인된 구현을 계속 수행한다.

## Task 1 — 서버 설정·근거·Qwen 작업 API

- [ ] 기존 API와 데이터 스키마를 읽고 명시적 요청/응답 계약 확정.
- [ ] 설정/정확한 집계/모의 Qwen 성공 및 오류/취소/잘못된 근거에 대한 실패 테스트 작성·실행.
- [ ] 서버 전용 config/provider/evidence/job 모듈과 dev/local API 부착 구현.
- [ ] 같은 테스트 통과 및 기존 voice-query 관련 회귀 검증.
- [ ] .env 입력 항목과 설정 문서 추가; 기존 env 값 보존.

## Task 2 — 고객·통화 분석 UI

- [ ] 승인된 고객 정보 줄의 AI 분석 버튼과 고객 현황/AI 분석 탭 구현.
- [ ] 실제 작업 단계·취소·연결 확인·오류·근거 부족·고정된 분석 대상 표시.
- [ ] 판단/근거/추가확인 및 통화 근거 선택, 이 통화 분석 연결.
- [ ] 고객/기간 변경, 오래된 응답, 실패 후 이전 결과 상태를 검증.

## Task 3 — 통합·배포 가능한 로컬 검증

- [ ] 모의 OpenAI-compatible 서버로 전체 요청 흐름과 노출 금지 항목 검사.
- [ ] 실제 로컬 데이터 읽기 전용 계산을 기존 집계와 대조.
- [ ] 필요한 타입/빌드/영향 테스트 실행.
- [ ] 독립 변경 검토 후 수정; 기존 실행 방식으로 새 UI/API 반영.
- [ ] .env 설정 및 실행 안내와 실연결 검증 여부를 최종 보고.
