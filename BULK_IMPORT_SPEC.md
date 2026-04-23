# Bulk Import & HubSpot Pre-Check — Full Spec

## Overview

This spec covers four phases of upgrades to the Realm Enrichment Tool:

1. **Phase 1 — HubSpot Pre-Check / Deduplication** (all imports)
2. **Phase 2 — Starter Screen + Cost Estimate UI** (all imports, required before Gartner)
3. **Phase 3 — Background Job Architecture** (bulk imports only, required before Gartner, **in progress**)
4. **Phase 4 — Progress / Status Page** (bulk imports only, required before Gartner, **complete**)

Target use case driving this work: **Gartner May 2026 — ~1,550 companies**

---

## Phase 1 — HubSpot Pre-Check / Deduplication

### Goal
Before running ZoomInfo enrichment, check HubSpot for existing records. Skip
ZoomInfo entirely for records that are already complete. Merge existing HubSpot
data for records that exist but are incomplete. This saves ZoomInfo credits,
reduces runtime, and keeps HubSpot data consistent.

### When it runs
After AI enrichment, before ZoomInfo verify. Triggered in `page.tsx` after
`aiRows` is populated, before `runZoomVerify` is called.

### New API route: `POST /api/hubspot/precheck`

**Request:**
```typescript
{
  listType: "companies" | "contacts",
  rows: EnrichedCompany[] | EnrichedContact[]
}
```

**Response:**
```typescript
{
  results: Array<{
    id: string                    // matches row.id from input
    hubspotId: string | null      // existing HubSpot record ID, null if not found
    hubspotComplete: boolean      // true = all critical fields populated in HubSpot
    existingData: {               // current values from HubSpot, empty strings if missing
      // companies:
      domain?: string
      state?: string
      numberofemployees?: string
      linkedin_company_page?: string
      industry?: string
      description?: string
      city?: string
      // contacts:
      email?: string
      jobtitle?: string
      company?: string
      hs_linkedin_url?: string
      state?: string
      phone?: string
      job_level?: string
      job_function?: string
    }
  }>
}
```

### HubSpot lookup implementation

**Companies — batch by domain:**
- Normalize domains before lookup (same `normalizeDomain` already in `companies.ts`)
- Skip rows with empty domain — mark as `hubspotId: null, hubspotComplete: false`
- Use `IN` operator with up to 100 domains per request
- `limit: 200` per request
- Handle pagination if results > 200 (unlikely for event lists, required for bulk)
- If multiple HubSpot records share a domain, use the most recently modified one
- Chunk 1,500 domains into batches of 100 = 15 HubSpot API calls total

Request body pattern:
```json
{
  "filterGroups": [{
    "filters": [{
      "propertyName": "domain",
      "operator": "IN",
      "values": ["acme.com", "contoso.com"]
    }]
  }],
  "limit": 200,
  "properties": [
    "domain", "state", "numberofemployees",
    "linkedin_company_page", "industry", "description", "city"
  ],
  "sorts": [{ "propertyName": "hs_lastmodifieddate", "direction": "DESCENDING" }]
}
```

**Contacts — batch by email:**
- Normalize emails (lowercase, trim)
- Skip rows with empty email — mark as `hubspotId: null, hubspotComplete: false`
- Use `IN` operator with up to 100 emails per request
- Same pagination handling as companies

Request body pattern:
```json
{
  "filterGroups": [{
    "filters": [{
      "propertyName": "email",
      "operator": "IN",
      "values": ["jane@acme.com", "john@contoso.com"]
    }]
  }],
  "limit": 200,
  "properties": [
    "email", "jobtitle", "company", "hs_linkedin_url",
    "state", "phone", "job_level", "job_function"
  ],
  "sorts": [{ "propertyName": "hs_lastmodifieddate", "direction": "DESCENDING" }]
}
```

### "hubspotComplete" definition

