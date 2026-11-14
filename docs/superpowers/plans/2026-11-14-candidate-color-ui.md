# Candidate Color UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Apply the approved colored candidate workspace and compact AI popup designs.

**Architecture:** Keep existing React data flow and scoped CSS modules. Independent main-workspace and popup changes share existing evidence types; root owns header/theme and map selection colors. Stage immutable output before switching the existing local server.

**Tech Stack:** React, TypeScript, CSS modules, Leaflet, Vinext, Python Playwright.

**Spec:** ../specs/2026-11-14-candidate-color-ui-design.md

## Global Constraints

- Quality status and customer views remain unchanged.
- Keep RF legends, dates, bands, POT identity, history and analytical values intact.
- Read saved analysis only during browser checks; never start inference for cosmetic QA.
- Preserve the user's preexisting tsconfig.tsbuildinfo modification.
- Leave localhost:3001 running after verified publication.

## Review Focus

- Main selection color must not be confused with RF condition.
- Popup regional hypothesis does not change with selected POT.
- Call relation/date/frequency must remain visible and accurate.
- Conclusions must fit at ordinary desktop sizes, while small/mobile screens remain scrollable.
- Expanded details must remain reachable without clipping or focus theft.

### Task 1: Main workspace palette

- [x] Restore main-only mint/teal/navy styling in page, workspace, model, rail and visibility CSS modules.
- [x] Restore independent selection ring in improvement-candidate-map without changing RF colors.
- [x] Verify focused existing candidate/map tests and scoped styling.

### Task 2: AI popup layout

- [x] Update popup/list/map presentation modules into compact desktop columns and three scoped result blocks.
- [x] Keep long text in existing disclosures; preserve relation badges, metadata and conclusions as visible content.
- [x] Verify point/call source propagation, history, disclosures and responsive behavior.

### Task 3: Integration

- [x] Run type check and appropriate candidate/popup tests.
- [x] Build and stage on local verification port.
- [x] Run browser checks on candidate 23, additional candidate navigation and quality-status baseline.
- [x] Publish validated immutable output to existing address, verify actual address, stop only the temporary stage, and leave server running.

## Verification record

- TypeScript and targeted lint passed; existing main/popup source checks passed.
- Main map/list keyboard, fullscreen, filter, model and mobile checks passed before the isolated popup map-height adjustment.
- Final staged popup checks and actual-server smoke checks passed with no browser errors or analysis-job writes. Candidate 23 retains its regional hypothesis while selecting POT 4 changes the measured band and ratio. Three saved entries switch and restore correctly.
- Quality-status visual properties match their original baseline exactly.
- Final deployed distribution: `outputs/candidate-color-build-1794616776944`; existing address `http://127.0.0.1:3001/qoe/`.
- Legacy candidate 1/3 analyses were not rerun; their AI actions require new jobs. A diagnostic request was blocked before reaching the server, and final acceptance used current saved candidate 23 only.
