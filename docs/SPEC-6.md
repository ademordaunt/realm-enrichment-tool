# Realm Enrichment Tool — SPEC-6
## Larger Refactors + Micro-Interactions

**Status:** Draft for operator review
**Scope:** Structural refactors that need care + full micro-interaction/delight pass
**Tools:** Claude Code (categories 1–5 items) + Cursor (category 6 micro-interactions)
**Prerequisite:** SPEC-5 core flow is complete; remaining SPEC-5 blockers should be closed before SPEC-6 polish/release sign-off

---

## Overview

SPEC-6 has two distinct halves. The first half is the structural refactor work deferred from SPEC-5 — worthwhile but carrying more risk than the clean wins. The second half is the full micro-interaction and delight pass, handled separately in Cursor.

### Preflight before executing SPEC-6

- Sanitize the remaining client-visible raw error paths in `src/app/api/enrich/ai/route.ts` and `src/app/api/enrich/zoominfo/route.ts`.
- Add an explicit retry control for repeated bulk polling failures (3+ consecutive failures path).
- Finish final secondary-button and tiny-typography consistency cleanup so micro-interaction polish does not churn baseline styles.

---

# Part A — Structural Refactors (Claude Code)

---

## A1 — Break up `Home` in `page.tsx`

**Finding:** `Home` is ~2,120 lines. It is a single React component doing wizard orchestration, all enrichment logic, all HubSpot push logic, all session management, all bulk job management, and all rendering for every wizard step. This is the single biggest maintainability risk in the codebase.

**Why deferred from SPEC-5:** Splitting `Home` is high-value but high-risk. A wrong split can break state sharing, event handler references, or session persistence. Needs careful planning.

**Approach:**

Split into three layers:

**Layer 1 — Hooks (extract logic out of the component)**
- `useEnrichmentPipeline()` — encapsulates `runEnrichment`, `runZoomVerify`, `runLinkedInLookupPass`, `runHubSpotPreCheck`, and all related state (`progress`, `enrichError`, `enrichedRows`, etc.)
- `useBulkJob()` — encapsulates `startBulkJob`, `cancelBulkJob`, `startJobPolling`, `handleContinueToReview`, and all bulk job state
- `useWizardSession()` — encapsulates session storage read/write, `resetToUpload`, `startNewImport`
- `useHubSpotPush()` — encapsulates `pushToHubSpot`, `consumePushNdjson`, push result state

**Layer 2 — Step render components (extract JSX out of the component)**
Each wizard step's JSX block becomes its own component:
- `<UploadStep />` — upload dropzone + parse result
- `<EnrichingStep />` — progress bars + cancel
- `<PushingStep />` — push progress display

The larger screens (`ReviewTable`, `PrePushScreen`, etc.) are already separate components and don't need extraction.

**Layer 3 — `Home` becomes an orchestrator**
After extraction, `Home` should be ~200–300 lines: hook calls, step routing, and rendering the appropriate step component or screen component.

**Constraint:** Do not split state that is shared across steps into separate components that would require prop-drilling or context. Hooks are the right abstraction here — keep shared state in `Home` and pass it down.

**Sequencing within this item:**
1. Extract hooks one at a time, verify behavior after each
2. Extract step render components
3. Verify full wizard flow end-to-end after each extraction

---

## A2 — Code-split step screen components

**Finding:** All major step screens are statically imported into `page.tsx`, bundling them all on initial page load even though only one is shown at a time. `ReviewTable` alone is ~1,562 lines.

**Why deferred from SPEC-5:** Code-splitting requires verifying that dynamic imports don't introduce loading flicker or hydration issues. Needs testing after implementation.

**Fix:** Convert heavy step-specific components to dynamic imports using Next.js `dynamic()`:

```typescript
import dynamic from "next/dynamic";

const ReviewTable = dynamic(() =>
  import("@/components/ReviewTable").then(m => ({ default: m.ReviewTable })),
  { loading: () => <div className="animate-pulse">Loading...</div> }
);

const PrePushScreen = dynamic(() => import("@/components/PrePushScreen").then(...));
const EventContextForm = dynamic(() => import("@/components/EventContextForm").then(...));
const PreReviewGate = dynamic(() => import("@/components/PreReviewGate").then(...));
const BulkProgressScreen = dynamic(() => import("@/components/BulkProgressScreen").then(...));
```

**Components to convert:**
- `ReviewTable` (~1,562 lines) — highest priority
- `PrePushScreen` (~814 lines)
- `EventContextForm` (~541 lines)
- `PreReviewGate` (~330 lines)
- `BulkProgressScreen` (~289 lines)

**Components to leave as static imports:**
- `StarterScreen` — shown on first load, must be immediate
- `EnrichmentProgressBars` — shown early in flow
- `SuccessScreen` — small, not worth splitting

**After implementing:** verify that no step shows a loading flash that feels jarring. The `loading` fallback should be invisible or near-invisible for users on a normal connection.

---

## A3 — Refactor `handleHubSpotPushRequest` in `push-handler.ts`

