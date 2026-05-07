# Realm Enrichment Tool — SPEC-4

**Status:** Implemented
**Scope:** UI polish pass — navigation clarity, progress transparency, event context improvements, pre-review card

---

## Overview

SPEC-4 was a focused UI polish pass. No pipeline logic changes. All six scoped items were shipped and are now baseline behavior for the wizard UI.

---

## Item 1 — Back Button & Navigation Cleanup

### Current state (audit findings)

The wizard has 12 backward-navigation controls across 8 files. The labels and behaviors are inconsistent:

| Step | Current label | Current behavior |
|---|---|---|
| Review & Edit (`enriched`) | `← Back to Pre-Review` | `setStep("prereview")` — state preserved |
| Pre-Review (`prereview`) | `← Start Over` | `resetToUpload(true)` — full reset |
| Upload (`upload`) | `← Back` | `setStep("starter")` — state preserved |
| Upload — bulk small-list warning | `Go Back to Start` | `resetToUpload(false)` — full reset, no session clear |
| Event Context (`context`) | `← Back` | `setStep("upload")` — preserves context inputs |
| Cost Estimate (`costestimate`) | `← Back` | `backFromCostEstimate()` — aborts in-flight enrichment, returns to context |
| Pre-Push / Import Settings (`prepush`) | `← Back to Review` | `setStep("enriched")` — state preserved |
| Bulk progress — running | `Cancel Import` | `cancelBulkJob()` → `resetToUpload(true)` — full reset |
| Bulk progress — failed | `Start Over` | `cancelBulkJob()` → `resetToUpload(true)` — full reset |
| Bulk progress — cancelled | `Start Over` | `cancelBulkJob()` → `resetToUpload(true)` — full reset |
| Complete (`complete`) | `Start New Import` | `resetToUpload(true)` — full reset |
| EventContextForm internal | `← Back to Upload` | **Not currently wired** — `onBackToUpload` prop undefined in parent |

### Problems

1. **"Start Over" appears mid-flow on Pre-Review** — the user has just finished enrichment, not made an error. "Start Over" implies failure. It is logically the same as a Back button (returns to a previous step) but destroys all enrichment work without warning.
2. **Inconsistent labels for the same action** — `← Back`, `← Back to Pre-Review`, `← Back to Review`, `Go Back to Start` all describe backward navigation but with different specificity and format.
3. **The unwired EventContextForm back button** — a Back button exists inside `EventContextForm.tsx` but is never passed a handler from the parent, so it silently does nothing. This is a latent bug.
4. **"Cancel Import" during bulk run is a reset, not a pause** — the label implies reversibility; the behavior is full reset.

### Proposed changes

**Principle:** Labels should describe *where you go*, not what you're doing. Destructive actions (full reset) should be labeled to signal that clearly and separated visually from simple back navigation.

#### Label changes

| Location | Old label | New label | Behavior change? |
|---|---|---|---|
| Pre-Review | `← Start Over` | `← Back to Upload` | No — same `resetToUpload(true)`. Label now accurately describes the destination and implies data loss. |
| Upload — bulk small-list warning | `Go Back to Start` | `← Back` | No — navigates to starter. |
| Bulk progress — running | `Cancel Import` | `Cancel & Start Over` | No — same full reset. Label now signals destructive consequence. |
| Bulk progress — failed | `Start Over` | `Start Over` | No change needed — in a failed state, this is accurate. |
| Bulk progress — cancelled | `Start Over` | `Start Over` | No change needed. |
| Complete | `Start New Import` | `Start New Import` | No change needed — this is a forward action, not navigation. |
| EventContextForm internal | `← Back to Upload` | Wire it up | Yes — connect `onBackToUpload` prop in `page.tsx` to `setStep("upload")`. |

All other labels (`← Back to Pre-Review`, `← Back`, `← Back to Review`) are correct and require no changes.

#### Confirmation on destructive navigation

Add a confirmation step before any action that calls `resetToUpload(true)` when enrichment data exists (i.e., `enrichedRows.length > 0`). A simple browser `confirm()` dialog is sufficient for now:

> "This will discard your enrichment results and return to the start. Continue?"

Apply this guard to:
- Pre-Review `← Back to Upload` button
- Bulk progress `Cancel & Start Over` button

Do **not** apply to:
- `Start New Import` on the Complete screen — the push is done, destruction is expected.
- Bulk failed/cancelled `Start Over` — there is nothing to preserve.

#### Wire the dormant back button

