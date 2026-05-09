# Realm Enrichment Tool — SPEC-7
## Final Follow-Up Closures (Post-SPEC 6)

**Status:** Draft for implementation  
**Scope:** Close the two remaining documented follow-ups after SPEC-6 completion  
**Tools:** Cursor / Claude Code (implementation can be split by area)

---

## Overview

SPEC-6 completed the structural refactors and micro-interaction pass. Two targeted follow-ups remain open and are captured in the current docs (`CURRENT_STATE`, `PRODUCT_BRIEF`, and `TECHNICAL_ARCHITECTURE`):

1. Explicit user retry control after repeated bulk polling failures.
2. Final normalization of secondary button styling and micro typography.

SPEC-7 exists to close these last two items with measurable acceptance criteria and limited scope.

---

## Item 7A — Bulk Polling Retry UX Completion

### Current State

- `useBulkJob` tracks `consecutivePollingErrors` and increments on status fetch failures (`!res.ok` and network errors).
- `BulkProgressScreen` escalates messaging:
  - `>= 1` failure: amber "retrying" text.
  - `>= 3` failures: red alert copy.
- There is **no explicit retry control** in the escalated polling-failure path. Current copy tells users to refresh or wait.

### Goal

Provide an explicit, user-triggered retry action in the 3+ consecutive polling failure state so users can re-check status immediately without page refresh.

### Required Behavior

- At `consecutivePollingErrors >= 3`, show an explicit retry action (for example: **Retry Connection** / **Check Status Now**).
- Retry action triggers an immediate status poll and respects existing in-flight guards.
- Retry behavior does **not** mutate, cancel, or restart the server-side job; it only restores client visibility.
- Keep existing cancel/start-over behavior available and clearly distinct.

### Acceptance Criteria

1. **Escalation action exists**
   - In bulk progress UI, when `consecutivePollingErrors >= 3`, a keyboard-focusable retry control is rendered.
2. **Immediate retry execution**
   - Clicking retry performs an immediate status request (no hard refresh required).
3. **In-flight safety**
   - Duplicate rapid clicks do not create overlapping status requests.
4. **Counter lifecycle**
   - `consecutivePollingErrors` resets to `0` on successful poll.
   - Counter is reset when starting a new bulk job and when bulk session is reset/cancelled.
5. **No server-state mutation**
   - Retry action does not call cancel/resume endpoints; it only performs status polling.
6. **Accessible failure UX**
   - Escalation region remains perceivable (alert/status semantics), and retry control is operable via keyboard/screen reader.

### Primary Files Likely Impacted

- `src/hooks/useBulkJob.ts`
- `src/components/BulkProgressScreen.tsx`
- `src/components/EnrichingStep.tsx`
- `src/app/page.tsx` (only if additional prop wiring is needed)

---

## Item 7B — Secondary Button + Micro-Typography Final Normalization

### Current State

- Most screens already use tokenized secondary styles (`--border-default`, `--text-primary`).
- A few screens/components still carry mixed visual systems (token + zinc/gray/hardcoded variants), notably in dense UI surfaces.
- Micro text is mostly normalized, but tiny-label patterns still need a final policy pass.

### Goal

Finish visual-system consistency so secondaries and tiny text follow one clear rule set across remaining hotspots.

### Normalization Rules

1. **Secondary controls (non-destructive)**
   - Use one shared tokenized pattern:
     - `border-(--border-default)`
     - `text-(--text-primary)`
     - agreed neutral background + hover behavior
2. **Destructive controls**
   - Keep distinct red styling; do not merge into secondary pattern.
3. **Micro typography**
   - Use `text-xs` as default for small labels.
   - Use `text-[10px]` only where necessary for dense data UI, with consistency and sparing usage.
4. **No hardcoded brand hex values for core control styles**
   - Prefer CSS token variables (`--realm-*`, `--text-*`, `--border-*`) or established shared class constants.

### Acceptance Criteria

1. **Secondary convergence**
   - Remaining target screens/components use the agreed tokenized secondary style recipe for non-destructive actions.
2. **Typography consistency**
   - Tiny labels in target screens follow the approved scale policy (`text-xs` default; `text-[10px]` only where justified).
3. **Destructive separation**
   - Destructive controls remain visually distinct and are not restyled as neutral secondary.
4. **Dark/light parity**
   - Updated controls remain legible and visually consistent in both themes.
5. **No churn outside scope**
   - Do not reopen already-complete SPEC-6 interaction/motion behavior while normalizing styles.

### Primary Files Likely Impacted

- `src/components/PrePushScreen.tsx`
- `src/components/ReviewTable.tsx`
- `src/components/SuccessScreen.tsx`
- `src/components/PushingStep.tsx`
- `src/components/StarterScreen.tsx`
- `src/components/ReasoningTooltip.tsx`

---

## Validation Checklist

### Functional Validation (7A)

- Simulate repeated polling failures and verify escalation + retry action appears at threshold.
- Verify retry requests status immediately and clears failure state on success.
- Verify no duplicate in-flight polls from rapid retry clicks.
- Verify cancel/start-over behavior remains unchanged.

### Visual Validation (7B)

- Review secondary controls on target screens for token consistency.
- Verify destructive buttons still look destructive.
- Review tiny labels/badges for readability and consistency in light + dark themes.

### Quality Gates

- `npm run lint` passes.
- No new TypeScript errors.
- No regressions in bulk flow completion path and review/push path navigation.

---

## Out of Scope (for SPEC-7)

- Any new pipeline logic or enrichment-source behavior changes.
- Additional animation or motion redesign (SPEC-6 Part B already completed).
- Refactors not directly tied to these two follow-up closures.
- New dependency additions.

---

## Suggested Execution Order

1. Implement Item 7A first (user-facing reliability gap).
2. Implement Item 7B second (final visual consistency pass).
3. Run validation checklist and update state docs to remove these open follow-ups.