**Companies** — all of these must be non-empty strings in HubSpot:
- `domain`
- `state`
- `numberofemployees`
- `linkedin_company_page`
- `industry`

**Contacts** — all of these must be non-empty strings in HubSpot:
- `jobtitle`
- `company`
- `hs_linkedin_url`

### How pre-check results affect the pipeline

| HubSpot status | ZoomInfo | LinkedIn fallback | HubSpot push |
|----------------|----------|-------------------|--------------|
| Not found | ✅ runs normally | ✅ if needed | Create new record |
| Found, complete | ⏭️ skip entirely | ⏭️ skip | Update (merge only, never overwrite) |
| Found, incomplete | ✅ runs (gap fill only regardless of AI confidence) | ✅ if needed | Update |

### New fields on EnrichedCompany / EnrichedContact (types.ts)
```typescript
hubspotId?: string | null
hubspotComplete?: boolean
```

### Rate limit handling in precheck route
`hubspotFetch` currently retries once on 429. For bulk pre-check with 15+ API
calls, add exponential backoff:
- On 429: wait 1s, retry
- On second 429: wait 3s, retry
- On third 429: return error

### Review & Edit UI change
Add a subtle "In HubSpot" badge on rows where `hubspotId` is set. Use a
neutral gray color — not a confidence indicator, just informational. Rows with
`hubspotComplete: true` can show "✓ HubSpot" in a lighter style.

### Progress messaging
Add a new enrichment phase message between AI and ZoomInfo:
`"Checking HubSpot for existing records… (X of Y)"`

---

## Phase 2 — Starter Screen + Cost Estimate UI

### Goal
Give users visibility into what they're about to run before committing.
Required before running any import over ~200 records.

### New starter screen
First screen the user sees (before Upload). Two options:

```
What are you importing?

[ Marketing Event List ]        [ Bulk Import (200+ records) ]
  Contacts or companies           Contacts or companies
  from a marketing event          from a large account list
  20–200 records                  200–2,000 records
  ~15–30 minutes                  ~1–3 hours, runs in background
```

Both modes go through the same pipeline. The difference is:
- **event** mode: current browser-driven behavior, unchanged
- **bulk** mode: background job via QStash, cost estimate shown before enrichment

### New field: `importMode: "event" | "bulk"` on EventContext

### Cost estimate screen (bulk mode only)
Shown after HubSpot pre-check completes, before enrichment starts.

Displays:
```
Import Cost Estimate

Records uploaded:                    1,550
Already in HubSpot (complete):         342  ← skip enrichment
Need enrichment:                     1,208

Estimated ZoomInfo credits:       725–968   (60–80% match rate)
Current ZoomInfo allocation:        2,000   ← pulled from config or entered manually
Credits remaining after this run:   1,032–1,275

Estimated Anthropic cost:            $4–8
Estimated run time:               ~2 hours

[ Cancel ]        [ Proceed with Enrichment → ]
```

Estimates use these formulas:
- ZoomInfo credits: `needEnrichment * 0.60` to `needEnrichment * 0.80`
- Anthropic cost: `(needEnrichment / 3) * 0.002` (rough per-batch estimate in USD)
- Run time: `needEnrichment * 5` seconds (conservative), displayed as rounded minutes/hours

ZoomInfo allocation is not available via API — show a manually editable field
pre-filled with `2000` that the user can update to reflect their actual balance.

### Cost estimate screen (event mode)
Not required for small lists, but show a lightweight summary line after
pre-check on the enrichment screen:
`"X records found in HubSpot — skipping ZoomInfo for those"`

---

## Phase 3 — Background Job Architecture (QStash)

### Goal
Allow enrichment to run server-side, independently of the browser tab.
Required for lists over ~200 records.

### Only applies to bulk mode
Event mode (`importMode: "event"`) is unchanged — still browser-driven.
Bulk mode (`importMode: "bulk"`) uses the job queue.

### Architecture

