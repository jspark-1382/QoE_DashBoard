# Candidate Three-stage Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans task by task.

**Goal:** 사용자가 문제·원인·개선 조치를 세 단계 안에서 읽고 각 가설에 연결된 행동과 검증을 확인한다.

**Architecture:** 서버 SOP에 조건부 개선과 검증 항목을 구조화하고, 모델 가설은 검증된 sopIds로 연결한다. UI는 하나의 연속 화면에 1 문제 요약, 2 원인 분석, 3 원인별 개선 조치·SOP만 기본 노출한다. 상세 근거·기술 설정은 단계 안에 접는다.

**Tech Stack:** Existing React/TypeScript/CSS modules, Node CJS, Qwen OpenAI-compatible API.

**Spec:** Current user request and screenshots, 2026-11-12: 너무 복잡하고 원인 가설별 개선 조치 연결이 보이지 않음; 딱 세 단계 안에서 표시.

## Global Constraints

- Existing uncommitted candidate feature is the baseline; no resets, bulk commits or source-data rebuild.
- .env and existing customer analysis/clustering policies remain intact.
- Facts and conditional improvements remain distinct; no invented measurements or equipment parameter values.
- Exactly three primary content sections; evidence retained in disclosures and human-readable links.
- Current source baseline preserved in outputs/candidate-three-stage-dev/baseline.

## Interfaces

CandidateAnalysisReport.hypotheses gains sopIds:string[] (one or two selected template IDs; no duplicate, absent, or unselected IDs).
CandidateSopTemplate gains targetKind:'radio'|'rtp'|'drop'|'members', checkNow:string[], conditionalActions:{when:string;action:string}[], verifyAfter:string[].
Server-owned templates provide these fields. Model only explains relevance and selects allowed links.
Prompt version candidate-prompt-v2 (both client and evidence); SOP version candidate-sop-draft-v2.
Report.sop explains exactly the union of referenced SOP IDs, ordered by server template order; unreferenced common templates retain server reasons.
Export isCurrentCandidateAnalysisJob(job) for current version and valid linkage; old completed cache cannot block reanalysis.

## Review Focus

- Wrong or absent SOP references and old result cache.
- Missing radio/RTP or Drop zero must not invent a matching observed cause.
- Conditional actions must say when they apply and include post-change checks.
- Hidden evidence focus, fullscreen Escape/Tab, target and map state preservation.
- Small-screen readability and duplication of limitations.

## Task 1 — Contract and executable procedure content

Files: scripts/qwen-candidate-{client,evidence,sop}.cjs; lib/analyst/candidate-ai-analysis.ts; scripts/tests/qwen-candidate-*.test.cjs and fixture as required.

- [ ] Add failing tests for explicit hypothesis-to-SOP references, unselected/empty/duplicate links, deterministic procedure fields, and legacy completed cache refresh.
- [ ] Add concrete server-owned radio/RTP/SIP check-now, conditional improvement, verification content; common procedures remain available folded.
- [ ] Update prompt/validator/type and versions, keeping numeric and interpretation guards.
- [ ] Update session cache validity and meaningful fixtures; run candidate suite.

## Task 2 — Three-stage UI

Files: components/analyst/candidate-ai-analysis.tsx and .module.css; optional focused display helper/test if useful.

- [ ] Keep existing dialog lifecycle/target behavior. Replace three content tabs with three numbered sections.
- [ ] Stage 1: server metrics plus a short problem sentence; settings/limitations collapsed.
- [ ] Stage 2: up to three compact hypothesis rows with evidence sentence and state; human-readable evidence disclosure and action jump.
- [ ] Stage 3: one card per same hypothesis, showing actual target scope, check now, conditional improvement, post-change verification via sopIds.
- [ ] Preserve all underlying evidence tables/links in disclosures inside the three stages. No visible E-code repetition or raw algorithm parameter list by default.
- [ ] Explicit old-report refresh state; busy/failure remain honest.

## Task 3 — Integration and real verification

- [ ] Scoped candidate/customer suites, TypeScript and lint; build local without data:all.
- [ ] Restart only verified project preview; preserve 3001 forwarder.
- [ ] One real Qwen candidate with radio/RTP/Drop when available, verify valid hypothesis action links and actual three-stage DOM.
- [ ] Check normal and fullscreen UI, evidence disclosures, closing restores target/map; capture actual results.
- [ ] Independent review of changes and final report; record remaining limits.

## Rulings

Current feature checkout contains the user's new untracked candidate implementation. Use scoped baselines and disjoint file ownership; do not move or replace their checkout. User explicitly requested the three-stage correction, so no repeated design approval gate. No commits until separately appropriate; preserve unrelated work.
