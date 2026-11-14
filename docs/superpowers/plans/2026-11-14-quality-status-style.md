# Quality Status Style Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement the independent presentation tasks.

**Goal:** Apply the approved colored quality-status mockup while preserving source data and interactions.

**Architecture:** Scope new CSS modules to the server quality page's current mode. Reuse the approved white header and aligned toolbar. Keep all calculations, chart paths, map data, queries and handlers.

**Tech Stack:** React, TypeScript, CSS modules, Leaflet, Vinext, Playwright.

**Spec:** Approved chat image `exec-b7c1c0dc-99d9-43c7-9df8-4ceaec5d35bc.png` and user's instruction to preserve colors/functions and leave the existing server running.

## Global Constraints

- Preserve all source figures, denominators, tooltip explanations and semantic colors.
- Restrict body styles to `[data-quality-view="current"]`; preserve candidate, AI popup, customer and selected-call dialog styles.
- Do not start AI jobs or change stored analyses during validation.
- Preserve the preexisting tsconfig.tsbuildinfo and previous uncommitted UI changes.
- Stage before switching the existing localhost:3001 server; leave that server running.

## Review Focus

- KPI long totals fit mobile without horizontal overflow.
- Charts retain their grade/hour/cohort actions and distinct colors.
- Region ranking includes BYE references and must not imply map-only counts or area-wide failure rates.
- Map fullscreen and source/evidence controls remain usable after spacing changes.
- Call table retains its filters, search, pagination and native call-detail dialog.

### Task 1: Cards and charts

- [x] Add scoped quality-status panel classes and compact white-card styling to KPI/donut/hourly/customer components.
- [x] Preserve original data/colors/handlers; run focused summary tests.

### Task 2: Page, map and ranking

- [x] Apply white shared chrome to current quality mode and add current-only layout classes.
- [x] Style the map, align ranking columns, retain source footnotes in disclosures, and add the compact call-table toggle.
- [x] Review source semantics and run type/focused tests.

### Task 3: Verification and publication

- [x] Compare baseline values/colors and improvement styles, then verify actual responsive controls on a staged build.
- [x] Publish the validated immutable build and verify the existing address.
- [x] Stop only temporary staging and leave the existing UI server running.

## Verification record

- TypeScript, targeted lint and 35 existing panel/map/customer tests passed.
- Original full-period and one-day summary objects, KPI denominators and semantic colors match the baseline exactly.
- Initial functional QA passed 16 checks; final focused checks corrected mobile map/table clipping and preserved fullscreen backdrop.
- Final live smoke checks passed without browser errors or analysis-job mutations. Improvement workspace styles and geometry remain unchanged.
- Live assets match `outputs/quality-style-build-1794620318591`; the existing localhost:3001 server remains running.
- Detailed evidence is in `outputs/quality-style-release/`.