In `src/app/page.tsx`, where `EventContextForm` is rendered (lines 2715–2725), pass `onBackToUpload={() => setStep("upload")}` as a prop. No changes needed to `EventContextForm.tsx` itself.

---

## Item 2 — Vertically Stacked Progress Bars

### Current state

**Event mode:** Single progress bar + status text. The bar reflects only the current phase with no indication of what phases remain or have completed.

**Bulk mode:** `BulkProgressScreen` shows phase icons (`✅ / ⏳ / ⬜`) plus a single percentage bar. Phases are shown as a list but the progress bar is not per-phase.

### Goal

Replace both progress displays with a vertically stacked layout — one labeled bar per pipeline phase. Each bar shows:
- Phase name
- Status icon: complete ✅ / active (animated fill) / waiting (empty, de-emphasized)
- For the active phase: live progress as a percentage fill
- For completed phases: bar filled to 100%, muted color
- For waiting phases: bar empty, label de-emphasized

### Event Mode phases (4 bars)

Event mode has 4 phases in order. Each bar should reflect this sequence:

1. **AI Analysis** — batched AI identity resolution
2. **ZoomInfo & Common Room** — verify + Common Room enrichment (contacts only; for companies, label as "ZoomInfo Verify")
3. **HubSpot Check** — pre-check against existing CRM records
4. **LinkedIn Search** — fallback URL search for rows missing LinkedIn

Progress data for each bar:

| Phase | Data source | Progress signal |
|---|---|---|
| AI Analysis | `progress.startRow / progress.totalRows` in `page.tsx` | Row count |
| ZoomInfo & Common Room | `progress.endRow / progress.totalRows` + `verifyDetail` | Row count + detail text |
| HubSpot Check | Runs at end of verify phase — show as instant complete after ZoomInfo bar finishes | No sub-progress needed |
| LinkedIn Search | Row count of LinkedIn-missing rows processed | Row count |

**Implementation note:** HubSpot pre-check in event mode runs server-side at the tail of the ZoomInfo route and does not report its own progress to the client. Transition the HubSpot bar to complete automatically when the ZoomInfo bar reaches 100%.

### Bulk Mode phases (4 bars)

Bulk mode has 4 phases. These map cleanly to `jobState.currentPhase` and the existing boolean flags:

1. **AI Analysis** — `jobState.aiComplete`, `jobState.currentPhase === "ai"`
2. **ZoomInfo Enrichment** — `jobState.zoomInfoComplete`, `jobState.currentPhase === "zoominfo"` (note: no Common Room in bulk mode)
3. **HubSpot Check** — `jobState.precheckComplete` (runs at end of zoom phase — same instant-complete pattern as event mode)
4. **LinkedIn Search** — `jobState.linkedInComplete`, `jobState.currentPhase === "linkedin"`

Overall percentage bar (`processedRows / totalRows`) can be retained above the phase bars as a summary indicator.

### Visual spec

```
┌─────────────────────────────────────────────┐
│  Enriching 47 records…                       │
│                                             │
│  ✅  AI Analysis              ████████████  │
│  ⏳  ZoomInfo & Common Room   ██████░░░░░░  43% │
│  ○   HubSpot Check            ░░░░░░░░░░░░  │
│  ○   LinkedIn Search          ░░░░░░░░░░░░  │
└─────────────────────────────────────────────┘
```

- Completed phase bars: filled, green-tinted, `✅` icon
- Active phase bar: partially filled, brand color (purple), animated pulse on the leading edge, `⏳` icon
- Waiting phase bars: empty, gray, `○` icon, label at 50% opacity
- Phase detail text (e.g. "ZoomInfo enriching 22 of 47…") appears as small subtitle under the active bar only

### Components affected

- **Event mode:** Replace the inline AI progress block (`page.tsx` lines 2740–2771) and `EnrichmentProgress` (`EnrichmentProgress.tsx`) with a new `<EnrichmentProgressBars>` component
- **Bulk mode:** Replace the phase list section in `BulkProgressScreen.tsx` (lines 243–271) with the same `<EnrichmentProgressBars>` component, fed from `jobState` props

The two modes pass different prop shapes, so `EnrichmentProgressBars` should accept a normalized `phases: Phase[]` array where each phase has `{ label, status: "complete" | "active" | "waiting", progress?: number, detail?: string }`. The parent component (page.tsx for event, BulkProgressScreen for bulk) is responsible for mapping mode-specific state to this shape.

---

## Item 3 — "Sign Out" Title Case

### Current state

Unknown — audit did not surface the exact label or file. Assumed to be `sign out` or `Sign out` somewhere in the header or auth UI.

### Change

