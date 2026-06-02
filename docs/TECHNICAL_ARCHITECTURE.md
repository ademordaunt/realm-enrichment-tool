# Technical Architecture — Realm Enrichment Tool

This document describes the current implementation only (no planned/future behavior).

---

## 1) Project Overview

The app is a Next.js workflow for enriching CSV/XLSX uploads (companies or contacts) and pushing approved rows to HubSpot static lists.

Import modes:

- `event` (**Marketing Event List**): browser-driven enrichment via `useEnrichmentPipeline.runEnrichment`
- `bulk` (**Bulk Import**): background job via `useBulkJob.startBulkJob` → `POST /api/jobs/start` → QStash → `POST /api/jobs/process`

Deployment assumptions:

- Vercel App Router
- Upstash Redis (KV) + QStash
- Shared-password route protection via `src/proxy.ts` (Next.js App Router proxy; checks cookie before route handlers)

Core runtime stack from `package.json`:

- Next.js `16.2.4`
- React `19.2.4`
- TypeScript `5.x`
- Tailwind `4.x`
- Framer Motion `12.x`
- Anthropic SDK `@anthropic-ai/sdk`
- Upstash Redis/QStash

---

## 2) Frontend Structure

`src/app/page.tsx` is a client orchestrator (~650 lines) that coordinates state and step routing.

Logic is split into hooks:

- `src/hooks/useEnrichmentPipeline.ts`
- `src/hooks/useBulkJob.ts`
- `src/hooks/useWizardSession.ts`
- `src/hooks/useHubSpotPush.ts`

Step shells extracted from `page.tsx`:

- `src/components/UploadStep.tsx`
- `src/components/EnrichingStep.tsx`
- `src/components/PushingStep.tsx`

Dynamic imports:

- In `page.tsx`: `EventContextForm`, `PrePushScreen`, `ReviewTable`, `PreReviewGate`
- In `EnrichingStep.tsx`: `BulkProgressScreen`
- Secondary button styles and micro-typography are fully normalized to tokenized CSS variables across all UI surfaces.

Session storage keys in active use:

- `realm-enrichment-session-v1`
- `realm-bulk-job-id`
- `realm-enrichment-manual-edits-v1`
- `realm-selected-hubspot-folder` — persists the user's last-selected HubSpot destination folder across sessions (set in `PrePushScreen.tsx`)

---

## 3) Pipeline Order

### Event Mode

Current order:

1. AI enrichment (`/api/enrich/ai`, batched)
2. ZoomInfo verify (`/api/enrich/zoominfo`, chunked NDJSON)
3. HubSpot pre-check (`runHubSpotPreCheck`, after verify)
4. LinkedIn fallback (`/api/enrich/linkedin-search`) for rows still missing LinkedIn

### Bulk Mode

Worker phases in `/api/jobs/process`:

1. `ai`
2. `zoominfo`
3. HubSpot pre-check runs after zoom phase completion
4. `linkedin`

Both modes end in `finalizeRowsForReview` before review UI.

### Bulk job API surface

| Endpoint | Role |
|----------|------|
| `POST /api/jobs/start` | Persist raw rows + job meta in Redis; queue first `ai` chunk (`maxDuration` 30) |
| `POST /api/jobs/process` | QStash worker: runs `ai` → `zoominfo` → precheck → `linkedin` chunks (`maxDuration` 60) |
| `GET /api/jobs/[jobId]/status` | Poll job state; stale-running watchdog |
| `GET /api/jobs/[jobId]/rows` | Load enriched rows after `complete` |
| `POST /api/jobs/[jobId]/cancel` | Cancel job |
| `POST /api/jobs/[jobId]/resume` | Resume failed job |

### Cost estimate UI (not on live bulk path)

- `CostEstimateScreen` + wizard step `costestimate` are implemented in `page.tsx` / `useEnrichmentPipeline`.
- Gate runs only when `runEnrichment` is called with `wizardImportMode === "bulk"` (after AI batches, before ZoomInfo/LinkedIn tail).
- **Bulk Import** submits via `bulk.startBulkJob`, which skips this path entirely. No pre-run cost confirmation for background bulk jobs.

### Bulk upload guard

- Lists with fewer than 200 rows show a warning on upload suggesting event mode; operator can bypass with **Continue Anyway** (`bulkSmallListBypass`).

---

## 4) Progress + Bulk Polling

Shared progress UI:

- `src/components/EnrichmentProgressBars.tsx`

Bulk polling:

- Implemented in `useBulkJob.startJobPolling`
- In-flight guard prevents overlapping polls
- `consecutivePollingErrors` increments on fetch failures and resets:
  - on successful poll
  - on new bulk job start
  - on bulk session reset
  - on bulk cancel
- Escalated warning copy is shown in `BulkProgressScreen`
- At 3+ consecutive failures, `BulkProgressScreen` renders an explicit retry control wired to an immediate manual status poll

