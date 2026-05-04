# Technical Architecture — Realm Enrichment Tool

This document describes how the application is structured, how enrichment and integrations work, and what operators should know about limits and configuration. It is aimed at developers onboarding to the codebase.

---

## 1. Project Overview

### What it does

The app is a **Next.js** single-page workflow for enrichment of CSV/Excel uploads containing **companies** or **contacts**. Users begin in a starter mode picker, then move through upload, context, enrichment, review, and HubSpot push. The product supports two import modes:

- **Marketing Event List (`event`)**: browser-driven enrichment flow.
- **Bulk Import (`bulk`)**: background job flow with job start + status polling.

### Who uses it & deployment

The product is an internal operations tool with **shared-password access control** enforced by `src/proxy.ts` and login/auth API routes (see §8). It is **intended for deployment on Vercel** (uses Upstash services for queue/cache, `maxDuration` on serverless routes, and standard Next.js App Router patterns). The repository does not pin a single customer-facing URL; configure the deployment target in Vercel (or run locally).

### Tech stack (exact versions from `package.json`)

| Layer | Version / package |
|--------|-------------------|
| **Next.js** | `16.2.4` |
| **React** | `19.2.4` |
| **TypeScript** | `^5` (5.x) |
| **Tailwind CSS** | `^4` (`@tailwindcss/postcss` ^4) |
| **Anthropic SDK** | `@anthropic-ai/sdk` `^0.90.0` |
| **Upstash Redis** | `@upstash/redis` `^1.34.0` |
| **Upstash QStash** | `@upstash/qstash` `^2.10.1` (bulk job callbacks) |
| **ESLint** | `eslint` `^9` + `eslint-config-next` `16.2.4` |

### Repository structure (key directories)

```
src/
  app/
    page.tsx              # Main wizard UI + orchestration (enrichment order, session persistence)
    layout.tsx
    api/
      auth/
        login/route.ts      # Password login -> sets realm-auth cookie
        logout/route.ts     # Clears realm-auth cookie
      parse/route.ts      # CSV/XLSX upload → parsed segments
      enrich/
        ai/route.ts       # Anthropic batch + optional legacy NDJSON stream
        zoominfo/route.ts # ZoomInfo + Common Room + Prospector stub (NDJSON out)
        linkedin-search/route.ts  # Anthropic + web_search for missing LinkedIn URLs
        prospector/route.ts       # Stub: returns { results: [] }
      hubspot/
        precheck/route.ts # HubSpot existing-record pre-check before ZoomInfo
        push/route.ts     # NDJSON HubSpot push stream
        folders/route.ts  # GET list folders for PrePush UI
      manual-edits/route.ts  # GET/POST: KV-backed field overrides for review (stableKey + listType)
      jobs/
        start/route.ts                # Create bulk job + queue processing
        process/route.ts              # Worker endpoint for chunk processing
        [jobId]/status/route.ts       # Pollable bulk job status
        [jobId]/rows/route.ts         # Completed enriched rows fetch
        [jobId]/resume/route.ts       # Resume/requeue failed bulk job
        [jobId]/cancel/route.ts       # Cancel bulk job
      zoominfo-lookup/route.ts    # Dev-only ZoomInfo diagnostic (403 in production)
  app/login/page.tsx      # Password entry page (Suspense-wrapped search params)
  proxy.ts                # Route protection + internal API bypass header
  components/             # UI only (ReviewTable, PrePushScreen, SuccessScreen, etc.)
    StarterScreen.tsx
    CostEstimateScreen.tsx
    ReasoningTooltip.tsx   # Shared hover + click-to-pin tooltip (review copy, header help)
  lib/
    enrichment/           # ai-enricher, zoominfo-enricher, merger, commonroom-enricher
    hubspot/              # CRM API helpers (companies, contacts, lists, push-handler, push-result types)
    jobs/                 # qstash.ts — QStash publisher for `/api/jobs/process`
    parsers/              # CSV, Excel, column mapping
    cache/enrichment-cache.ts   # Upstash Redis keys for AI/ZoomInfo cache
    zoominfo/auth.ts      # OAuth token for ZoomInfo Data API
    utils/types.ts        # Shared TypeScript types
    utils/sanitize.ts     # Review ingest sanitization
```

---

## 2. Architecture Overview

### Wizard flow (UI vs internal steps)

**Breadcrumb labels** (`NAV_STEPS` in `src/app/page.tsx`): Upload → Event Context → Enrichment → Review & Edit → Import Settings → Complete.

**Internal `Step` union** (finer-grained): `"starter"` | `"upload"` | `"context"` | `"enriching"` | `"verifying"` | `"costestimate"` | `"prereview"` | `"enriched"` | `"prepush"` | `"pushing"` | `"complete"`.

Mapping:

| User-facing step | Internal steps |
|------------------|----------------|
| Mode select / start | `starter` |
| Upload | `upload` |
| Event Context | `context` |
| Enrichment | `enriching` (AI/bulk job start), optional `costestimate` (bulk), then `verifying` (event verify path) |
| Review gate / hygiene checks | `prereview` |
| Review & Edit | `enriched` |
| Import Settings | `prepush` |
| Complete | `pushing` (HubSpot NDJSON) then `complete` |

### Session persistence