```
Browser
  → POST /api/jobs/start
      - validates input
      - creates job record in KV (status: "queued")
      - queues first chunk via QStash
      - returns { jobId }

QStash → POST /api/jobs/process (per chunk)
      - reads job from KV
      - processes one chunk (15 rows: AI + ZoomInfo)
      - writes progress back to KV
      - if more chunks remain: queues next chunk via QStash
      - if final chunk: runs LinkedIn fallback pass, marks job complete

Browser polls GET /api/jobs/[jobId]/status every 5 seconds
      - reads job state from KV
      - updates progress UI
      - when complete: loads enriched rows, advances to Review & Edit
```

### Job state schema (stored in KV)

Key pattern: `job:{jobId}:meta`
TTL: 7 days

```typescript
interface BulkJobState {
  jobId: string
  status: "queued" | "running" | "complete" | "failed" | "cancelled"
  importMode: "bulk"
  listType: "companies" | "contacts"
  eventContext: EventContext
  totalRows: number
  processedRows: number
  currentPhase: "ai" | "precheck" | "zoominfo" | "linkedin" | "complete"
  aiComplete: boolean
  precheckComplete: boolean
  zoomInfoComplete: boolean
  linkedInComplete: boolean
  enrichedCount: number
  cachedCount: number
  hubspotSkippedCount: number
  creditsUsed: number
  checkpointChunk: number    // resume from here on failure
  error?: string
  startedAt: string          // ISO timestamp
  completedAt?: string
}
```

Key pattern for enriched rows: `job:{jobId}:rows:{chunkIndex}`
TTL: 7 days
Max value size: stay under 900KB per key (Upstash 1MB limit with buffer)
Rows per chunk key: ~100 enriched rows

### New routes

**`POST /api/jobs/start`**
- Accepts: `{ listType, eventContext, rows: RawRow[] }`
- Creates job in KV
- Queues chunk 0 via QStash
- Returns: `{ jobId }`

**`POST /api/jobs/process`**
- Called by QStash only (verify QStash signature)
- Accepts: `{ jobId, chunkIndex }`
- Reads job state + raw rows from KV
- Processes chunk: AI enrichment (3 rows/batch) → ZoomInfo (if not hubspotComplete)
- Writes enriched rows to `job:{jobId}:rows:{chunkIndex}`
- Updates job meta in KV
- If more chunks: enqueues next chunk
- If final AI+ZoomInfo chunk: enqueues LinkedIn pass start
- LinkedIn pass: one message per contact/company needing LinkedIn

**`GET /api/jobs/[jobId]/status`**
- Returns current `BulkJobState` (without enriched rows — those are large)
- Browser polls this every 5 seconds

**`POST /api/jobs/[jobId]/resume`**
- Requeues from `checkpointChunk` on failed job
- Resets status to "queued"

**`POST /api/jobs/[jobId]/cancel`**
- Sets status to "cancelled"
- Does not delete KV data (keep for debugging)

### ZoomInfo retry/backoff
In `zoominfo-enricher.ts`, wrap each enrich call:
```typescript
async function enrichWithRetry<T>(
  fn: () => Promise<T>,
  retries = 3
): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      if (status === 429 && i < retries - 1) {
        await sleep(2000 * (i + 1)); // 2s, 4s, 6s
        continue;
      }
      throw err;
    }
  }
  throw new Error("Max retries exceeded");
}
```

Delay between rows in bulk mode: 500ms (vs 200ms in event mode).
Tune down once ZoomInfo rate limit confirmed by account manager.

### QStash setup
- Install: `npm install @upstash/qstash`
- Env vars needed: `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`
- These are available in Upstash dashboard under QStash section
- Add to Vercel env vars and `.env.local`

### SessionStorage in bulk mode
Bulk mode does NOT use sessionStorage for enriched rows.
Only stores: `{ jobId, importMode: "bulk" }` in sessionStorage.
All job state and enriched data lives in KV.
This avoids the ~5MB browser sessionStorage limit for large imports.