### Bulk Stuck-Running Watchdog

Bulk jobs include a server-side watchdog to recover from jobs that remain in `running` without heartbeat updates.

Behavior:

- Worker chunk handler writes a heartbeat timestamp at chunk start:
  - `src/app/api/jobs/process/route.ts` sets `jobState.lastHeartbeatAt = Date.now()`
- Status endpoint enforces stale-running cutoff:
  - `src/app/api/jobs/[jobId]/status/route.ts` defines `STALE_RUNNING_MS = 5 * 60 * 1000`
  - If job state is `running` and `Date.now() - lastHeartbeatAt > STALE_RUNNING_MS`, state is auto-transitioned to `failed`
  - Endpoint sets both `failureReason` and legacy `error` message for UI compatibility, then persists via `setJobState(...)`
- Resume flow clears stale-failure marker before retry:
  - `src/app/api/jobs/[jobId]/resume/route.ts` clears `failureReason` so resume can proceed cleanly
- State shape supports this flow:
  - `src/lib/utils/types.ts` includes `lastHeartbeatAt?: number` and `failureReason?: string` on `BulkJobState`

Result:

- Stuck-running jobs no longer remain indefinitely in `running`.
- They become resumable via the existing resume path after automatic transition to `failed`.

---

## 5) Review Finalization + Manual Edits

Manual edits APIs:

- `GET/POST /api/manual-edits` (single key)
- `POST /api/manual-edits/batch` (multi-key fetch for review initialization)

Review initialization:

- `advanceToReview` fetches batch manual edits and passes them to `finalizeRowsForReview`
- Manual edits are merged before bucket computation
- Identity confidence backfill (`identityConfidence <- confidenceScore`) still runs during finalization

Bulk rows endpoint:

- `GET /api/jobs/[jobId]/rows` validates row shape with `isValidEnrichedCompany` / `isValidEnrichedContact` before returning rows

---

## 6) HubSpot Push Behavior

Route: `src/app/api/hubspot/push/route.ts` → `handleHubSpotPushRequest` in `src/lib/hubspot/push-handler.ts`.

- `export const maxDuration = 120` on the push route.
- Response: `ReadableStream` with `Content-Type: application/x-ndjson`.
- Event order: `list_created` → `progress` (0/total, then per write chunk) → `done` (after CRM writes **and** `addRecordsToList`) or `error` on failure.
- `done` is written at the end of the stream `start()` callback after list membership is attempted.

Client (`useHubSpotPush.consumePushNdjson`):

- Parses NDJSON lines from `fetch` body reader.
- If stream ends without a parsed `{ type: "done" }`, throws **"HubSpot push finished without a result payload."** (client-side; typical causes: serverless timeout, truncated stream, or missing final line).

Deduplication/matching in `push-handler.ts`:

- **Contacts:** dedupe approved rows by normalized `resolvedEmail`; split `known` (row has `hubspotId`) vs `unknown`; `batchFindCompaniesByDomain` for association targets; `batchFindContactsByEmail` for unknowns; unmatched → `toCreate`. **No** sequential `findContactByNameAndCompany` fallback (removed — caused timeouts on large net-new lists). Duplicate existing CRM contacts are handled at create time via HubSpot "already exists" errors in `batchCreateContacts`.
- **Companies:** dedupe by normalized domain + name+state pass; `batchFindCompaniesByDomain`; domainless `toCreate` rows may use sequential `findCompanyByName` (100 ms delay between attempts).

Write batching (`HUBSPOT_BATCH_SIZE = 100`, `HUBSPOT_BATCH_COOLDOWN_MS = 200` between chunks):

- Contacts: `batch/update`, `batch/create`, association `batch/create` (type `279`), list membership add (100 IDs/chunk).
- Progress NDJSON is emitted from `onAfterChunk` during batch create/update only — not during matching.

Associations:

- Contact-to-company associations use HubSpot association type `279` (`batchAssociateContactsToCompanies`).

### Lead Source Behavior (Current)

- Contacts:
  - Per-row push extras are built by `buildPushExtras(...)`
  - `useExistingLeadSource` / `useExistingLeadSourceDescription` can prefer CSV row values per contact
  - `lead_source__deal_source` and `lead_source_description` are fill-empty-only in contact property builders
- Companies:
  - Global extras are used (not per-row CSV toggle behavior)
  - `lead_source` is fill-empty-only in batch and single update paths
  - `lead_source_description` differs by path:
    - batch path (`mergeLeadExtras`) writes when provided
    - single-record update path checks fill-empty-only

---

## 7) Data + Utility Rules

Combined name columns:

- Headers matching `Name`, `Full Name`, `Attendee Name`, `Participant Name`, `Attendee`, or `Contact Name` (normalized) are detected during CSV parsing in `src/lib/parsers/column-mapper.ts` and automatically split into `firstName` and `lastName`.
- The split handles: "Last, First" comma format, leading honorifics (Dr., Mr., Mrs., Ms., Prof., Sr., Jr.), and defaults to first-token / remaining-tokens split.
- The `fullName` sentinel is never stored on the final `RawContactRow` — it is resolved and deleted during `mapContactRow`.

