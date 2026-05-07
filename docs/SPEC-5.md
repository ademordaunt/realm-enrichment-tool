# Realm Enrichment Tool — SPEC-5
## Codebase Cleanup: Safe Wins

**Status:** Implemented with follow-up blockers
**Scope:** Code health, stability, security, performance, and UI consistency — low regression risk items only
**Tool:** Claude Code
**Companion:** SPEC-6 covers larger refactors and micro-interactions

---

## Overview

SPEC-5 is a cleanup pass focused on changes that are clearly beneficial and carry low regression risk. Every item here has a specific finding from the audit, a clear fix, and limited blast radius. Nothing in this spec changes pipeline logic or enrichment behavior.

Implementation snapshot (current):
- Most SPEC-5 items are complete (dead code removal, helper consolidation, race guards, validation hardening, memoization, and accessibility/UX consistency updates).
- Remaining follow-ups are narrow: two raw-error exposure paths, explicit retry control in repeated bulk polling failures, and final secondary-button/tiny-typography normalization.

Items are grouped by category and ordered within each category by priority.

---

## Category 1 — Code Health

### 1A — Remove confirmed dead code

**`EnrichmentProgress` component — delete entirely**
- `src/components/EnrichmentProgress.tsx` is exported but not imported anywhere in the codebase. It was superseded by `EnrichmentProgressBars` in SPEC-4.
- Delete the file.

**`createStaticList` in `lists.ts` — delete**
- `src/lib/hubspot/lists.ts` exports `createStaticList` but it has no callers. The push flow uses `createStaticListForPush` in `push-handler.ts` instead.
- Delete the unused export. If `lists.ts` becomes empty after removal, delete the file too.

**`stripMarkdownFences` and `parseJsonArray` in `ai-enricher.ts` — make private**
- Both are exported but only used within the same file.
- Remove the `export` keyword from both. No callers outside the file.

---

### 1B — Consolidate duplicated helpers

Each of these exists in multiple places with slightly different implementations. Consolidate into a single shared utility in `src/lib/utils/`.

**`isRecord` object guard**
Appears in at least 6 files:
- `src/lib/hubspot/push-handler.ts`
- `src/lib/enrichment/zoominfo-enricher.ts`
- `src/app/api/enrich/ai/route.ts`
- `src/app/api/enrich/zoominfo/route.ts`
- `src/app/api/enrich/linkedin-search/route.ts`
- `src/app/api/jobs/start/route.ts`

Action: Create `src/lib/utils/guards.ts`, export a single `isRecord(value: unknown): value is Record<string, unknown>` function. Replace all local copies with the import.

**`chunk<T>` array helper**
Appears in:
- `src/app/api/jobs/process/route.ts`
- `src/lib/enrichment/ai-enricher.ts`

Action: Add `chunk<T>(array: T[], size: number): T[][]` to `src/lib/utils/array.ts` (create file). Replace both local copies.

**Domain normalization**
At least 4 flavors across:
- `src/lib/hubspot/companies.ts` (`normalizeDomain`)
- `src/lib/enrichment/zoominfo-enricher.ts` (local `normalizeDomain`)
- `src/lib/utils/prereview.ts` (`normalizeHost`, `normalizeCompanyDomainKey`, `normalizeD`)
- `src/components/PrePushScreen.tsx` (`normalizeDomainLocal`)

Action: Audit all four implementations for behavioral differences. Where they are functionally identical, consolidate into a single exported `normalizeDomain` in `src/lib/utils/domain.ts`. Where they differ meaningfully, document why in a comment and leave them separate — do not force unification if it would change behavior. Replace unified ones with the shared import.

> **Important:** Do not consolidate domain normalization if the implementations differ in ways that affect matching logic. Correctness over tidiness here.

---

### 1C — Remove console.log from production code paths

The audit found `console.log` statements across 12 files. Per project conventions, `console.error` is intentional and should stay. `console.log` in production server routes and lib files should be removed.