- **Key:** `realm-enrichment-session-v1` (`SESSION_STORAGE_KEY` in `page.tsx`).
- **Stored:** `step`, enriched rows snapshot, approved rows, `eventContext`, `listType`, `parseResult`.
- **Bulk job key:** `realm-bulk-job-id` (`BULK_JOB_SESSION_KEY`) stores active bulk job ID for resume/polling.
- **Manual LinkedIn restore (session bridge):** `realm-enrichment-manual-edits-v1` (`MANUAL_EDITS_SESSION_KEY`). When the operator returns to **Review & Edit**, a one-shot effect can merge saved per-row LinkedIn URLs (keyed by stable key: normalized **domain** or **resolved email**) from this key into `reviewRows`, then **removes** the key. Long-lived overrides live in **Redis** via `/api/manual-edits` (see below), not only in session storage.
- **Purpose:** Refresh-safe progress across the wizard; cleared when starting a new import (see `sessionStorage.removeItem` usage in `page.tsx`).

### Bulk job flow (bulk mode)

- **Start:** `startBulkJob()` calls `POST /api/jobs/start` from `context` step.
- **Progress:** UI enters `enriching` and polls `GET /api/jobs/[jobId]/status` every 5 seconds.
- **Completion:** on `status === "complete"`, client loads rows from `GET /api/jobs/[jobId]/rows`, builds an **enrichment summary** from the loaded rows and `BulkJobState` (totals, HubSpot found count, credits, AI LinkedIn count, elapsed minutes), then `advanceToReview` **always** navigates to `prereview` before `enriched` (event and bulk both).
- **Large uploads in KV:** raw parsed rows for a job are stored under `job:{jobId}:raw` when the JSON payload is under **~800 KiB**; larger uploads are **sharded** across `job:{jobId}:raw:{shardIndex}` with metadata `job:{jobId}:raw:meta` (`setJobRawRows` / `getJobRawRows` in `enrichment-cache.ts`) so a single Redis value is not oversized.
- **Completion summary metadata:** bulk job state now includes `linkedInFromAiCount` (rows where `linkedinSource === "ai_search"`), shown in `BulkProgressScreen`.
- **Failure/cancel:** client returns to `context` and surfaces `state.error` (or cancellation copy).
- **Diagnostics:** failed job-start responses log status + body in `console.error("[startBulkJob] failed:", res.status, errBody)`.

### NDJSON streaming — where and why

**1) ZoomInfo verify — `POST /api/enrich/zoominfo`**

- **Content-Type:** `application/x-ndjson; charset=utf-8`.
- **Events:** `progress` (row range + optional `detail`), then `done` with `{ type: "done", listType, rows, enrichedCount, cachedCount, commonRoomHits, creditsUsed }`, or `error` (optional `zoomInfoAuthFailure`).
- **Why:** Serverless **`export const maxDuration = 9`** (seconds) on this route. Streaming lets the client show progress while work is in flight; the response still completes within one invocation.

**2) HubSpot push — `POST /api/hubspot/push`**

- NDJSON event order: **`list_created`** (`listId`, `listName`, optional `folderId`) → **`progress`** (`current`, `total`, cumulative across create/update chunks) → **`done`** with create/update counts, per-row `errors`, `listId`, `listName`, `totalPushed`, optional `folderId` (payload shape in `HubSpotPushDonePayload`, `src/lib/hubspot/push-result.ts`). **`error`** line on fatal failure.
- Client: `consumePushNdjson` in `page.tsx` parses lines incrementally; optional callback on `list_created` for early list snapshot (e.g. logging / UI).
- **Why:** Long-running push over many rows; same timeout considerations.

**3) AI enrichment — `POST /api/enrich/ai`**

- The **primary client path in `page.tsx` uses batched JSON** (`mode: "batch"`, `batchIndex`, etc.) — not NDJSON — so each batch finishes within `maxDuration` (`9` in `ai/route.ts`).
- The route **still exposes** a **ReadableStream** NDJSON mode when **not** in batch mode (legacy `enrichRowsWithProgress` loop) for the same timeout/progress reasons.

### Chunked ZoomInfo requests (Batch 1)

- **Constant:** `ZOOM_VERIFY_CHUNK_SIZE = 15` in `page.tsx`.
- **Client:** Loops `Math.ceil(totalRows / 15)` POSTs to `/api/enrich/zoominfo`, each body includes `chunkIndex`, `chunkSize: 15`, `totalRows`, `nonHighTotal`, `nonHighPrefixCount`, and a **slice** of rows.
- **Server:** Processes only the slice; progress `start`/`end`/`total` use **global** row indices so the UI does not “reset” per chunk.
- **Why 15:** With **`delayBetweenZoomInfoCalls(200)`** (200 ms between rows inside a chunk in `zoominfo/route.ts`) and external HTTP calls, keeping each invocation under **~9s** is feasible; monolithic “all rows in one request” timed out on large lists.

### Pre-Review behavior (current)