Domain normalization:

- Shared helper: `src/lib/utils/domain.ts`
- Domain normalization is only consolidated where behavior is equivalent.
- When behavior differs for correctness-sensitive paths, local normalization variants are intentionally preserved.

Caching (Upstash Redis via `src/lib/cache/enrichment-cache.ts`):

| Key pattern | TTL | Purpose |
|-------------|-----|---------|
| `company:{normalized_name}` | 30 days | Enriched company cache |
| `contact:{email}` | 30 days | Enriched contact cache |
| `manual_edits:{listType}:{stableKey}` | 7 days | Operator manual edits |
| `job:{jobId}:meta` | 7 days | `BulkJobState` |
| `job:{jobId}:raw` | 7 days | Raw upload rows (single blob if ≤ ~800 KB) |
| `job:{jobId}:raw:{shardIndex}` | 7 days | Raw row shards when large |
| `job:{jobId}:raw:meta` | 7 days | `{ shards: N }` for reassembly |
| `job:{jobId}:rows:{chunkIndex}` | 7 days | Enriched rows per AI chunk |

LinkedIn search route (`src/app/api/enrich/linkedin-search/route.ts`) uses a separate Redis client for `linkedin:contact:{email}` and `linkedin:company:{name}|{domain}` caches (30 days).

Manual edits TTL and batch hydration are active in the review flow.

---

## 8) Integrations

### Anthropic

- AI enrichment route + LinkedIn search route
- Model in current use: `claude-sonnet-4-6`
- LinkedIn route uses `web_search_20250305`

### ZoomInfo

- JSON:API endpoints for company/contact search + enrich
- Company LinkedIn uses `socialMediaUrls`; contact LinkedIn uses `externalUrls`

### Common Room

- Members endpoint is live (email and LinkedIn lookups)
- Prospector route is still a stub (`/api/enrich/prospector`)

### HubSpot

- Private app token auth
- List creation/reuse, create/update batching, and membership adds are implemented
- Folder listing handles multiple response shapes
- `GET /api/hubspot/properties/lead-source` — fetches live enum options for `lead_source__deal_source` from HubSpot (`GET /crm/v3/properties/contacts/lead_source__deal_source`); used by `PrePushScreen` to populate the Lead Source dropdown dynamically; falls back to hardcoded `LEAD_SOURCE_OPTIONS` if the fetch fails

---

## 9) Security + Configuration

Key environment variables in active use:

- `ANTHROPIC_API_KEY`
- `ZOOMINFO_CLIENT_ID`
- `ZOOMINFO_CLIENT_SECRET`
- `COMMON_ROOM_API_KEY`
- `HUBSPOT_ACCESS_TOKEN`
- `NEXT_PUBLIC_HUBSPOT_PORTAL_ID`
- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`
- `QSTASH_TOKEN`
- `QSTASH_CURRENT_SIGNING_KEY`
- `QSTASH_NEXT_SIGNING_KEY`
- `NEXT_PUBLIC_APP_URL`
- `APP_PASSWORD`
- `INTERNAL_API_SECRET`

Auth model:

- Shared-password login API + `realm-auth` cookie (SHA-256 of `APP_PASSWORD`)
- Route protection in `src/proxy.ts` (matcher excludes `_next/static`, `_next/image`, `favicon.ico`):
  1. Public paths: `/login`, `/api/auth/login`, `/api/auth/session`
  2. `x-realm-internal-auth` header equals `INTERNAL_API_SECRET` → allow (checked **before** cookie)
  3. Valid `realm-auth` cookie → allow
  4. Else redirect to `/login`

QStash → `/api/jobs/process`:

- Production: `verifySignatureAppRouter(handler)` (Upstash signing keys); no cookie required.
- Development: direct `handler`; `queueJobChunk` in `src/lib/jobs/qstash.ts` sends `x-realm-internal-auth` when `INTERNAL_API_SECRET` is set (so `proxy.ts` allows the request).
- Production `publishJSON` also attaches `x-realm-internal-auth` when `INTERNAL_API_SECRET` is set (in addition to QStash signature).

Internal `x-realm-internal-auth` is also used by the jobs worker when calling `/api/enrich/linkedin-search` server-to-server.

---

## 10) Known Limitations

- Common Room Prospector is not integrated (`/api/enrich/prospector` stub).
- Large lists remain expensive/slow due to linear external-call volume (enrichment), even with bulk background processing.
- `CostEstimateScreen` is not shown before bulk background jobs start.
- Contact push pre-match is email-centric; CRM records without a matching email may duplicate unless HubSpot rejects create.
- Company push without domain still uses sequential name-based lookup for a subset of rows.
- No structured timing logs for HubSpot push matching vs write phases.
