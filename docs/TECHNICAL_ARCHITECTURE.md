# Technical Architecture — Realm Enrichment Tool

This document describes the current implementation only (no planned/future behavior).

---

## 1) Project Overview

The app is a Next.js workflow for enriching CSV/XLSX uploads (companies or contacts) and pushing approved rows to HubSpot static lists.

Import modes:

- `event`: browser-driven enrichment
- `bulk`: background job flow with status polling

Deployment assumptions:

- Vercel App Router
- Upstash Redis/QStash
- Shared-password route protection via `src/proxy.ts`

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

`src/app/page.tsx` is a client orchestrator (~640 lines) that coordinates state and step routing.

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
- Secondary button styles and micro-typography are fully normalized to tokenized CSS variables across all UI surfaces as of SPEC-7.

Session storage keys in active use:

- `realm-enrichment-session-v1`
- `realm-bulk-job-id`
- `realm-enrichment-manual-edits-v1`

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

Main stream endpoint:

- `POST /api/hubspot/push` (NDJSON: `list_created` -> `progress` -> `done` or `error`)

Deduplication/matching in `push-handler.ts`:

- Contacts: dedupe by normalized resolved email, then match by email, fallback by exact name+company
- Companies: dedupe by normalized domain, then additional name+state pass

Associations:

- Contact-to-company associations are written in batch using association type `279`

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

Domain normalization:

- Shared helper: `src/lib/utils/domain.ts`
- Domain normalization is only consolidated where behavior is equivalent.
- When behavior differs for correctness-sensitive paths, local normalization variants are intentionally preserved.

Caching:

- Redis cache keys include company/contact enrichment caches plus job state/row shards and manual edit keys.
- Manual edits TTL and batch hydration are active in current flow.

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

- Shared-password login API + `realm-auth` cookie
- Route protection in `src/proxy.ts`
- Internal bypass via `x-realm-internal-auth` + `INTERNAL_API_SECRET`

---

## 10) Known Limitations

- Common Room Prospector is not integrated.
- Large lists remain expensive/slow due to linear external-call volume.