**Finding:** `handleHubSpotPushRequest` is ~370 lines and handles company deduplication, contact deduplication, batch create, batch update, fallback matching, association writing, list creation, and NDJSON streaming — all in one function.

**Why deferred from SPEC-5:** Push logic is the highest-stakes code in the app. Wrong refactoring here causes duplicate HubSpot records or lost data.

**Approach:** Extract sub-functions rather than splitting the main function's control flow:

- `deduplicateAndMatchCompanies(rows, existingIds)` — the company dedup + domain matching block
- `deduplicateAndMatchContacts(rows, existingIds)` — the contact dedup + email + name matching block
- `buildPushExtras(row, settings)` — the per-row lead source / membership notes assembly

The main function retains overall orchestration but delegates to these extracted helpers. No behavioral change.

**Constraint:** Do not change the NDJSON event sequence or the order of create/update/associate operations. HubSpot state depends on this order.

---

## A4 — Batch manual edits hydration

**Finding:** `advanceToReview` fetches manual edits with one GET request per stable key (`Promise.all` of N requests). For a 100-row list this is 100 parallel HTTP requests to the same internal API.

**Why deferred from SPEC-5:** Requires a new API endpoint shape. Low urgency at current scale but will become noticeable as lists grow.

**Fix:** Add a batch endpoint `POST /api/manual-edits/batch` that accepts `{ keys: string[], listType: string }` and returns `{ edits: Record<stableKey, EditMap> }` in one response. Update `advanceToReview` to use the batch endpoint instead of the parallel individual requests.

Retain the existing single-key GET endpoint for the `ReviewTable` cell-level save path — that still makes one request at a time and should stay as-is.

---

## A5 — Add runtime validation on bulk row payloads

**Finding:** Rows loaded from KV cache in the bulk job flow are cast directly to typed arrays without runtime shape validation. A malformed KV entry can crash the review initialization path with an unhelpful error.

**Why deferred from SPEC-5:** Requires designing a validation schema, which risks being overly restrictive if done wrong.

**Fix:** Add a lightweight `isValidEnrichedCompany(row: unknown)` and `isValidEnrichedContact(row: unknown)` type guard that checks for the minimum required fields (`id`, `resolvedName` or `firstName`/`lastName`, `reviewBucket`). Use these guards when loading rows from KV. Rows that fail validation should be logged and skipped rather than crashing the whole load.

This is a defensive floor, not a strict schema validator. Err on the side of permissive — only reject rows that would definitely crash downstream.

---

# Part B — Micro-Interactions & Delight (Cursor)

---

## B1 — Install Framer Motion

Add `framer-motion` as a dependency. This is the only new dependency introduced in SPEC-6.

```bash
npm install framer-motion
```

Verify it does not conflict with existing React 19 / Next.js 16 setup before proceeding with any animation work.

---

## B2 — Wizard step transitions

**Current state:** All wizard step transitions are instant — React mounts/unmounts each step with no animation.

**Goal:** Smooth fade + subtle upward slide when entering a new step. Clean fade-out when leaving.

**Implementation:**

Wrap each step's content in a Framer Motion `<AnimatePresence>` + `<motion.div>`:

```tsx
<AnimatePresence mode="wait">
  <motion.div
    key={step}
    initial={{ opacity: 0, y: 8 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: -8 }}
    transition={{ duration: 0.18, ease: "easeOut" }}
  >
    {/* step content */}
  </motion.div>
</AnimatePresence>
```

**Design notes:**
- Keep the motion subtle — 8px translate, 180ms duration. This is a productivity tool, not a marketing site. Motion should feel responsive, not theatrical.
- `mode="wait"` ensures the exit animation completes before the enter animation starts — prevents two steps being visible simultaneously.
- Do not animate the enrichment progress screen — progress bars already animate and adding step transition on top would feel busy.

---

## B3 — Primary button press states

**Current state:** Primary buttons have hover color changes but no `active:` press state. They feel slightly unresponsive on click.

**Goal:** Subtle scale-down on press that makes every primary action feel physically satisfying.

**Implementation:** Add `active:scale-95 transition-transform` to all primary buttons. This is a pure Tailwind change — no Framer Motion needed.

Apply this after the remaining secondary-button and tiny-typography consistency cleanup is complete to avoid style churn.

```tsx
className="... active:scale-95 transition-transform duration-75"
```

Apply to all primary CTAs: Continue, Start Enrichment, Push to HubSpot, Approve All, etc.

---

## B4 — Row approval animation in `ReviewTable`

**Current state:** When a row is checked (approved), the background instantly changes to the success tint. There is no transition.

**Goal:** A brief, smooth background color transition when a row moves to approved or back to pending.

**Implementation:** Add `transition-colors duration-150` to the row `<tr>` element. This is a pure Tailwind change.

For the "approve all" action specifically, consider a subtle staggered cascade — rows tick to approved one by one with a small delay between each, rather than all flipping at once. This makes the action feel satisfying rather than instantaneous.

Stagger implementation with Framer Motion:
```tsx
// In the approve-all handler, apply approvals with a stagger
rows.forEach((row, i) => {
  setTimeout(() => approveRow(row.id), i * 20); // 20ms stagger
});
```