- `advanceToReview` in `src/app/page.tsx` loads a **`manualEdits` map** from `GET /api/manual-edits` (one request per distinct **stable key**: normalized company **domain** or contact **resolved email**), then calls `finalizeRowsForReview` with `{ importMode, manualEdits }` and **always** sets the wizard step to `prereview` (never jumps straight to `enriched`). For each row, `finalizeRowsForReview` **merges** `manualEdits.get(stableKey)` onto the row object **before** `computeReviewBucket`, so operator-corrected fields (e.g. LinkedIn) affect buckets. It still **backfills `identityConfidence` from `confidenceScore`** when identity is missing or empty and `confidenceScore` is set — so **bulk job rows** loaded from KV (which never pass through `getCachedCompany`) still bucket correctly for **high** / **medium** trusted rules.
- **Bulk worker** (`process/route.ts`) passes the same style of `manualEdits` map when finalizing rows for consistency across chunks.
- `PreReviewGate` receives optional `enrichmentSummary` (non-null in **event** and **bulk** flows when the parent sets it). The **enrichment complete** card renders only when `enrichmentSummary` is present.
- **International & government** and **duplicate** blocks inside the gate are still **threshold-driven** per `PreReviewGate` (`PREREVIEW_INTL_GOV_THRESHOLD`, `PREREVIEW_DUPLICATE_THRESHOLD` in `prereview.ts`); the summary card is independent of those sections.
- `shouldOpenPreReviewGate` in `prereview.ts` remains available but is **not** used to choose between `prereview` and `enriched` in `page.tsx` (routing is always pre-review first).
- **International heuristics (`isInternationalCompany` in `prereview.ts`):** besides **state** text, **non‑US TLD**, **Gartner-style name suffixes**, and **raw input word** patterns (space-prefixed tokens such as ` canada`, ` uk`, …), the **original CSV/Excel cell** (`rawInput`) is also scanned for additional region tokens (e.g. Korea, Israel, Singapore, Mexico, Dubai, Japan, China, Taiwan) and **dash-suffix** forms (e.g. `-kr`, `-sg`, `-mx`). Deliberately **omitted** as ambiguous: `-il` / `-in` (Illinois / Indiana).

## 3. Enrichment Pipeline — Companies

Order on the client (`runEnrichment` in `page.tsx`, event mode):

1. **AI enrichment** (batched `POST /api/enrich/ai`)
2. **ZoomInfo verify** (`runZoomVerify` → chunked `POST /api/enrich/zoominfo`)
3. **Company LinkedIn fallback** (`runCompanyLinkedInLookupPass` → `POST /api/enrich/linkedin-search` with `{ company }` when `linkedinUrl` still empty)

### AI enrichment (companies)

- **Batch size:** `ENRICHMENT_BATCH_SIZE = 3` (`ai-enricher.ts`).
- **Model:** `COMPANY_MODEL = "claude-sonnet-4-6"`.
- **Transport:** `runClaudeWithWebSearch` uses `client.messages.create` — **no tools** in code (plain completion); prompts instruct web-grounded behavior in text.
- **Pre-populated rows:** `isCompleteCompanyRow` requires `resolvedName`, `domain`, `state`, and employee string on the raw row — those rows skip AI and use `mapPresetCompanyRow` (`confidenceScore: "high"`, `enrichedByAI: false`).
- **Output:** `EnrichedCompany` with `confidenceScore` normalized from AI (`normalizeConfidence`), `needsReview` false only for `"high"`.

### ZoomInfo — companies

**URLs (from `zoominfo-enricher.ts`):**

- Search: `POST https://api.zoominfo.com/gtm/data/v1/companies/search`
- Enrich: `POST https://api.zoominfo.com/gtm/data/v1/companies/enrich`

**JSON:API-style bodies:**

```json
{
  "data": {
    "type": "CompanySearch",
    "attributes": {
      "companyName": "<rawInput from row>",
      "companyWebsite": "<domain when present>"
    }
  }
}
```

```json
{
  "data": {
    "type": "CompanyEnrich",
    "attributes": {
      "matchCompanyInput": [{ "companyId": "<id from search>" }],
      "outputFields": [
        "id", "name", "website", "socialMediaUrls", "employeeCount",
        "state", "revenue", "industries", "description", "city"
      ]
    }
  }
}
```

**Headers:** `Content-Type: application/vnd.api+json`, `Accept: application/vnd.api+json`, `Authorization: Bearer <token>`.

**LinkedIn URL:** Not a single `linkedInUrl` field on company enrich — code uses **`socialMediaUrls`** (array of objects with `url`) and `linkedInUrlFromSocialMediaUrls` picks the first URL containing `linkedin.com`.

**Industry:** Response uses **`industries`** (array); first element’s `name` is read — **not** a top-level `industry` string (historical naming pitfall is documented in §7).

**Credits/cache accounting (app-side):**

- `enrichedCount`: rows that triggered a net-new ZoomInfo enrich.
- `cachedCount`: rows served from enrichment cache (`enrichedByZoomInfo` cache hits).
- `creditsUsed`: currently set equal to `enrichedCount` in the `done` event payload.

### Merge — companies (`mergeEnrichedCompany` in `merger.ts`)

- Uses `originalConfidence` / AI `confidenceScore` to choose mode:
  - **`high`:** **fill gaps** — prefer AI values first for several fields, then ZoomInfo/Common Room for empty slots.
  - **Non-high:** **ZoomInfo wins** on conflicts for key fields (`linkedinUrl`, `state`, `domain`, `resolvedName`, etc.).

### Company LinkedIn fallback