**Remove `console.log` from these files:**
- `src/app/page.tsx` (line 1591)
- `src/app/api/jobs/process/route.ts` (line 426)
- `src/app/api/jobs/start/route.ts` (lines 25, 81, 83)
- `src/app/api/enrich/linkedin-search/route.ts` (lines 164, 282)
- `src/lib/cache/enrichment-cache.ts` (line 195)
- `src/lib/enrichment/ai-enricher.ts` (lines 560, 624, 641)
- `src/lib/enrichment/zoominfo-enricher.ts` (lines 89, 94, 244, 247, 267, 274, 315, 318, 364, 664, 667, 687, 698, 748, 751, 789)
- `src/lib/hubspot/companies.ts` (lines 113, 277, 286)
- `src/lib/hubspot/lists.ts` (line 26)
- `src/lib/hubspot/list-folders.ts` (lines 65, 66, 67, 68)
- `src/lib/hubspot/push-handler.ts` (lines 148, 153)

**Leave as-is:**
- `src/app/api/zoominfo-lookup/route.ts` — this is a dev-only diagnostic route (returns 403 in production). Logs here are intentional.
- `test-cache.js`, `clear-contact-cache.js` — CLI scripts, intentional output.

**Before removing each log:** check whether it is logging anything that would be useful as a `console.error` or structured log instead. If so, convert rather than delete. If it is pure debug noise, delete.

---

## Category 2 — Stability & Correctness

### 2A — Fix the polling race condition

**Finding:** `startJobPolling` in `page.tsx` uses `setInterval` to fire an async `tick` every 5 seconds with no in-flight guard. A slow response from tick N can resolve after tick N+1 has already updated state, causing stale data to overwrite fresher data.

**Fix:** Add an `inFlight` ref guard. If a tick is already awaiting a response, skip the next tick entirely.

```typescript
// Pattern to implement:
const pollingInFlight = useRef(false);

const tick = async () => {
  if (pollingInFlight.current) return;
  pollingInFlight.current = true;
  try {
    // existing tick logic
  } finally {
    pollingInFlight.current = false;
  }
};
```

File: `src/app/page.tsx`, `startJobPolling` function.

---

### 2B — Fix the parse file race condition

**Finding:** If a user uploads file A, then quickly uploads file B, the response for file A can arrive after file B's response and overwrite state with stale data.

**Fix:** Add a request generation counter. Only apply the response if it matches the most recent request.

```typescript
// Pattern to implement:
const parseRequestId = useRef(0);

const parseFile = async (file: File) => {
  const thisRequestId = ++parseRequestId.current;
  const result = await fetch(...);
  if (thisRequestId !== parseRequestId.current) return; // stale, discard
  // apply result
};
```

File: `src/app/page.tsx`, `parseFile`/`onFiles` handler.

---

### 2C — Surface bulk polling errors in UI

**Finding:** When bulk status polling fails, errors are only logged to `console.error`. The user sees stale progress with no explanation.

**Fix:** When a poll tick fails (non-ok response or network error), surface a visible warning in the `BulkProgressScreen` — something like "Having trouble reaching the server — retrying…". After 3 consecutive failures, surface a more prominent error with a retry/cancel option.

Add a `consecutivePollingErrors` counter to the polling state. Reset to 0 on success. Increment on failure. Pass count to `BulkProgressScreen` as a prop and render the appropriate message.

Files: `src/app/page.tsx` (`startJobPolling`), `src/components/BulkProgressScreen.tsx`.

---

### 2D — Fix unhandled promise rejection in logout

**Finding:** The sign-out handler uses `void fetch(...).finally(...)` with no `.catch()`. A network error produces an unhandled rejection.

**Fix:** Add a `.catch()` that swallows the error silently (logout should always redirect regardless):

```typescript
void fetch("/api/auth/logout", { method: "POST" })
  .catch(() => {}) // network failure on logout is non-actionable
  .finally(() => router.push("/login"));
```

File: `src/app/page.tsx`, sign-out handler.

---

### 2E — Fix unhandled promise rejection for notification permission

**Finding:** `void Notification.requestPermission()` is fire-and-forget with no catch. Some browsers reject this promise.

**Fix:**
```typescript
void Notification.requestPermission().catch(() => {});
```

File: `src/app/page.tsx`, enrichment start path.

---