Capitalize to `Sign Out` (title case). Find all instances in the codebase and update.

**Cursor prompt to locate:**
```
Search the codebase for every instance of "sign out" or "signout" 
(case-insensitive) in JSX/TSX files. List the file, line number, 
and exact string for each match.
```

---

## Item 4 — Pre-Review Enrichment Summary Card

### Current state (audit findings)

Card renders in `PreReviewGate.tsx` lines 159–173. Six stats shown:
- Records processed
- Found in HubSpot
- ZoomInfo credits used
- LinkedIn URLs found from AI
- Common Room matches (conditional — only when `commonRoomFound > 0`)
- Total time

A bare `<hr>` sits at line 172 unconditionally at the bottom of the card, with no content below it inside the card boundary. It appears as a floating line with no purpose.

### Changes

#### 1. Remove the orphaned `<hr>`

Delete line 172 in `PreReviewGate.tsx`. No replacement.

#### 2. Group stats with faint dividers

Reorganize the six stats into three groups separated by faint horizontal rules (`border-t border-gray-100` or equivalent in your Tailwind setup, not an `<hr>`):

**Group 1 — Records**
- Records processed
- Found in HubSpot
- Common Room matches *(conditional — show only when > 0)*

**Group 2 — Enrichment signals**
- ZoomInfo credits used
- LinkedIn URLs found from AI

**Group 3 — Run metadata**
- Total time

Each group should have a small amount of vertical padding above and below. The dividers between groups should be visually subtle — lighter than the card border, not a full-weight line.

#### Visual sketch

```
┌─────────────────────────────────┐
│  Enrichment Complete ✓           │
│                                 │
│  Records processed    47        │
│  Found in HubSpot     12        │
│  Common Room matches   3        │
│  · · · · · · · · · · · · · · · │
│  ZoomInfo credits used  31      │
│  LinkedIn URLs from AI   8      │
│  · · · · · · · · · · · · · · · │
│  Total time            4.2 min  │
└─────────────────────────────────┘
```

#### No new props needed

All six stats already exist on the `enrichmentSummary` prop. This is a rendering-only change to `PreReviewGate.tsx`.

---

## Item 5 — Date Field Made Optional (Event Mode)

### Current state (audit findings)

In `EventContextForm.tsx`:
- Month select: `required={importMode === "event"}` (line 645)
- Year select: `required={importMode === "event"}` (line 670)
- Submit guard: `if (!monthYearForPrompt.trim()) return;` (lines 573–576)

Date is required in event mode and blocks submission if empty.

### Downstream impact (confirmed safe to make optional)

- Date is used as AI prompt context only — its absence is handled gracefully. If region is empty, the AI prompt already switches to a "virtual/national" framing. The same pattern applies to date: the prompt can omit date context without breaking enrichment.
- Date does not affect confidence bucket logic.
- Date does not gate any HubSpot push fields.

### Changes

**In `EventContextForm.tsx`:**
1. Remove `required={importMode === "event"}` from month select (line 645)
2. Remove `required={importMode === "event"}` from year select (line 670)
3. Remove the `if (!monthYearForPrompt.trim()) return;` submit guard (lines 573–576)
4. Update placeholder/label text to signal optional status (e.g. add `(optional)` to the field label)

**In `ai-enricher.ts`:**
5. Add a null/empty guard for `monthYearForPrompt` in the prompt construction block. If date is absent, omit the date sentence from the prompt rather than inserting a blank.

**No changes needed to:**
- Bulk mode (date already optional there)
- Pipeline logic, bucket logic, or HubSpot push

---

## Item 6 — State/Region Picker Redesign

### Current state (audit findings)

The picker in `EventContextForm.tsx` is a multi-stage custom control:

1. **Root select** — 4 options: `No specific state/region`, `Select state/region` (placeholder), `Select a State →`, `Select a Region →`
2. **State sub-picker** — appears when user selects "State" path. Shows 51 options (50 states + DC). No search.
3. **Region sub-picker** — appears when user selects "Region" path. Shows 7 macro-regions.
4. **Non-US text input** — separate free-text field that disables the dropdowns when filled.

This is confusing because: the root select contains navigation items masquerading as data options, the state/region/non-US split requires multiple interactions to make a simple selection, and there is no way to type-filter 51 states.

### Changes

#### 1. Remove Non-US option entirely

Per operator decision: every event is either in a US state, a US region, or has no specific location. Non-US entries no longer occur. Remove:
- The `nonUsRegion` state variable
- The Non-US text input and its label
- All `disabled={... || nonUsRegion.trim().length > 0}` guards
- The `effectiveRegion = nonUsRegion.trim() || region.trim()` logic — simplify to `effectiveRegion = region.trim()`