---

## Phase 4 — Progress / Status Page

### Goal
Give users visibility into a running background job without requiring the
browser tab to stay open. Status is readable from any browser.

### UI: enrichment screen in bulk mode

Replace the current progress bar with a phase-by-phase status view:

```
Gartner May 2026 — 1,550 Companies
Running in background — you can close this tab

[████████████████████░░░░░░░░░░] 67%

✅ HubSpot pre-check     1,550 / 1,550   342 already complete, skipping ZoomInfo
✅ AI enrichment         1,550 / 1,550   complete
⏳ ZoomInfo enrichment    812 / 1,208    in progress... ~47 min remaining
⬜ LinkedIn fallback       —             waiting

Credits used so far: ~487
Started: 2:14 PM · Running for: 23 min

[ Cancel Import ]
```

### Polling
Browser polls `GET /api/jobs/[jobId]/status` every 5 seconds.
On completion: auto-advance to Review & Edit, load enriched rows from KV.
On failure: show error + Resume button.

### Shareable URL
Status page is accessible at `/` with jobId in sessionStorage.
If user closes and reopens browser, they can paste the jobId to resume viewing.
(Simple implementation: show jobId on screen with a "copy" button.)

### Review & Edit in bulk mode
When job completes, rows are assembled from `job:{jobId}:rows:*` chunk keys
and loaded into the Review & Edit table. Same UI as event mode — no changes
needed to ReviewTable component.

---

## Implementation order

Build in this order — each phase is independently deployable:

1. Phase 1: HubSpot pre-check (new route + pipeline integration + UI badge)
2. Phase 2: Starter screen + cost estimate (new UI components only)
3. Phase 3: Background jobs (QStash install + new routes + process worker)
4. Phase 4: Status page (new UI component + polling)

Do not start Phase 3 until Phase 1 and 2 are complete and tested.
Do not start Phase 4 until Phase 3 routes exist.

---

## Files that will change

**Phase 1:**
- `src/app/api/hubspot/precheck/route.ts` (new)
- `src/lib/hubspot/companies.ts` (batch lookup function)
- `src/lib/hubspot/contacts.ts` (batch lookup function)
- `src/lib/utils/types.ts` (hubspotId, hubspotComplete fields)
- `src/app/page.tsx` (call precheck between AI and ZoomInfo)
- `src/components/ReviewTable.tsx` (HubSpot badge)

**Phase 2:**
- `src/components/StarterScreen.tsx` (new)
- `src/components/CostEstimateScreen.tsx` (new)
- `src/lib/utils/types.ts` (importMode on EventContext)
- `src/app/page.tsx` (starter screen step, cost estimate step)

**Phase 3:**
- `src/app/api/jobs/start/route.ts` (new)
- `src/app/api/jobs/process/route.ts` (new)
- `src/app/api/jobs/[jobId]/status/route.ts` (new)
- `src/app/api/jobs/[jobId]/resume/route.ts` (new)
- `src/app/api/jobs/[jobId]/cancel/route.ts` (new)
- `src/lib/enrichment/zoominfo-enricher.ts` (retry/backoff)
- `src/lib/cache/enrichment-cache.ts` (job state read/write helpers)
- `src/app/page.tsx` (bulk mode flow, QStash job start)
- `package.json` (@upstash/qstash dependency)

**Phase 4:**
- `src/components/BulkProgressScreen.tsx` (new)
- `src/app/page.tsx` (polling logic, bulk enrichment step UI)

---

## Open questions (do not block build)

1. ZoomInfo rate limits — waiting on account manager. Current conservative
   delay: 500ms between rows in bulk mode. Tune when confirmed.
2. HubSpot `IN` operator support for domain/email — test in Phase 1.
   Fallback: use multiple `filterGroups` (OR) if `IN` fails.
3. QStash message size limit — verify raw rows for 1,500 companies fit in one
   QStash message, or store rows in KV before queuing and pass only jobId.