## Category 3 — Security

### 3A — Sanitize manual edits cache keys

**Finding:** `src/app/api/manual-edits/route.ts` accepts user-provided `stableKey`, `field`, and `value` and writes them to KV cache with no allowlist, length limits, or field validation. This is a potential key bloat and abuse vector.

**Fix:**
1. Add a `MAX_VALUE_LENGTH = 2000` constant. Reject requests where `value.length > MAX_VALUE_LENGTH`.
2. Add an allowlist of valid `field` values (the actual field names used in the app — `linkedinUrl`, etc.). Reject requests with unrecognized field names.
3. Add a `MAX_KEY_LENGTH = 500` constant. Reject requests where `stableKey.length > MAX_KEY_LENGTH`.
4. Return `400` with a generic message for all validation failures — do not echo back the invalid input.

File: `src/app/api/manual-edits/route.ts`.

---

### 3B — Reduce verbose error responses on API routes

**Finding:** Multiple API routes return raw `err.message` or `String(err)` to the client, which can leak internal details, file paths, or dependency names.

**Fix:** For each route listed below, replace raw error content in responses with a generic message. Log the actual error server-side with `console.error` before returning the generic response.

Pattern:
```typescript
// Before
return Response.json({ error: "Failed", detail: String(err) }, { status: 500 });

// After
console.error("[route-name] unexpected error:", err);
return Response.json({ error: "An unexpected error occurred." }, { status: 500 });
```

Apply to:
- `src/app/api/enrich/ai/route.ts`
- `src/app/api/enrich/linkedin-search/route.ts`
- `src/app/api/enrich/prospector/route.ts`
- `src/app/api/enrich/zoominfo/route.ts`
- `src/app/api/hubspot/folders/route.ts`
- `src/app/api/hubspot/precheck/route.ts`
- `src/app/api/hubspot/push/route.ts`
- `src/app/api/jobs/start/route.ts`
- `src/app/api/parse/route.ts`

**Special case — `zoominfo-lookup/route.ts`:** This route already returns 403 in production. The verbose response is dev-only and acceptable. Leave as-is.

> **Note:** The client-side error display in `page.tsx` reads `detail` from some of these responses to show operator-facing messages. Before removing `detail` from any route, confirm whether the client actually displays it. If so, replace the raw error content with a safe, human-readable description of what went wrong — not the raw exception.

---

## Category 4 — Performance

### 4A — Memoize `phases` array in `BulkProgressScreen`

**Finding:** `BulkProgressScreen` recreates the `phases` array on every render. Since it re-renders every second (polling timer), `EnrichmentProgressBars` receives a new array reference every second, causing unnecessary re-renders of the progress bar component.

**Fix:** Wrap the `bulkPhases` array construction in `useMemo` with the relevant state values as dependencies.

```typescript
const bulkPhases = useMemo<Phase[]>(() => [
  { label: "AI Analysis", status: aiState === "done" ? "complete" : ... },
  // ...
], [aiState, aiPct, jobState.processedRows, jobState.totalRows, /* other deps */]);
```

File: `src/components/BulkProgressScreen.tsx`.

---

### 4B — Memoize expensive derivations in `PreReviewGate`

**Finding:** `intlGovRowsUnique`, `companyDupMap`, and duplicate contact group derivations run on every render of `PreReviewGate` without memoization. These iterate over potentially large row arrays.

**Fix:** Wrap each in `useMemo`:

```typescript
const intlGovRowsUnique = useMemo(() => {
  // existing logic
}, [working, listType]);

const companyDupMap = useMemo(() => 
  listType === "companies" ? detectDuplicateGroups(working as EnrichedCompany[]) : null,
[working, listType]);
```

File: `src/components/PreReviewGate.tsx`.

---

### 4C — Memoize `PrePushScreen` array scans

**Finding:** `PrePushScreen` runs repeated `.some()` and similar scans over `approvedRows` / `contactRowsForTable` on every render without memoization.

**Fix:** Wrap the derived boolean flags and counts in `useMemo` with `approvedRows` as the dependency.

File: `src/components/PrePushScreen.tsx`.

---