#### 2. Replace multi-stage picker with a single searchable combobox

Replace the root select + sub-pickers with one unified combobox control that:

- Shows a text input with placeholder `Search states or regions…`
- When focused (or empty), displays a flat, scrollable list of all options
- As the user types, filters the list in real time (case-insensitive substring match on option label)
- Options are organized in two labeled sections within the dropdown: **States** (51 options) and **Regions** (7 macro-regions)
- When a value is selected, the input displays the selection and the dropdown closes
- A clear/reset button (`×`) appears when a value is selected, returning the field to empty
- Keyboard navigable (arrow keys, Enter to select, Escape to close)

**Option list:**

States section (existing `US_STATE_OPTIONS`, 50 states + DC):
Alabama, Alaska, Arizona, Arkansas, California, Colorado, Connecticut, Delaware, DC, Florida, Georgia, Hawaii, Idaho, Illinois, Indiana, Iowa, Kansas, Kentucky, Louisiana, Maine, Maryland, Massachusetts, Michigan, Minnesota, Mississippi, Missouri, Montana, Nebraska, Nevada, New Hampshire, New Jersey, New Mexico, New York, North Carolina, North Dakota, Ohio, Oklahoma, Oregon, Pennsylvania, Rhode Island, South Carolina, South Dakota, Tennessee, Texas, Utah, Vermont, Virginia, Washington, West Virginia, Wisconsin, Wyoming

Regions section (existing macro-regions):
Northeast, Mid-Atlantic, Southeast, Midwest, Southwest, Mountain West, Pacific West

#### 3. Handle "No specific state/region"

Remove `No specific state/region` as a dropdown option. Instead:
- Leave the field blank = no specific state/region (the field is optional — see Item 5 above which also applies to this field)
- The existing `noStateRegionSelected` logic should resolve to `true` when `region` is empty string

The placeholder text `Search states or regions…` communicates that the field is optional-by-omission. No explicit "none" option needed.

#### 4. Remove placeholder options that were navigation artifacts

The current root select has `Select state/region` and `Select a State →` / `Select a Region →` as options. These were navigation shims for the multi-stage design. They are eliminated entirely in the new single-input design.

#### 5. State variable changes

- `locationView` state variable — **remove** (no longer needed; the multi-stage view concept is gone)
- `nonUsRegion` state variable — **remove** (see above)
- `region` state variable — **retain**, now directly set by combobox selection
- `noStateRegionSelected` — **retain**, derived as `region.trim() === ""`

#### Implementation note

Use a lightweight headless combobox pattern. If the project already has a UI library with a combobox (e.g. Headless UI, Radix), use that. If not, a small custom implementation is fine — the interaction model is simple enough (controlled input + filtered dropdown list + keyboard nav).

Do not use a native `<select>` — native selects do not support type-filtering.

---

## Affected files summary

| File | Items |
|---|---|
| `src/app/page.tsx` | Item 1 (back buttons, wire EventContextForm prop) |
| `src/components/EventContextForm.tsx` | Items 1, 5, 6 |
| `src/components/PreReviewGate.tsx` | Item 4 |
| `src/components/EnrichmentProgress.tsx` | Item 2 (replace or heavily modify) |
| `src/components/BulkProgressScreen.tsx` | Item 2 (replace phase list section) |
| `src/components/CostEstimateScreen.tsx` | Item 1 (back button — no label change needed) |
| `src/components/PrePushScreen.tsx` | Item 1 (back button — no label change needed) |
| `src/components/SuccessScreen.tsx` | Item 1 (no label change needed) |
| `src/lib/enrichment/ai-enricher.ts` | Item 5 (null guard for date in prompt) |
| New: `src/components/EnrichmentProgressBars.tsx` | Item 2 |
| Auth/header UI file (TBD from Cursor search) | Item 3 |

---

## Sequencing recommendation

These items are independent. Suggested order for Claude Code:

1. **Item 3** — Sign Out title case. Trivial. Confirms Claude Code tooling works on this codebase.
2. **Item 4** — Pre-Review card. Self-contained single file, visual-only.
3. **Item 1** — Back button cleanup. Low risk, high clarity payoff.
4. **Item 5** — Date optional. Small change, confirm prompt behavior with a test run.
5. **Item 6** — State/region picker. Largest UI component change; do after simpler items are confirmed working.
6. **Item 2** — Progress bars. Requires new component and integration into two different display paths; do last.