- **When:** `needsCompanyLinkedInLookup` → no non-empty `linkedinUrl` after prior steps.
- **API:** `POST /api/enrich/linkedin-search` with `{ company: { … } }`.
- **Implementation:** `claude-sonnet-4-6`, **`web_search_20250305`** tool (`max_uses: 2`), user message built from resolved name + domain — see `handleCompanyLinkedInSearch` in `linkedin-search/route.ts`.
- **Cost:** One Anthropic **Messages** request per missing company (plus tool usage billed by Anthropic).

### Fields: UI vs HubSpot (companies)

- **Review UI** (`ReviewTable`, `EnrichedCompany`): `resolvedName`, `domain`, `state`, `linkedinUrl`, employees, revenue, industry, description, city, etc.
- **HubSpot** (`companyProperties` in `companies.ts`): maps to CRM internal names including `name`, `domain`, `website`, `state`, `linkedin_company_page`, `numberofemployees`, `annualrevenue` (stored as string; app sends `revenue * 1000`), `industry`, `description`, `city`, optional `lead_source`, `lead_source_description`, `notes` from push extras.

---

## 4. Enrichment Pipeline — Contacts

Order on the client (event mode):

1. **AI enrichment** (batched `/api/enrich/ai`)
2. **ZoomInfo verify** (chunked `/api/enrich/zoominfo` — includes Common Room + Prospector stub + ZoomInfo)
3. **LinkedIn fallback** (`runLinkedInLookupPass` → `/api/enrich/linkedin-search` with `{ contact }` when `linkedinUrl` still empty)

### Pre-populated contacts (skip main AI prompt)

- **`isFullyPopulatedContactRow`:** requires non-empty `firstName`, `lastName`, `email`, `company` (or `resolvedCompany`), `title`, and `companyDomain`.
- **Behavior:** `enrichSingleContact` short-circuits to `mapPresetContactRow` with `confidenceScore: "high"`; if LinkedIn still missing, **`findLinkedInOnlyForContact`** runs (Claude JSON-only prompt — **no** `web_search` tool in that helper).
- **Batch cache path:** `resolveContactBatchFromKv` also skips full AI for these rows (cache hit or preset mapping).

### AI enrichment (contacts)

- Same batch size **3**, same model **`claude-sonnet-4-6`**.
- **Context:** `EventContext` requires **`audienceLevel`** for contacts (validated in `ai/route.ts` when `listType === "contacts"`).
- **Output:** `mapContactAiToEnriched` — CSV email stays canonical; `resolvedEmail` uses raw CSV email.

### Common Room (`enrichContactWithCommonRoom` in `commonroom-enricher.ts`)

- **Base URL:** `https://api.commonroom.io/community/v1/members`
- **Auth:** `Authorization: Bearer ${process.env.COMMON_ROOM_API_KEY}`
- **Order:** If work email (non-personal), `?email=<encoded>`; if still no members and `linkedinUrl` exists on contact, `?linkedin=<handle>` (path stripped).
- **Parsing:** `parseMembersJson` expects an **array**; member `linkedin` may be **array or string** — code normalizes.
- **Prospector:** Not used for real data — `POST /api/enrich/prospector` returns `{ results: [] }` (stub; external REST not available).

### ZoomInfo — contacts

**URLs:**

- `POST https://api.zoominfo.com/gtm/data/v1/contacts/search`
- `POST https://api.zoominfo.com/gtm/data/v1/contacts/enrich`

**Search (no work email path):** `ContactSearch` with `firstName`, `lastName`, optional `emailAddress`, optional `companyName`.

**Enrich body pattern:**

```json
{
  "data": {
    "type": "ContactEnrich",
    "attributes": {
      "matchPersonInput": [
        { "emailAddress": "<work email>" }
      ]
      // OR { "personId": "<from search>" }
      ,
      "outputFields": [
        "id", "firstName", "lastName", "jobTitle", "externalUrls",
        "state", "city", "companyName", "companyId", "companyPrimaryIndustry",
        "companyEmployeeCount", "companyWebsite", "managementLevel", "jobFunction",
        "phone", "mobilePhone", "email", "contactAccuracyScore"
      ]
    }
  }
}
```

**LinkedIn on contact:** **`externalUrls`** array — find first `{ url }` containing `linkedin.com` (not a dedicated `linkedInUrl` attribute in this output set).

**High confidence + missing LinkedIn:** Route sets `linkedinOnlyHigh` when `confidenceScore === "high"` && no `linkedinUrl`. It still runs Common Room / Prospector / **`enrichContactWithZoomInfo`** when `stillNeedsEnrichment` (CR + prospector did not fill enough). **`pickStr` / `pickPhone` in `enrichContactWithZoomInfo`** **do not overwrite** existing high-confidence contact fields when ZoomInfo returns data (gap-fill semantics).

**Silent ZoomInfo → contact fields (HubSpot-only in UI):** `ziManagementLevel`, `ziJobFunction`, `ziCompanyEmployeeCount`, `ziCompanyPrimaryIndustry`, `ziCompanyWebsite` on `EnrichedContact` (see `types.ts`); merged in `mergeEnrichedContact` and mapped in `contacts.ts` to `job_level`, `job_function`, `numemployees`, `industry`, `website` when appropriate.

### LinkedIn web search fallback (after verify)

- **When:** `needsLinkedInLookup` (empty `linkedinUrl`) after step 2.
- **API:** `POST /api/enrich/linkedin-search` with `{ contact }`, model **`claude-sonnet-4-6`**, **`web_search`** tool.