---

## B5 — Enrichment completion moment

**Current state:** When enrichment completes, the app transitions to Pre-Review. There is a notification chime + banner. The transition itself is instant.

**Goal:** Make the completion feel like a payoff moment. The user just waited through an enrichment run — the moment it finishes should feel satisfying.

**Implementation:**
- Use the step transition animation from B2 — the Pre-Review screen fading in already helps.
- Add a brief success pulse on the completion banner before it transitions: the green banner scales slightly (`scale(1.02)`) on appear then settles. One motion, one second, done.
- Keep the chime (already implemented). Don't add more sound.

---

## B6 — Spinner for truly blank loading states

**Current state:** No spinner (`animate-spin`) exists anywhere in the codebase. Some loading states are text-only.

**Goal:** Replace text-only loading states with a minimal spinner for moments where the UI is blank and waiting.

**Add a spinner to:**
- The bulk progress screen when `jobState` is null (currently renders nothing)
- The login page Suspense fallback (currently `null` — brief blank on load)
- The "Continue to Review & Edit" button in bulk mode (currently text-only loading)

**Implementation:** A simple CSS spinner — no library needed:
```tsx
<div className="animate-spin h-5 w-5 border-2 border-current border-t-transparent rounded-full" />
```

Keep it minimal. This is a utility tool — spinners should communicate "working" not "look at this animation."

---

## B7 — Skeleton loading for `ReviewTable`

**Current state:** When `advanceToReview` is loading manual edits and finalizing rows, the ReviewTable either renders empty or isn't shown yet.

**Goal:** Show a skeleton table with placeholder rows while the review data loads, so the transition from enrichment to review feels continuous rather than blank.

**Implementation:** A simple skeleton component — 5–8 rows of shimmer bars at the appropriate column widths. Use `animate-pulse` (Tailwind, no Framer Motion needed):

```tsx
const ReviewTableSkeleton = () => (
  <div className="space-y-2 animate-pulse">
    {Array.from({ length: 6 }).map((_, i) => (
      <div key={i} className="h-10 bg-zinc-100 rounded" />
    ))}
  </div>
);
```

---

## B8 — Progress bar leading edge pulse

**Current state:** Progress bars animate width smoothly but the leading edge has no visual accent.

**Goal:** Add a subtle shimmer/pulse on the leading edge of active progress bars to make them feel alive during a run.

**Implementation:** Add a small `::after` pseudo-element or an absolutely positioned div that pulses at the bar's right edge using `animate-pulse`. Keep it subtle — a slightly lighter shade of the bar color, not a flash.

This applies to `EnrichmentProgressBars` active phase bars only. Completed bars should be static.

---

## B9 — `PreReviewGate` "all clear" animation

**Current state:** When no issues are found, the gate will show the "✓ No duplicate or flagged records found" message added in SPEC-5 item 5G. It appears instantly.

**Goal:** Give the ✓ message a brief entrance — fade in with a slight scale from 0.95 → 1.0. Feels earned.

**Implementation:** Framer Motion:
```tsx
<motion.div
  initial={{ opacity: 0, scale: 0.95 }}
  animate={{ opacity: 1, scale: 1 }}
  transition={{ duration: 0.2, ease: "easeOut" }}
>
  ✓ No duplicate or flagged records found. Ready to review.
</motion.div>
```

---

## B10 — Push success screen entrance

**Current state:** `SuccessScreen` appears instantly when push completes.

**Goal:** The success screen should feel like a landing — a moment of arrival after the full pipeline run.

**Implementation:**
- The `✅ Import Complete` heading fades and slides up (same pattern as B2 step transitions)
- The stats cards (Created / Updated / Errors) stagger in one by one with a 60ms delay between each
- The HubSpot list link fades in last

```tsx
// Staggered stats cards
{stats.map((stat, i) => (
  <motion.div
    key={stat.label}
    initial={{ opacity: 0, y: 12 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay: i * 0.06, duration: 0.2 }}
  >
    {/* stat card */}
  </motion.div>
))}
```

---

## Sequencing recommendation

**Part A (Claude Code) — run in this order:**
0. Close remaining SPEC-5 blockers (error sanitization, bulk retry UX, style consistency)
1. A5 — Runtime validation (small, self-contained, protective)
2. A4 — Batch manual edits (API change, test thoroughly)
3. A3 — Push handler refactor (extract helpers, verify push behavior with a test run)
4. A2 — Code splitting (verify no loading flicker after each component)
5. A1 — Home refactor (largest item, do last, verify full wizard flow after each hook extraction)

**Part B (Cursor) — run in this order:**
1. B1 — Install Framer Motion, verify compatibility
2. B3 — Button press states (pure Tailwind, zero risk)
3. B4 — Row approval transition (pure Tailwind + minor stagger logic)
4. B6 — Spinners (small, self-contained)
5. B7 — Review table skeleton
6. B2 — Step transitions (first Framer Motion usage — verify carefully)
7. B8 — Progress bar pulse
8. B5, B9, B10 — Completion moments (do last, most polish-sensitive)