### 4D — Add empty state to `ReviewTable` filtered results

**Finding (from UI audit):** When the active filter produces zero visible rows, `ReviewTable` renders a blank table body with no message. This looks broken.

**Fix:** Add an empty state row when `filteredRows.length === 0`:

```
No records match the current filter.
```

This is also a performance-adjacent fix — it makes zero-result states explicit rather than leaving the user to wonder if something is loading.

File: `src/components/ReviewTable.tsx`.

---

## Category 5 — UI Consistency

### 5A — Unify primary button style

**Finding:** Two purple primary button systems exist side by side:
- CSS token-based: `bg-(--realm-purple) font-semibold hover:bg-(--realm-purple-hover)`
- Hardcoded hex: `bg-[#7B35C1] font-medium hover:bg-[#6A2AAD]`

And the final primary action in `PrePushScreen` ("Push to HubSpot") is blue (`bg-blue-600`), not purple.

**Fix:**
1. Audit every primary button across all components and standardize on the token-based variant: `bg-(--realm-purple) font-semibold hover:bg-(--realm-purple-hover)`.
2. Replace all hardcoded hex purple buttons with the token version.
3. Change the "Push to HubSpot" button in `PrePushScreen` from blue to the standard purple primary. This is the most important action in the entire wizard — it should match the visual language of every other primary CTA.

Files: `src/app/page.tsx`, `src/components/CostEstimateScreen.tsx`, `src/components/PreReviewGate.tsx`, `src/components/BulkProgressScreen.tsx`, `src/components/PrePushScreen.tsx`.

---

### 5B — Unify secondary button style

**Finding:** Two secondary outlined button systems:
- Token-based: `border-(--border-default) bg-white text-(--text-primary)`
- Zinc-based: `border-zinc-* bg-white text-zinc-*`

**Fix:** Standardize on the token-based variant throughout. Replace zinc-based secondary buttons in `PrePushScreen` and anywhere else they appear.

---

### 5C — Unify destructive button style

**Finding:** Destructive actions are styled inconsistently:
- "Remove All Duplicates" uses explicit red outline (correct)
- "Cancel & Start Over" in `BulkProgressScreen` is styled as neutral secondary (incorrect — this is a destructive action)

**Fix:** Apply a consistent destructive style to "Cancel & Start Over". Use the same red outline pattern as "Remove All Duplicates".

File: `src/components/BulkProgressScreen.tsx`.

---

### 5D — Replace arbitrary font sizes with Tailwind scale

**Finding:** Multiple one-off font sizes bypassing the Tailwind type scale:
- `text-[0.8rem]` in `PreReviewGate`
- `text-[11px]`, `text-[10px]`, `text-[9px]` in `page.tsx`, `EventContextForm`, `ReviewTable`
- `text-[0.65rem]`, `text-[0.75rem]` in `ReviewTable`

**Fix:** Replace each with the nearest Tailwind scale equivalent:
- `text-[11px]` / `text-[0.8rem]` → `text-xs` (12px, close enough)
- `text-[10px]` / `text-[9px]` → `text-[10px]` is acceptable for truly tiny labels, but audit whether these can be bumped to `text-xs` for readability

Do not force a substitution that makes labels illegible. Where the arbitrary size exists for a good reason (e.g. a truly tiny badge label), leave it with a comment explaining why.

---

### 5E — Add combobox ARIA contract to state/region picker

**Finding:** The new state/region combobox (added in SPEC-4) is missing the full ARIA combobox contract: `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`.

**Fix:** Add the missing ARIA attributes to the combobox input and listbox:
- Input element: `role="combobox"`, `aria-expanded={isOpen}`, `aria-controls="state-region-listbox"`, `aria-activedescendant={activeOption?.id}`
- Dropdown list: `role="listbox"`, `id="state-region-listbox"`
- Each option: `role="option"`, `aria-selected={isSelected}`

File: `src/components/EventContextForm.tsx`.

---

### 5F — Add focus management on wizard step transitions

**Finding:** When the wizard moves between steps, focus is left wherever it was (likely on the button that triggered the transition). This means keyboard users are stranded on an element that no longer exists or is no longer relevant.