### Merge — contacts (`mergeEnrichedContact`)

Priority order for display fields: **Common Room / Prospector** first for `linkedinUrl`, `resolvedCompany`, `title`, `location`; then AI; then ZoomInfo. `resolvedEmail` is **always** the CSV `rawEmail`. ZI-only HubSpot fields merged as in types above.

### LinkedIn source tagging and fallback

- Event-mode LinkedIn pass (`runLinkedInLookupPass` in `page.tsx`) sets:
  - `linkedinUrl`
  - `linkedinSource: "ai_search"`
  - `enrichedByAI: true`
- Bulk linkedIn phase (`runLinkedInBatch` in `api/jobs/process/route.ts`) sets the same fields.
- Finalization fallback now normalizes any row with a non-empty `linkedinUrl` and empty `linkedinSource` to `"ai_search"` before persisting/review handoff.
- **Review bucket:** `computeReviewBucket` does **not** downgrade a row to **Needs review** solely because `linkedinSource === "ai_search"`; if other trusted criteria are met, the row can be **Trusted**. The **Review & Edit** UI still surfaces a **tooltip warning** for trusted rows whose LinkedIn came from web search, and when the **Show: Trusted** filter is active, those rows are **sorted to the top** for quick review.

## 5. External API Integrations

### Anthropic

| Topic | Detail |
|--------|--------|
| **Auth** | `ANTHROPIC_API_KEY` — server-only; read in `ai/route.ts` and `linkedin-search/route.ts`. |
| **Chat Completions** | SDK `Anthropic` → `messages.create` (see `runClaudeWithWebSearch` in `ai-enricher.ts`). |
| **HTTP (LinkedIn route)** | `fetch("https://api.anthropic.com/v1/messages", …)` with `x-api-key`, `anthropic-version: "2023-06-01"`. |
| **Models** | `claude-sonnet-4-6` (companies, contacts batch, LinkedIn search). |
| **Web search tool** | Only in **`linkedin-search/route.ts`**: `tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 2 }]`. |
| **Batch size** | **3** rows per AI API call in batch mode — aligns with `maxDuration = 9` on `ai/route.ts`. |
| **JSON safety** | `parseJsonArray` / `parseJsonObject` / fence stripping; batch parse failures log **first 500 chars** of raw text (`console.error`) — may contain PII in edge cases. |

### ZoomInfo

| Topic | Detail |
|--------|--------|
| **Auth** | OAuth2 **client credentials** — `POST https://api.zoominfo.com/gtm/oauth/v1/token`, `grant_type=client_credentials`, `Authorization: Basic base64(clientId:clientSecret)`. Token cached in-process (`auth.ts`) with refresh ~60s before expiry. |
| **API style** | **JSON:API** — `Content-Type: application/vnd.api+json`, requests use `data.type`, `data.attributes`. |
| **Company enrich** | `matchCompanyInput: [{ companyId }]` — **not** raw name on enrich (ID comes from search). |
| **Contact enrich** | `matchPersonInput: [{ emailAddress }] **or** [{ personId }]`. |
| **LinkedIn** | Companies: **`socialMediaUrls`**. Contacts: **`externalUrls`**. No reliance on a ZoomInfo field literally named `linkedInUrl` in the **`outputFields`** lists in code. |
| **Industry** | Use **`industries`** (array) on company enrich; code reads `industries[0].name`. |
| **Errors** | Non-OK responses return empty partials in enrichers; `401` triggers token invalidate + retry in `zoomInfoFetch`. |

### Common Room

| Topic | Detail |
|--------|--------|
| **Auth** | `COMMON_ROOM_API_KEY` — Bearer token. |
| **Endpoints used** | `GET https://api.commonroom.io/community/v1/members?email=…` and `…?linkedin=…`. |
| **Prospector** | **Not integrated** — app calls local stub `POST /api/enrich/prospector` which returns `{ results: [] }`; real Common Room Prospector REST was not available (historically 401 / pending product access). |
| **Parsing** | Members JSON parsed as array; `linkedin` field may be `string | string[]` — normalized before use. |

### HubSpot

