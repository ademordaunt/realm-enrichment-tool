# Realm Enrichment Tool — SPEC-9
## Field Trust Rules Visibility, Pre-Push Summary, Upload Column Mapping & Pipeline Reliability

**Status:** Complete
**Scope:** Operator-facing transparency improvements plus pipeline reliability fixes across upload, enrichment, pre-push, and review stages
**Tools:** Cursor / Claude Code

---

## Overview

SPEC-9 addressed a set of usability and reliability gaps that remained after SPEC-7 and SPEC-8. The primary theme is transparency: making it easier for the operator to understand how fields are sourced and written without leaving the app, and giving clearer feedback at every stage of the pipeline. Secondary theme is reliability: preventing timeout failures on large imports and eliminating visual glitches in the enrichment progress UI.

---

## Item 9A — Field Trust Rules In-App Visibility

### Implemented Behavior

- New `FieldTrustRulesModal` component (`src/components/FieldTrustRulesModal.tsx`):
  - Opens a full-screen modal that fetches and renders the field trust rules HTML via iframe.
  - Fetches from `/api/field-trust-rules?listType=companies|contacts`.
  - Handles loading, error, and keyboard dismissal (Escape key).
- New `FieldTrustRulesSubline` component (`src/components/FieldTrustRulesSubline.tsx`):
  - Inline "Field trust rules →" text link that triggers the modal.
  - Rendered in `PrePushScreen` below the enriched data summary.
- New `/api/field-trust-rules` route (`src/app/api/field-trust-rules/route.ts`):
  - Serves the company or contact trust rules HTML document based on `listType` query param.

### Acceptance Criteria (Met)

1. Operator can access field-level trust rules from within the app without opening a separate document.
2. Modal renders the correct rules document for the active list type (companies or contacts).
3. Modal is keyboard-dismissible and accessible.

---

## Item 9B — Pre-Push Read-Only Summary with Write-Rule Tooltips

### Implemented Behavior

- `PrePushScreen` now renders a read-only enriched-data summary table before the push action.
- Each enriched column header carries a write-rule tooltip:
  - "Overwrites existing HubSpot value" — for fast-aging fields (state, employees, etc.)
  - "Fills empty only — existing value preserved" — for stable/curated fields
- Email column has a dedicated `SummaryEmailCell` component handling display of resolved vs. personal email.
- `FieldTrustRulesSubline` is rendered below the summary table as a direct path to the full rules.

### Acceptance Criteria (Met)

1. Operator sees enriched field values before pushing, not just counts.
2. Column headers communicate write behavior inline, reducing ambiguity about what will be overwritten.
3. Consistent with field trust rule definitions in `COMPANYFIELD_TRUST_RULES.html` / `CONTACTFIELD_TRUST_RULES.html`.

---

## Item 9C — Upload Column Mapping Preview

### Implemented Behavior

- `UploadStep` displays a column mapping preview table after file parse: "Your Column → Mapped To".
- Column resolution uses `resolveParsedColumnField` from `src/lib/parsers/column-mapper.ts`.
- Unrecognized columns display "Column not recognized — visible during review, not pushed to HubSpot".
- `src/lib/utils/field-labels.ts` extended with `displayLabelForCanonicalField` for human-readable column names.
- Duplicate "Change File" button removed; layout cleaned up in `UploadStep`.

### Acceptance Criteria (Met)

1. Operator sees exactly which columns were recognized and what they map to before enrichment starts.
2. Unrecognized columns are explicitly flagged rather than silently dropped.

---

## Item 9D — Pipeline Reliability & UX Polish

### Implemented Behavior

**Minimum phase display time:**
- `useEnrichmentPipeline` introduces `MIN_PHASE_DISPLAY_MS = 700` and `waitForMinimumPhaseDisplay()`.
- Each enrichment phase (AI, ZoomInfo/verify, LinkedIn fallback) is shown for at least 700ms in the progress UI, preventing phases from flashing through instantly on fast responses.
- `waitForMinimumPhaseDisplay` is abort-signal-aware, so cancelling a run does not block on the timer.

**Pipeline flash fix:**
- Removed redundant state updates in `useEnrichmentPipeline` that caused a visible flash between pipeline steps.

**pipelineCompleteHold reset between runs:**
- Fixed: `pipelineCompleteHold` was not being reset when starting a new run, causing the hold state to carry over incorrectly.

**Route timeout increases:**
- `src/app/api/enrich/ai/route.ts`: `maxDuration` increased from 9 → 45 seconds.
- `src/app/api/enrich/zoominfo/route.ts`: `maxDuration` increased from 9 → 45 seconds.
- Prevents Vercel function timeout errors on larger imports.

**Pre-push skeleton loading state:**
- New `PrePushSkeleton` component (`src/components/PrePushSkeleton.tsx`): animated pulse skeleton matching the pre-push layout, shown while pre-push data loads instead of a blank screen.

**Pre-Review screen polish:**
- Title case corrected in `PreReviewGate.tsx`.
- Progress bar subline formatting updated in `EnrichmentProgressBars.tsx`.
- Pipeline hold timing adjusted.

### Acceptance Criteria (Met)

1. No phase flashing in the enrichment progress UI on typical runs.
2. AI and ZoomInfo routes no longer time out on imports that previously hit the 9-second limit.
3. Pre-push screen shows a skeleton while loading rather than an empty state.
4. pipelineCompleteHold is correctly reset between successive runs.

---

## Item 9E — Review Table UX Improvements

### Implemented Behavior

- Table column widths and horizontal scroll behavior corrected for overflow cases.
- Scroll-to-row on field edit save: after saving any editable field, the viewport smoothly scrolls to follow the edited row if sorting re-positions it. Implemented via `requestAnimationFrame` + `data-row-id` attribute; no snapshot logic changes.

### Acceptance Criteria (Met)

1. Table horizontal scroll does not clip content on constrained viewports.
2. After a field edit that triggers re-sort, the edited row scrolls into view automatically.

---

## Validation Checklist

- Confirm field trust rules modal opens and renders correct document for both list types.
- Confirm write-rule tooltips in pre-push summary match the trust rules HTML.
- Confirm column mapping table appears after upload and correctly identifies recognized/unrecognized columns.
- Confirm AI and ZoomInfo routes have `maxDuration = 45`.
- Confirm no pipeline flash between phases on a standard run.
- Confirm pre-push skeleton renders while import settings load.
- Confirm edited rows scroll into view after re-sort in the Review & Edit table.

---

## Outcome

SPEC-9 is complete. Operators can now access field-level trust rules directly from the pre-push screen, see a pre-push data summary with inline write-behavior context, and verify column mapping before enrichment starts. Pipeline reliability is improved for larger imports with higher route timeouts, and the enrichment progress UI no longer flashes or holds stale state between runs.