**Fix:** After each step transition, move focus to the top of the new step's content. A clean pattern is to add a `ref` to the main content container of each step and call `.focus()` on step change:

```typescript
const stepContentRef = useRef<HTMLDivElement>(null);

useEffect(() => {
  stepContentRef.current?.focus();
}, [step]);

// In JSX:
<div ref={stepContentRef} tabIndex={-1} outline-none>
  {/* step content */}
</div>
```

`tabIndex={-1}` makes the div programmatically focusable without adding it to the tab order.

File: `src/app/page.tsx`.

---

### 5G — Add missing empty state to `PreReviewGate`

**Finding:** When no duplicate or international/government issues are found, the Pre-Review gate renders no content in those sections — just nothing. This can feel like a blank or broken screen.

**Fix:** When all rows are clean (no duplicates, no international/gov flags), show a brief positive confirmation:

```
✓ No duplicate or flagged records found. Ready to review.
```

This doubles as a reassuring signal to the operator that the pre-review check ran and found nothing concerning.

File: `src/components/PreReviewGate.tsx`.

---

## Affected files summary

| File | Items |
|---|---|
| `src/components/EnrichmentProgress.tsx` | 1A (delete) |
| `src/lib/hubspot/lists.ts` | 1A |
| `src/lib/enrichment/ai-enricher.ts` | 1A, 1B, 1C |
| `src/lib/utils/guards.ts` | 1B (new file) |
| `src/lib/utils/array.ts` | 1B (new file) |
| `src/lib/utils/domain.ts` | 1B (new file, conditional) |
| `src/app/page.tsx` | 1C, 2A, 2B, 2C, 2D, 2E, 5A, 5F |
| `src/app/api/jobs/process/route.ts` | 1C |
| `src/app/api/jobs/start/route.ts` | 1C |
| `src/app/api/enrich/linkedin-search/route.ts` | 1C, 3B |
| `src/lib/cache/enrichment-cache.ts` | 1C |
| `src/lib/enrichment/zoominfo-enricher.ts` | 1B, 1C |
| `src/lib/hubspot/companies.ts` | 1B, 1C |
| `src/lib/hubspot/list-folders.ts` | 1C |
| `src/lib/hubspot/push-handler.ts` | 1B, 1C |
| `src/app/api/manual-edits/route.ts` | 3A |
| `src/app/api/enrich/ai/route.ts` | 3B |
| `src/app/api/enrich/prospector/route.ts` | 3B |
| `src/app/api/enrich/zoominfo/route.ts` | 3B |
| `src/app/api/hubspot/folders/route.ts` | 3B |
| `src/app/api/hubspot/precheck/route.ts` | 3B |
| `src/app/api/hubspot/push/route.ts` | 3B |
| `src/app/api/parse/route.ts` | 3B |
| `src/components/BulkProgressScreen.tsx` | 2C, 4A, 5C |
| `src/components/PreReviewGate.tsx` | 4B, 5G |
| `src/components/PrePushScreen.tsx` | 4C, 5A, 5B |
| `src/components/ReviewTable.tsx` | 4D, 5D |
| `src/components/EventContextForm.tsx` | 5E |
| `src/components/CostEstimateScreen.tsx` | 5A |

---

## Sequencing recommendation for Claude Code

Run in this order to minimize risk of cascading issues:

1. **1A** — Delete dead code first. Cleans the surface before touching anything.
2. **1C** — Remove console.logs. Safe, mechanical, no logic changes.
3. **3B** — Sanitize error responses. Safe, mechanical.
4. **3A** — Manual edits validation. Small, self-contained.
5. **2D, 2E** — Unhandled rejection fixes. Tiny, safe.
6. **1B** — Consolidate shared utilities. Do domain normalization last and carefully.
7. **5A, 5B, 5C, 5D** — Button and typography consistency. Visual-only.
8. **5E, 5F, 5G** — Accessibility and empty states.
9. **4A, 4B, 4C** — Memoization. Test each screen after.
10. **2A, 2B** — Race condition fixes. Most complex items — do last.
11. **2C** — Polling error UI. Requires new prop on BulkProgressScreen.