| Topic | Detail |
|--------|--------|
| **Auth** | `HUBSPOT_ACCESS_TOKEN` — **Private App** token (server-only). `hubspotFetch` in `http.ts` uses `https://api.hubapi.com` + `Authorization: Bearer …`. |
| **Companies — properties written** | `name`, `domain`, `website`, `state`, `linkedin_company_page`, `numberofemployees`, `annualrevenue`, `industry`, `description`, `city`, optional `lead_source`, `lead_source_description`, `notes` (see `companies.ts`). |
| **Contacts — properties written** | `firstname`, `lastname`, `email`, `jobtitle`, `company`, `ds_liprofile`, `state`, `phone`, `lead_source__deal_source`, `lead_source_description`, `hs_content_membership_notes`, `job_level`, `job_function`, `numemployees`, `industry`, `website`, `hs_additional_emails` (see `contacts.ts`). **`website`** from ZoomInfo company URL is sent only when **`companyDomain`** is empty (avoids overwriting a known company domain). **`hs_additional_emails`** is fill-empty-only when `personalEmail` differs from canonical `resolvedEmail`. |
| **Contact pre-check (search)** | `batchCheckContactsInHubSpot` uses `POST /crm/v3/objects/contacts/search` with `IN` on normalized emails (chunks of **100**), properties `CONTACT_PRECHECK_PROPERTIES` (`email`, `jobtitle`, `company`, `ds_liprofile`, `state`, `phone`, `job_level`, `job_function`, `hs_additional_emails`), pagination via `after`, sort `hs_lastmodifieddate` descending. **`hubspotSearchWithBackoff`** retries **429** at **1s** then **3s**. |
| **Push — approved deduplication** | Before create/update, `deduplicateApproved` in `push-handler.ts`: **contacts** — one row per normalized **resolved email**; **companies** — one per normalized **domain**, then a second pass drops duplicate **`resolvedName` + `state`** pairs (case-insensitive). |
| **Push — contact CRM match** | Rows without `hubspotId`: **`batchFindContactsByEmail`** (same search as precheck, **100** emails per chunk, **200 ms** between chunks) maps email → id. Remaining unknowns: sequential **`findContactByNameAndCompany`** (exact `firstname` + `lastname` + `company`, `limit: 2` → require exactly one result), **100 ms** delay between attempts. Then **batch update** known matches, **batch create** the rest. |
| **Push — company CRM match** | **`batchFindCompaniesByDomain`** on unknowns without `hubspotId`; known `hubspotId` and domain matches go to update; remainder to create. |
| **Lists** | Create: `POST /crm/v3/lists` with `name`, `objectTypeId` (`0-2` companies, `0-1` contacts), `processingType: "MANUAL"`, optional `folderId` (numeric string sent as number when it parses cleanly). If create fails with **“already exist”**, **`GET /crm/v3/lists/object-type-id/{objectTypeId}/name/{name}`** resolves the existing list id and push reuses it. Membership: `PUT /crm/v3/lists/{listId}/memberships/add` with JSON array of **HubSpot record IDs** from create/update (not import row UUIDs). |
| **Batch create — duplicates** | **HTTP-level:** If `POST .../batch/create` fails with body/error text matching **`already exists`**, contacts path **retries each row** with single `POST /crm/v3/objects/contacts`; duplicates parsed via **`parseHubSpotDuplicateExistingId`** (`Contact|Company already exists. Existing ID: …`) feed **`batchUpdateContacts`** (deduped by HubSpot id). **Batch JSON 200 with gaps:** per-index results without `id` use **`errorMessageForBatchIndex`**; same **Existing ID** pattern triggers update. Companies mirror this pattern in `companies.ts`. Batch chunks use size **100** and **200 ms** cooldown between chunks (`HUBSPOT_BATCH_COOLDOWN_MS`). |
| **Import Settings — contacts only** | Push JSON may include **`useExistingLeadSource`** and **`useExistingLeadSourceDescription`** (booleans). When true, **`contactPushExtras`** prefers each row’s CSV **`leadSource` / `leadSourceDescription`** over the global Import Settings strings (`push-handler.ts`). |
| **Folders** | `list-folders.ts` calls `GET /crm/v3/lists/folders?objectTypeId=0-1` and `GET /crm/v3/lists/folders?objectTypeId=0-2`, merges and dedupes by folder id, and supports nested `folder.childNodes` response shapes. UI uses folder id on list create in `push-handler` (`createStaticListForPush`). |
| **Import Settings folder UX** | `PrePushScreen` uses a placeholder `Select a folder` (disabled), then explicit `No Folder`, then live folders. If placeholder or `No Folder` is chosen, `folderId` is omitted in push payload. |
| **Success screen list URL** | Uses HubSpot object-list path: `https://app.hubspot.com/contacts/{portalId}/objectLists/{listId}/filters`. |
| **Success screen push errors** | `SuccessScreen` accepts optional `rowsById: Map<rowId, { displayName }>` from approved rows so per-row error lines show a **name** (contact: `firstName` + `lastName`; company: `resolvedName`) instead of internal UUIDs; unknown ids (e.g. synthetic `membership`) still show the raw id. |

---

## 6. Cost Model

### ZoomInfo

- **App accounting:** `enrichedCount` / `creditsUsed` in NDJSON `done` count successful **`enrichedByZoomInfo`** enrichments in the verify route (companies: per `enrichCompanyWithZoomInfo`; contacts: per `enrichContactWithZoomInfo` when the ZI path runs and returns enrichment).
- **Event mode UI:** ZoomInfo summary text is no longer rendered in `Review & Edit`; summary appears in pre-review enrichment summary context.
- **Operational notes (not hard-coded):** Business expectation is **~1 credit per successful contact/company enrich** on the ZoomInfo side; **search** steps are not counted in `creditsUsed`. Allocation and totals (e.g. **2,000 credits**, **6–70 credits per typical run**, sustainability ~**50 runs**) are **operational** — confirm in your ZoomInfo contract.
- **Planning benchmark (1,550-row run):** **~930–1,240 credits** (60–80% match-rate assumption).

### Anthropic

- **Billed per token** (input + output); exact pricing is account-specific.
- **AI step:** Batches of **3** rows per `messages.create` call (companies or contacts).
- **LinkedIn route:** **One** `/v1/messages` call per company/contact row that still needs a URL, with **web_search** tool — higher cost than plain completion.
- **Cost estimate model used in bulk cost screen:** low `((needEnrichment / 3) * 0.015)`, high `((needEnrichment / 3) * 0.015 + (needEnrichment * 0.30 * 0.02))`.
- **Planning benchmark (1,550-row run):** **~$10–20**.

### Upstash Redis cache (`@upstash/redis`)

- **TTL:** `60 * 60 * 24 * 30` seconds (**30 days**) for both company and contact cache keys in `enrichment-cache.ts`.
- **Keys:** `company:<normalized_name>`, `contact:<normalized_email>`, bulk job `job:{jobId}:…` (meta, rows, raw / raw shards), **`manual_edits:{listType}:{stableKey}`** (field-level overrides for review; **7-day** TTL, `MANUAL_EDITS_TTL` in `enrichment-cache.ts`).
- **Manual edits API:** `POST /api/manual-edits` body `{ stableKey, listType, field, value }` merges into the KV-stored **JSON object** for that stable key (`existing[field] = value`). `GET ?stableKey=&listType=` returns `{ edits }`. `ReviewTable` POSTs on cell edits; `advanceToReview` and bulk **`process`** load edits for finalization.
- **Read-time migrations — `getCachedCompany` (in-memory on cache hit; no write-back to KV):**
  - If LinkedIn URL is set but `linkedinSource` is empty, set source to `zoominfo` vs `hubspot` from `enrichedByZoomInfo`.
  - If ZoomInfo–like fields are present but `enrichedByZoomInfo` is false, infer ZoomInfo and optionally `domainSource: "zoominfo_verified"`.
  - If `identityConfidence` is missing, null, or empty string but `confidenceScore` is a non-empty string, set `identityConfidence` from `confidenceScore` for **older cached company payloads** that only stored `confidenceScore`.
- **Identity backfill at review time — `finalizeRowsForReview` in `prereview.ts`:** the same **identityConfidence ← confidenceScore** rule runs **on every finalization** (event and bulk) before `computeReviewBucket`, and the backfilled value is **stored on the row objects** returned to the UI. This covers **job row JSON** and any path where a row was not read through `getCachedCompany` first.
- **Connectivity probe:** `checkKvConnectivity()` writes/reads `__health_check__` and logs explicit misconfiguration/health errors (called once at module load in `enrich/zoominfo/route.ts`).
- **Operational note:** Heavy duplicate imports benefit from cache; sustained high QPS may require a paid Upstash plan (monitor Upstash dashboard and Redis usage limits).

### Vercel Functions

- **`maxDuration = 9`** on `ai/route.ts` and `enrich/zoominfo/route.ts` (and `linkedin-search/route.ts`).
- **Mitigation:** AI **batching** (3 rows), ZoomInfo **chunking** (event: 15 rows/request; bulk worker: 25 rows/chunk), **NDJSON** for long streams.
- **Scale:** Very large lists still spend linear time in **client-driven loops** (many HTTP round-trips). Architecture may need queues or background jobs if lists grow into the **hundreds+** per operator expectation.
- **Planning benchmark runtime (1,550-row run):** **~1–1.5 hours**, based on bulk estimate model (`~0.5 min / 25 ZoomInfo rows`, `~0.4 min / 3 AI rows`, plus LinkedIn fallback and fixed overhead).

### Tooltip and review-state rules (current)

- `computeReviewBucket` assigns buckets roughly as follows (see `prereview.ts` for the full decision tree). **`identityConfidence`** in these rules is the value **after** `finalizeRowsForReview` backfills it from `confidenceScore` when missing.
  - **Companies:** international / government → **excluded**; `identityConfidence` low or unresolved → **excluded**; empty domain after filters → **needs_review**; high/medium identity with HubSpot, ZoomInfo, or verified `domainSource` (or other trusted paths) → **trusted**; some high+`ai_guess`+domain cases → **trusted**; otherwise **needs_review**. **`linkedinSource === "ai_search"` is not, by itself, a needs-review rule** — a separate tooltip line calls out web-search LinkedIn on **trusted** rows.
  - **Contacts:** similar exclusions (e.g. incomplete / personal email paths); empty sanitized company on an otherwise passable contact → **needs_review**; trusted paths mirror verification + identity rules.
- **Review & Edit header counts** (Needs Review / Trusted / Excluded) follow **`row.status`** (`pending` / `approved` / `skipped`), not `reviewBucket`, so they reflect the operator’s current checkbox selections. Unchecking a **needs_review** row restores `status` to `pending` (not `skipped`); unchecking **trusted** or **excluded** sets `skipped`.
- **Select All / Deselect All** only change status for rows **visible** under the current **Show** filter; rows outside the filter are unchanged. **Select All** never sets **`reviewBucket === "excluded"`** rows to **approved** — their `status` stays as-is.
- **Trusted filter order:** with **Show: Trusted**, rows are sorted by `trustedSortTier` (amber-flag tier first, then clean trusted rows), with stable display-index ordering within each tier.
- **Row order lock during review:** `ReviewTable` snapshots row id order and keeps it stable during active editing. Row order refreshes on Show filter changes (and naturally on a new run/reload), preventing in-place jumps when editing fields or toggling approval.
- Review tooltip content in `ReviewTable` is reason-priority based (one primary reason per row) and includes targeted copy for trusted/needs-review/excluded states.
- LinkedIn column header `?` tooltip shows the full source-dot legend (HubSpot, ZoomInfo, Common Room, AI web search, manual) plus a final web-search verification note.
- **`ReasoningTooltip`** (`ReasoningTooltip.tsx`): shared **`?` / info** control with **hover** preview and **click-to-pin** (outside click dismisses); used for structured review copy and header help, with **fixed** positioning and viewport-aware above/below placement.

## 7. Known Limitations & Active Blockers

| Item | Notes |
|------|--------|
| **Common Room Prospector** | Stub route only; no live REST integration (see `prospector/route.ts` comment). |
| **ZoomInfo contact `linkedInUrl` field** | Product/plan may not expose a direct field; app uses **`externalUrls`** for LinkedIn. |
| **`industry` vs `industries`** | Company enrich expects **`industries`** array in API — code was aligned to that (see `zoominfo-enricher.ts`). |
| **Vercel 9s timeout** | Mitigated by chunking and batching; extreme row counts still risky without architectural changes. |
| **HubSpot success redirect / large lists** | Suspected **client parse** or payload issues on very large NDJSON pushes — **unresolved**; track separately from this doc. |

---

## 8. Security & Configuration

### Environment variables (server unless noted)

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Anthropic API (AI + LinkedIn search routes). **Server only.** |
| `ZOOMINFO_CLIENT_ID` / `ZOOMINFO_CLIENT_SECRET` | ZoomInfo OAuth. **Server only.** |
| `COMMON_ROOM_API_KEY` | Common Room members API. **Server only.** |
| `HUBSPOT_ACCESS_TOKEN` | HubSpot CRM API. **Server only.** |
| `NEXT_PUBLIC_HUBSPOT_PORTAL_ID` | Portal ID for building list URLs in **`SuccessScreen.tsx`** — **public** (not a secret). |
| `QSTASH_TOKEN` | Upstash QStash publish token for background job queueing. **Server only.** |
| `QSTASH_CURRENT_SIGNING_KEY` / `QSTASH_NEXT_SIGNING_KEY` | Upstash signature verification keys for `/api/jobs/process`. **Server only.** |
| `NEXT_PUBLIC_APP_URL` | Base URL used when publishing QStash callback URL (`/api/jobs/process`). Public env. |
| `APP_PASSWORD` | Shared app password used by `POST /api/auth/login`; cookie hash checked in `src/proxy.ts`. **Server only.** |
| `INTERNAL_API_SECRET` | Secret for server-to-server internal route calls through middleware (`x-realm-internal-auth`). **Server only.** |

Cache client initialization uses Upstash Redis with:

- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`

Both are required for cache read/write paths (`enrichment-cache.ts`, `linkedin-search/route.ts`).

### `zoominfo-lookup` diagnostic

- **`GET /api/zoominfo-lookup`**: Returns **403** `{ error: "Not available in production" }` when `process.env.NODE_ENV !== "development"`.

### Authentication

- Shared-password login is implemented via:
  - `POST /api/auth/login` (sets `realm-auth` httpOnly cookie on successful password check),
  - `POST /api/auth/logout` (clears cookie),
  - `src/proxy.ts` (redirects unauthenticated requests to `/login`, preserves `next` path).
- `src/proxy.ts` also supports server-to-server bypass with header `x-realm-internal-auth` matching `INTERNAL_API_SECRET` for internal calls that would otherwise be redirected by auth middleware.
- Public paths are limited to `/login` and `/api/auth/login`; all other app/API routes are protected by the proxy matcher except static/image/favicon paths.

### PII & logging (post–Batch 3)

- Prefer **status codes, IDs, lengths, booleans** — not names, emails, full bodies, or raw API snippets in `console.log`. **`console.error`** paths (e.g. Common Room) avoid PII by design.

---

## 9. Development Setup

### Run locally

```bash
npm install
npm run dev
```

Open the Next.js dev server (default `http://localhost:3000`).

### Required env for full enrichment

At minimum for a full path: `ANTHROPIC_API_KEY`, ZoomInfo pair, `HUBSPOT_ACCESS_TOKEN` for push, `COMMON_ROOM_API_KEY` if testing CR, and Upstash Redis env vars (`KV_REST_API_URL`, `KV_REST_API_TOKEN`) if testing cache.

### Testing without burning ZoomInfo credits

- **KV cache:** After successful ZoomInfo enrich, rows are cached and reused.
- **Companies:** cache key uses resolved company name fallback (`resolvedName ?? rawInput/rawName`), normalized to `company:<normalized_name>`.
- **Contacts:** cache key uses email, normalized to `contact:<normalized_email>`; contact verify route can skip ZoomInfo when cache has `enrichedByZoomInfo`.
- **Verify summary:** UI distinguishes net-new enrich (`enrichedCount`) vs cached rows (`cachedCount`) and reports `0 credits` when all served from cache.
- Re-use the **same** CSV company name / email to hit cache within TTL (**30 days**).

---

## Appendix — Example NDJSON Lines (ZoomInfo Verify)

```text
{"type":"progress","start":1,"end":1,"total":57,"detail":"ZoomInfo enriching 1 of 40 companies…"}
…
{"type":"done","listType":"companies","rows":[…],"enrichedCount":12,"cachedCount":5,"creditsUsed":12}
```

---

*Generated from the repository state at documentation time. When in doubt, prefer reading the cited source files.*
