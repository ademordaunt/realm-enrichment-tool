# Realm RevOps Enrichment Tool — Full Product Spec

**Version:** 1.2  
**Stack:** Next.js 16 (App Router), TypeScript, Tailwind CSS  
**Author:** Realm Security RevOps  
**Purpose:** Transform raw marketing event lead lists into HubSpot-ready records via AI enrichment, verification (ZoomInfo, Common Room, optional prospector), and a last-resort LinkedIn web search for contacts — with a human review step before any data hits the CRM.

---

## Table of Contents

1. [Overview & Goals](#overview)
2. [User Flow (End to End)](#user-flow)
3. [Data Models](#data-models)
4. [Phase 1 — Scaffold, Upload & Parse](#phase-1)
5. [Phase 2 — Event Context & AI Enrichment](#phase-2)
6. [Phase 3 — ZoomInfo & Common Room Enrichment](#phase-3)
7. [Phase 4 — Review & Edit Table](#phase-4)
8. [Phase 5 — HubSpot Push & Static List](#phase-5)
9. [API Reference](#api-reference)
10. [Environment Variables](#env-vars)
11. [File Structure](#file-structure)
12. [Error Handling & Edge Cases](#errors)
13. [Out of Scope (v1)](#out-of-scope)

---

## 1. Overview & Goals {#overview}

### The Problem
Marketing events produce raw lead lists with incomplete, inconsistent, or ambiguous data. A company list might contain "RUSH" or "HCSC" — vague names that require manual Googling to resolve. A contact list might have personal Gmail addresses with no company domain to match on. Today this work is done entirely by hand before importing to HubSpot.

### The Solution
A single-page internal web app that:
- Accepts a raw CSV/Excel lead list exactly as received from an event organizer
- Automatically detects whether it's a **company list** or **contact list**
- Enriches every record through a **sequential** pipeline (see §2): **AI (batched)** → **`POST /api/enrich/zoominfo`** (companies: ZoomInfo; contacts: Common Room → prospector → ZoomInfo) → **for contacts only**, **`POST /api/enrich/linkedin-search`** per row still missing LinkedIn
- Optionally uses **Vercel KV** to cache AI and ZoomInfo-shaped rows (same keys by company name / contact email) to skip redundant API calls
- Presents a review/edit table where the user confirms, corrects, or skips records
- Pushes approved records to HubSpot (create or update), then creates a static HubSpot list containing all imported record IDs

### Success Criteria
- User can go from raw CSV to HubSpot push in under 15 minutes for a 50-row list
- Manual Googling reduced from 100% of records to <20% (low-confidence AI flags only)
- Zero records pushed to HubSpot without explicit user approval in the review table
- Tyler (second user) can run the same app locally with his own `.env.local`

---

## 2. User Flow (End to End) {#user-flow}

```
1. UPLOAD         → User drags/drops or selects a CSV or Excel file
2. DETECT         → App auto-detects: Company List or Contact List (or unknown + manual pick)
3. CONTEXT FORM   → User fills in event context (name, date, state/region, audience level for contacts)
4. ENRICH         → Strict order, each phase awaited before the next:
                    (a) AI — all batches complete (`POST /api/enrich/ai`, batch size 3)
                    (b) Verify — `POST /api/enrich/zoominfo` with AI rows (NDJSON progress)
                    (c) Contacts only — LinkedIn fallback: `POST /api/enrich/linkedin-search` per contact
                        still missing `linkedinUrl` after (b)
                    Progress: batch text during AI; verifying bar + detail during (b); LinkedIn detail during (c)
5. REVIEW TABLE   → User reviews each record, sees confidence scores and AI reasoning
                    Inline edits; optional derived “unresolved” sort for incomplete key fields
6. PUSH           → Pre-push screen (list name, folder, lead source, etc.) → `POST /api/hubspot/push`
                    Creates/updates records; adds all IDs to a new static list (in push handler)
7. DONE           → Success screen with summary + link to HubSpot list
```

---

## 3. Data Models {#data-models}

### 3.1 Raw Input Row (after parsing)

```typescript
// Company list input
interface RawCompanyRow {
  rawName: string;          // e.g. "RUSH", "HCSC", "The Heico Companies, LLC"
  [key: string]: string;    // any extra columns from the CSV, preserved but ignored
}

// Contact list input
interface RawContactRow {
  firstName: string;
  lastName: string;
  email?: string;           // may be personal (gmail, etc.)
  title?: string;
  company?: string;
  location?: string;        // state or city, often vague
  notes?: string;           // "Attended Event", "No Show", etc.
  phone?: string;
  membershipNotes?: string; // e.g. CyAlliance “Membership Notes” column
  leadSource?: string;
  leadSourceDescription?: string;
  [key: string]: string | undefined;
}
```

### 3.2 Enriched Company Record

```typescript
interface EnrichedCompany {
  id: string;                         // uuid, generated client-side for table key

  // Resolution
  rawInput: string;                   // original name from CSV
  resolvedName: string;               // clean company name after AI resolution
  confidenceScore: 'high' | 'medium' | 'low' | 'unresolved';
  aiReasoning: string;                // human-readable explanation of how AI resolved the name
  needsReview: boolean;               // true if confidence < high

  // HubSpot fields
  domain: string;                     // e.g. "hcsc.com"
  website: string;                    // e.g. "https://www.hcsc.com"
  state: string;                      // HQ state, full name e.g. "Illinois"
  numberOfEmployees: number | null;
  linkedinUrl: string;                // company LinkedIn page URL

  // Source tracking
  enrichedByZoomInfo: boolean;
  enrichedByCommonRoom: boolean;
  enrichedByAI: boolean;

  // Review state
  status: 'pending' | 'approved' | 'skipped' | 'error';
  hubspotId?: string;                 // populated after push (existing record ID if found)
  hubspotAction?: 'create' | 'update'; // populated after push

  // Optional — may be filled by AI / ZoomInfo enrichment
  revenue?: number;
  industry?: string;
  description?: string;
  city?: string;
}
```

### 3.3 Enriched Contact Record

```typescript
interface EnrichedContact {
  id: string;                         // uuid

  // Raw input
  firstName: string;
  lastName: string;
  rawEmail: string;                   // original email from CSV (may be personal)
  rawCompany: string;                 // company name as given

  // Resolution
  resolvedEmail: string;              // best work email found (may equal rawEmail if work)
  isPersonalEmail: boolean;           // true if rawEmail is gmail/yahoo/etc.
  resolvedCompany: string;            // cleaned company name
  confidenceScore: 'high' | 'medium' | 'low' | 'unresolved';
  aiReasoning: string;
  needsReview: boolean;

  // HubSpot fields
  title: string;
  linkedinUrl: string;               // individual LinkedIn profile URL
  companyDomain: string;             // for HubSpot company association
  location: string;                  // state

  // Event/lead fields (passed through from CSV)
  leadSource: string;
  leadSourceDescription: string;
  notes: string;
  membershipNotes: string;
  phone?: string;

  // Source tracking
  enrichedByZoomInfo: boolean;
  enrichedByCommonRoom: boolean;
  enrichedByAI: boolean;

  // Review state
  status: 'pending' | 'approved' | 'skipped' | 'error';
  hubspotId?: string;
  hubspotAction?: 'create' | 'update';
}
```

### 3.4 Event Context

Matches `EventContext` in `src/lib/utils/types.ts`:

```typescript
interface EventContext {
  eventName: string;          // e.g. "CISOExecNet Midwest"
  eventDate: string;          // e.g. "March 2026" (month + year from the form)
  /** US state, macro region, National, or International — may be "" if user chose "No State / Region". */
  region: string;
  /** Required for contact lists in API validation; for company lists the UI may omit — server defaults to `"Business professionals"` when empty. */
  audienceLevel: string;
  listType: 'companies' | 'contacts';
}
```

Lead source and import folder are chosen later at pre-push, not in this object.

---

## 4. Phase 1 — Scaffold, Upload & Parse {#phase-1}

### Goal
Bare-bones working app: user can upload a CSV and see parsed rows on screen.

### Pages / Routes

```
src/app/
  page.tsx                  → Main single-page app (upload → review → push, all one page with steps)
  api/
    parse/route.ts          → POST: accepts file, returns parsed rows + detected list type
```

### `POST /api/parse`

**Input:** `multipart/form-data` with a single `file` field (CSV or .xlsx)

**Logic:**
1. Detect file type by extension (.csv vs .xlsx)
2. Parse using `papaparse` (CSV) or `xlsx` (Excel)
3. Normalize column headers: lowercase, trim whitespace, remove special characters
4. Detect list type using column header heuristics:
   - If headers contain only `company` or `company:` → `companies`
   - If headers contain `first`, `last`, `email`, `firstname`, `lastname` → `contacts`
   - If ambiguous, return `unknown` and prompt user to select
5. Map raw columns to typed `RawCompanyRow[]` or `RawContactRow[]`
6. Return parsed rows + detected list type + raw headers

**Column mapping for known formats:**

CISOExecNet company format:
```
"Company:" → rawName
```

CyAlliance contact format (Feb 2026):
```
First → firstName
Last → lastName
Notes → notes
Title → title
Company → company
HQ → location
Email → email
Lead Source → leadSource
Lead Source Description → leadSourceDescription
```

CyAlliance contact format (Mar 2026):
```
First Name → firstName
Last Name → lastName
Title → title
Company → company
Location → location
Email → email
Membership Notes → notes
Lead Source Description → leadSourceDescription
Lead Source → leadSource
Lead Origination → (ignored)
```

**Important:** The parser must handle the case where TWO events are concatenated in one CSV (as seen in the CyAlliance Feb 2026 file, which contains both Feb and Mar events separated by a blank row). Detect this by checking for a second header row mid-file and split accordingly, prompting the user to confirm which event to process.

**Output:**
```typescript
{
  listType: 'companies' | 'contacts' | 'unknown',
  rows: RawCompanyRow[] | RawContactRow[],
  totalRows: number,
  warnings: string[]   // e.g. "Duplicate rows detected: row 3 and row 29 are identical"
}
```

### UI — Step 1: Upload

- Large drag-and-drop zone, also accepts click-to-browse
- Accepts `.csv`, `.xlsx`, `.xls`
- Shows file name + row count after upload
- Auto-proceeds to Step 2 (Event Context) on successful parse
- If `listType === 'unknown'`, show a toggle: "Is this a Company list or Contact list?"
- Show warnings (duplicates, multi-event detection) as yellow banners

### Dependencies to install
```bash
npm install papaparse xlsx uuid
npm install -D @types/papaparse
```

---

## 5. Phase 2 — Event Context & AI Enrichment {#phase-2}

### Goal
Collect event context from user, then run AI-powered enrichment on every row. This is the core value of the app — it replaces manual Googling.

### Pages / Routes

```
src/app/
  api/
    enrich/
      ai/route.ts           → POST: AI enrichment for a batch of rows
```

### UI — Step 2: Event Context Form

Show this form between upload and enrichment. Fields:

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Event Name | text | yes | e.g. "CISOExecNet Midwest" |
| Event Date | month + year selects | yes | e.g. January 2026 |
| State / Region | select | yes* | Root menu: placeholder → **No State / Region** (stores empty `region`) → pick a US state → or pick a macro region (Northeast, Midwest, etc.). User must either choose a location or explicitly choose "No State / Region". |
| Audience Level | text | yes for **contacts** only | Hidden for **company** lists; not sent as a required field for companies. Default copy suggests CISO / security leadership when shown |

\*Required in the sense that the user cannot submit on the initial placeholder; they may submit with no geographic region by selecting **No State / Region**, in which case `region` is sent as `""` to the API.

On submit → trigger enrichment pipeline.

### `POST /api/enrich/ai`

**Purpose:** Use the Claude API (with web search) to resolve ambiguous records and find missing data.

**Input:**
```typescript
{
  rows: RawCompanyRow[] | RawContactRow[],
  listType: 'companies' | 'contacts',
  context: EventContext
}
```

**Validation (`POST /api/enrich/ai`):** After trim, **`eventName`** and **`eventDate`** are always required. **`audienceLevel`** is required for **`listType === 'contacts'`** only; for **`companies`**, `audienceLevel` is optional and defaults server-side to **`"Business professionals"`** when missing or blank. **`region`** is optional (`""` OK).

**Behavior — Company Resolution:**

For each company row, call the Claude API with a prompt structured as:

```
System: You are a B2B data researcher specializing in identifying companies from 
partial or abbreviated names. You are working with a list from [eventName], a 
[audienceLevel] event focused on cybersecurity, held in [region] ([eventDate])
— or, when no region was provided: ([eventDate]). This is a virtual/national event with no specific region.

For each company name provided, identify the most likely real company, return 
its official name, website domain, HQ state, approximate employee count, and 
LinkedIn company page URL. 

IMPORTANT REASONING RULES:
- Use event context heavily. A "RUSH" on a Midwest CISO event is almost certainly 
  Rush University Medical Center, not Rush Communications.
- For acronyms like "HCSC", reason from context: this is Health Care Service 
  Corporation, a major Chicago-based health insurer.
- Return confidence: HIGH (you are certain), MEDIUM (most likely but could be wrong),
  LOW (best guess), UNRESOLVED (genuinely cannot determine).
- Always explain your reasoning in 1-2 sentences.
- Use web search to verify domain names and LinkedIn URLs.

Return a JSON array. No markdown, no preamble.

User: Resolve these company names: [list]
```

**Behavior — Contact Resolution:**

For contacts:
```
System: You are a B2B contact researcher. Given a person's name, title, and 
company (and the email from the source list), enrich company name, company domain, and LinkedIn profile.

Context — these contacts attended [eventName], a [audienceLevel] cybersecurity event.
Region: [region]. Event date: [eventDate]
— or, when no region was provided, the region line is replaced with:
This is a virtual/national event with no specific region. Event date: [eventDate].

For each contact:
- Find the LinkedIn profile URL using name + company + title.
- Return confidence score and reasoning.
- You may set isPersonalEmail to true if the provided email looks like a personal domain (gmail, yahoo, hotmail, icloud, etc.). The CSV email is kept as-is downstream — do not substitute a different email.

Return JSON array only.
```

**Batching:** The client sends AI enrichment in batches of **`ENRICHMENT_BATCH_SIZE` (3)** rows per HTTP call (`batchIndex` / `batchSize` on `POST /api/enrich/ai`). Omit `batchIndex` for the legacy streaming NDJSON response (`enrichRowsWithProgress`). Progress advances batch by batch.

**Output per company row:**
```typescript
{
  rawInput: string,
  resolvedName: string,
  domain: string,
  website: string,
  state: string,
  numberOfEmployees: number | null,
  linkedinUrl: string,
  confidenceScore: 'high' | 'medium' | 'low' | 'unresolved',
  aiReasoning: string,
  enrichedByAI: true
}
```

**Output per contact row:**
```typescript
{
  resolvedEmail: string,
  isPersonalEmail: boolean,
  resolvedCompany: string,
  companyDomain: string,
  linkedinUrl: string,
  confidenceScore: 'high' | 'medium' | 'low' | 'unresolved',
  aiReasoning: string,
  enrichedByAI: true
}
```

**Environment variable needed:**
```
ANTHROPIC_API_KEY=sk-ant-...
```

**Claude API call pattern (server-side only):**
```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// See `src/lib/enrichment/ai-enricher.ts` — model is e.g. `COMPANY_MODEL` / Sonnet-class; tools optional per implementation.
const response = await client.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 4096,
  // ...
});
```

### Dependencies to install
```bash
npm install @anthropic-ai/sdk
```

---

## 6. Phase 3 — Verification (`/api/enrich/zoominfo`) {#phase-3}

### Goal
After AI enrichment completes (all batches), the client calls **one** route: **`POST /api/enrich/zoominfo`**. That handler runs **companies** or **contacts** logic in-process — there are **no** separate `commonroom/route.ts`, `merge/route.ts`, or standalone merge API. Common Room and prospector run **inside** the contact branch; merging uses **`src/lib/enrichment/merger.ts`**.

**Response:** NDJSON stream (`application/x-ndjson`): `progress` lines with optional `detail`, then `done` with `{ rows, listType, enrichedCount, creditsUsed }` (credits mirror successful ZoomInfo enrichments counted in the handler). On auth failure, an `error` line may include `zoomInfoAuthFailure: true`.

### ZoomInfo authentication (`src/lib/zoominfo/auth.ts`)

- **OAuth 2.0 client credentials** — `POST https://api.zoominfo.com/gtm/oauth/v1/token` with `grant_type=client_credentials`, Basic auth from `ZOOMINFO_CLIENT_ID` + `ZOOMINFO_CLIENT_SECRET`.
- Access token cached in module scope with refresh before expiry.
- **No** `ZOOMINFO_USERNAME` in auth (legacy docs may mention it; code uses client id/secret only).

### Data API shape (JSON:API)

ZoomInfo GTM Data API uses **`Content-Type` / `Accept: application/vnd.api+json`** and JSON:API-style bodies.

**Companies (see `zoominfo-enricher.ts`):**
1. `POST https://api.zoominfo.com/gtm/data/v1/companies/search` — `CompanySearch` + attributes (`companyName`, optional `companyWebsite`).
2. `POST https://api.zoominfo.com/gtm/data/v1/companies/enrich` — `CompanyEnrich` with `matchCompanyInput` (e.g. `companyId` from search) and `outputFields` (e.g. id, name, website, socialMediaUrls, employeeCount, state, …).
3. LinkedIn company URL may be derived from `socialMediaUrls` when present.

**Contacts:**
1. **Common Room** — `enrichContactWithCommonRoom` in `commonroom-enricher.ts` (REST `community/v1/members` by email and optionally LinkedIn handle).
2. **Prospector** — internal `fetch` from this route to **`POST /api/enrich/prospector`** (same origin) for lightweight title/LinkedIn/location hints when CR is insufficient.
3. **ZoomInfo** — `ContactSearch` then `ContactEnrich` with `matchPersonInput` (work **email** *or* `personId`), JSON:API to `.../contacts/search` and `.../contacts/enrich`.

**Rate limiting:** ~**200 ms** delay between rows (`delayBetweenZoomInfoCalls`) in the zoominfo route loop.

### High-confidence skip vs LinkedIn-only path (contacts)

- **`confidenceScore === 'high'`** and **non-empty `linkedinUrl`:** row is passed through unchanged (no CR / prospector / ZoomInfo).
- **`confidenceScore === 'high'`** but **missing `linkedinUrl`:** row still runs CR → prospector → ZoomInfo as needed; merge uses **`mergeEnrichedContact`**, then the handler applies **LinkedIn-only** output: **`{ ...contact, linkedinUrl: merged.linkedinUrl }`** plus source flags derived from CR/ZI LinkedIn URLs — **no** overwrite of title, company, phone, etc.

Companies with **high** confidence still skip ZoomInfo entirely (unchanged).

### Company merge (`mergeEnrichedCompany`)

ZoomInfo partial may include **`originalConfidence`** from `enrichCompanyWithZoomInfo`. If the AI row was **high**, merger uses **fill-gaps** (keep AI where present); otherwise **ZoomInfo-preferred** for structured fields. Website is derived from merged `domain`.

### Contact merge (`mergeEnrichedContact`)

Field precedence is implemented in **`merger.ts`** (e.g. LinkedIn: Common Room → prospector → AI → ZoomInfo order in `firstNonEmptyString`). CSV **`rawEmail`** remains canonical for stored email.

### Caching

- **`src/lib/cache/enrichment-cache.ts`** — Vercel KV (`getCachedCompany` / `setCachedCompany` keyed by normalized name; contact cache by email). AI step writes cache; ZoomInfo company flow may read/write to skip duplicate API work. **Same key as AI** for companies: only treat cache as “ZoomInfo skip” when the stored row indicates prior ZoomInfo merge (`enrichedByZoomInfo`).

### Environment variables (ZoomInfo + Common Room)

```
ZOOMINFO_CLIENT_ID=...
ZOOMINFO_CLIENT_SECRET=...
COMMON_ROOM_API_KEY=...   # optional; Common Room returns {} if missing
```

---

## 7. Phase 4 — Review & Edit Table {#phase-4}

### Goal
The user reviews every enriched record before anything goes to HubSpot. They can approve, skip, or inline-edit any field.

### UI Design

**Layout:** Full-width table. Each row = one company or contact.

**Table columns for Company list:**

| Column | Editable | Notes |
|--------|----------|-------|
| ✓ (checkbox) | — | Approve/skip toggle |
| Raw Input | no | Original name from CSV, grayed out |
| Resolved Name | yes | AI/ZoomInfo result |
| Domain | yes | |
| Website | yes | |
| State | yes | |
| Employees | yes | |
| LinkedIn | yes | Clickable link icon |
| Confidence | no | Color badge: green/yellow/red |
| Reasoning | no | Tooltip / expand icon → shows AI reasoning text |
| Source | no | Icons: AI / ZI / CR |

**Table columns for Contact list:**

| Column | Editable | Notes |
|--------|----------|-------|
| ✓ (checkbox) | — | Approve/skip toggle |
| Name | no | firstName + lastName |
| Raw Email | no | Original, grayed |
| Resolved Email | yes | Work email |
| Personal? | no | ⚠️ icon if personal email detected |
| Company | yes | |
| Title | yes | |
| LinkedIn | yes | Clickable |
| Confidence | no | Badge |
| Reasoning | no | Tooltip |

**Confidence badge colors:**
- `high` → green
- `medium` → yellow, flagged for review
- `low` → orange, flagged for review  
- `unresolved` → red, requires manual input

**Row states:**
- Default: white background, checkbox unchecked
- Approved: light green background, checkbox checked
- Skipped: gray background, strikethrough text
- Low confidence: yellow left border, pulsing indicator

**Bulk actions toolbar (above table):**
- "Approve All High Confidence" button
- "Select All" / "Deselect All"
- Filter by: All / Needs Review / Approved / Skipped
- Row count summary: "32 approved, 4 need review, 2 skipped"

**Inline editing:**
- Click any editable cell → text input appears in place
- Press Enter or click away to save
- Edited cells show a small blue dot indicator

**Reasoning tooltip:**
- Hover or click the reasoning icon on any row
- Shows: "AI resolved 'RUSH' to Rush University Medical Center because this is a Midwest CISO event and RUSH is the well-known abbreviation for Rush Health in Chicago. Verified via web search: rush.edu. Confidence: HIGH."

**"Push to HubSpot" button:**
- Disabled until at least 1 row is approved
- Shows count: "Push 32 records to HubSpot →"

---

## 8. Phase 5 — HubSpot Push & Static List {#phase-5}

### Goal
Push approved records to HubSpot with deduplication, then create a static list containing all pushed record IDs (both created and updated).

### Routes

```
src/app/api/hubspot/
  push/route.ts             → POST: NDJSON progress + push; creates static list in-handler (see push-handler.ts)
  folders/route.ts          → GET: HubSpot list folders for PrePushScreen
```

There is **no** standalone `hubspot/list/route.ts` — list creation and membership add run inside the push flow (`src/lib/hubspot/push-handler.ts`, `lists.ts`).

### `POST /api/hubspot/push`

**Auth:** All HubSpot API calls use:
```
Authorization: Bearer {HUBSPOT_ACCESS_TOKEN}
Content-Type: application/json
```

**Company push logic:**

1. **Deduplicate check:** Search HubSpot for existing company by domain:
```
GET https://api.hubapi.com/crm/v3/objects/companies/search
{
  "filterGroups": [{
    "filters": [{ "propertyName": "domain", "operator": "EQ", "value": "hcsc.com" }]
  }],
  "properties": ["name", "domain", "hs_object_id"]
}
```

2. **If found → UPDATE:**
```
PATCH https://api.hubapi.com/crm/v3/objects/companies/{id}
{
  "properties": {
    "name": "Health Care Service Corporation",
    "domain": "hcsc.com",
    "website": "https://www.hcsc.com",
    "state": "Illinois",
    "numberofemployees": 22000,
    "linkedin_company_page": "https://linkedin.com/company/hcsc"
  }
}
```

3. **If not found → CREATE:**
```
POST https://api.hubapi.com/crm/v3/objects/companies
{ "properties": { ...same fields... } }
```

4. Collect returned `hs_object_id` for every record (both created and updated).

**Contact push logic:**

Same pattern but using `/crm/v3/objects/contacts`. Deduplicate on email (resolved work email). 

HubSpot contact properties to set:
```
firstname, lastname, email, jobtitle, company, hs_linkedin_url,
state, lead_source (→ "leadSource"), lead_source_description (→ "leadSourceDescription"),
notes_last_contacted (→ "notes")
```

**Error handling:**
- 409 Conflict → treat as existing record, fetch ID and continue
- 429 Rate limit → exponential backoff, retry up to 3 times
- 4xx other → mark row as error, continue with remaining rows
- Never abort the entire push due to a single row failure

**Output:**
```typescript
{
  created: number,
  updated: number,
  errors: { rowId: string, error: string }[],
  allRecordIds: string[]    // ALL pushed IDs (created + updated) — needed for list creation
}
```

### Static list (no separate route)

After the push handler finishes upserts, it creates a static list (same HubSpot API sequence below). The app exposes **`POST /api/hubspot/push` only** — there is no `POST /api/hubspot/list`.

**Step 1 — Create list:**
```
POST https://api.hubapi.com/crm/v3/lists
{
  "name": "CISOExecNet Midwest Mar. 2026",
  "objectTypeId": "0-1",    // 0-1 for contacts, 0-2 for companies
  "processingType": "MANUAL"
}
```

**Step 2 — Add all record IDs to list:**
```
PUT https://api.hubapi.com/crm/v3/lists/{listId}/memberships/add
{
  "recordIds": ["123", "456", "789", ...]   // ALL IDs: created + updated
}
```

This ensures the static list mirrors the behavior of a HubSpot CSV import — it contains every record touched in this import, not just new ones.

**Step 3 — Return list URL:**
```
https://app.hubspot.com/contacts/{portalId}/lists/{listId}
```

### Success Screen

After push completes:
- "✅ Import Complete" heading
- Stats: "34 records pushed — 12 created, 22 updated, 0 errors"
- "📋 HubSpot List Created: CISOExecNet Midwest Mar. 2026" → clickable link to list
- "Start New Import" button → reset all state

### Environment Variable
```
HUBSPOT_ACCESS_TOKEN=pat-na1-...
```

---

## 9. API Reference Summary {#api-reference}

### ZoomInfo (external)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `https://api.zoominfo.com/gtm/oauth/v1/token` | POST | OAuth client credentials → `access_token` |
| `https://api.zoominfo.com/gtm/data/v1/companies/search` | POST | JSON:API company search |
| `https://api.zoominfo.com/gtm/data/v1/companies/enrich` | POST | JSON:API company enrich |
| `https://api.zoominfo.com/gtm/data/v1/contacts/search` | POST | JSON:API contact search |
| `https://api.zoominfo.com/gtm/data/v1/contacts/enrich` | POST | JSON:API contact enrich |

### HubSpot (external — used via `src/lib/hubspot/http.ts`)

| Path | Method | Purpose |
|------|--------|---------|
| `/crm/v3/objects/companies/search` | POST | Find company |
| `/crm/v3/objects/companies` | POST / PATCH | Create / update |
| `/crm/v3/objects/contacts/search` | POST | Find contact |
| `/crm/v3/objects/contacts` | POST / PATCH | Create / update |
| `/crm/v3/lists` | POST | Create static list |
| List memberships | POST | Add records (see `lists.ts`) |

### Anthropic

| Endpoint | Method | Purpose |
|----------|--------|---------|
| Messages API | POST | AI enrichment (`ai-enricher.ts`, model constant e.g. Sonnet-class) |

### This app — Next.js API routes (`src/app/api`)

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/parse` | POST | Multipart file → `ParseResponse` (list type, rows, warnings, optional `multiEvent`) |
| `/api/enrich/ai` | POST | Batched JSON **or** streaming NDJSON AI enrichment; context validation per §5 |
| `/api/enrich/zoominfo` | POST | NDJSON verification: companies (ZoomInfo) or contacts (CR + prospector + ZoomInfo) |
| `/api/enrich/prospector` | POST | Prospector hints (called from zoominfo handler server-side) |
| `/api/enrich/linkedin-search` | POST | Last-resort web search for LinkedIn URL (contact) |
| `/api/hubspot/push` | POST | NDJSON HubSpot push + static list |
| `/api/hubspot/folders` | GET | List folders for import UI |
| `/api/zoominfo-lookup` | GET | Dev/diagnostic ZoomInfo lookup enrich probe (requires auth) |

**Client-only enrichment order** is enforced in **`src/app/page.tsx`**: AI batches → `zoominfo` → `linkedin-search` (contacts, missing LinkedIn only).

---

## 10. Environment Variables {#env-vars}

Create `.env.local` in project root:

```bash
# Anthropic (for AI enrichment)
ANTHROPIC_API_KEY=sk-ant-...

# ZoomInfo GTM Data API (OAuth client credentials)
ZOOMINFO_CLIENT_ID=...
ZOOMINFO_CLIENT_SECRET=...

# Common Room (optional — contacts; enrichment no-ops if unset)
COMMON_ROOM_API_KEY=...

# HubSpot
HUBSPOT_ACCESS_TOKEN=pat-na1-...
HUBSPOT_PORTAL_ID=...     # Used for success links — from app.hubspot.com URL

# Vercel KV (optional — AI / enrichment caching when deployed with @vercel/kv)
KV_REST_API_URL=...
KV_REST_API_TOKEN=...
```

**NEVER commit `.env.local` to git.** Ensure `.gitignore` includes it (Next.js default does).

Tyler creates his own `.env.local` with his own credentials when he sets up the app.

---

## 11. File Structure {#file-structure}

```
realm-enrichment-tool/
├── src/
│   ├── app/
│   │   ├── page.tsx                    # Main single-page flow (upload → context → enrich → verify UI → review → prepush → push → done)
│   │   ├── layout.tsx
│   │   └── api/
│   │       ├── parse/route.ts
│   │       ├── enrich/
│   │       │   ├── ai/route.ts
│   │       │   ├── zoominfo/route.ts   # Verification: CR + prospector + ZoomInfo (contacts); ZoomInfo (companies)
│   │       │   ├── prospector/route.ts
│   │       │   └── linkedin-search/route.ts
│   │       ├── hubspot/
│   │       │   ├── push/route.ts
│   │       │   └── folders/route.ts
│   │       └── zoominfo-lookup/route.ts   # Optional GET probe for ZoomInfo lookup API
│   ├── components/
│   │   ├── EventContextForm.tsx
│   │   ├── EnrichmentProgress.tsx    # Verifying step: detail above bar; bar uses endRow/totalRows
│   │   ├── ReviewTable.tsx           # Company + contact tables, inline edit, sort rules
│   │   ├── PrePushScreen.tsx
│   │   ├── ConfidenceBadge.tsx
│   │   ├── ReasoningTooltip.tsx
│   │   └── SuccessScreen.tsx
│   ├── lib/
│   │   ├── parsers/                  # csv-parser, excel-parser, column-mapper
│   │   ├── enrichment/
│   │   │   ├── ai-enricher.ts
│   │   │   ├── zoominfo-enricher.ts
│   │   │   ├── commonroom-enricher.ts
│   │   │   └── merger.ts
│   │   ├── cache/enrichment-cache.ts # Vercel KV optional
│   │   ├── hubspot/                  # companies, contacts, lists, http, push-handler, push-result, list-folders
│   │   ├── zoominfo/auth.ts
│   │   └── utils/types.ts, states.ts, …
│   └── styles/globals.css
├── SPEC.md
├── package.json
└── …
```

**Note:** There is no `UploadZone.tsx`, `CompanyRow.tsx`, or `ContactRow.tsx` in the current tree — upload UI and tables live in **`page.tsx`** / **`ReviewTable.tsx`**.

---

## 12. Error Handling & Edge Cases {#errors}

### Input Edge Cases

| Case | Handling |
|------|----------|
| Duplicate rows in CSV | Detect and warn (yellow banner), user decides |
| Two events in one CSV | Detect second header row, split into two lists, ask user which to process |
| Empty rows | Strip silently |
| Extra columns not in spec | Preserve as `extraFields`, ignore in enrichment |
| Missing required columns | Show error with which columns are missing |
| File > 5MB | Reject with friendly message |
| Non-CSV/Excel file | Reject with friendly message |

### Enrichment Edge Cases

| Case | Handling |
|------|----------|
| AI cannot resolve company | `confidenceScore: 'unresolved'`, flagged red, user must fill manually |
| ZoomInfo returns 0 results | Fall back to AI result only |
| ZoomInfo rate limited | Queue with exponential backoff, show "Rate limited, retrying..." |
| ZoomInfo auth fails | Show config error with setup instructions |
| Personal email (gmail, etc.) | Flag `isPersonalEmail: true`, AI attempts to find work email, show warning |
| Missing company name on contact | Flag as low confidence, user must fill |
| LinkedIn URL not found | Leave blank, note in reasoning |

### HubSpot Push Edge Cases

| Case | Handling |
|------|----------|
| Duplicate by domain (company) | Update existing record, collect its ID |
| Duplicate by email (contact) | Update existing record, collect its ID |
| Single row push failure | Log error, mark row red in results, continue |
| List creation fails | Show warning but don't fail the whole import; show IDs so user can create list manually |
| Network timeout | Retry once, then mark as error |

### Personal Email Detection

Treat as personal email if domain matches:
```
gmail.com, yahoo.com, hotmail.com, outlook.com, icloud.com, 
me.com, mac.com, aol.com, live.com, msn.com, protonmail.com,
proton.me, hey.com, fastmail.com, gmx.com, ymail.com
```

---

## 13. Out of Scope (v1) {#out-of-scope}

These are intentionally NOT in v1 but are designed for in v2:

- **Multi-user auth** — no login required, app is local only. Tyler runs his own instance.
- **Import history / audit log** — no database, no persistence between sessions
- **Bulk processing > 200 rows** — Gartner 1,000-account event will need a queue system (v2)
- **HubSpot deal creation** — contacts/companies only in v1
- **Automatic LinkedIn scraping** — we find URLs but don't scrape profile data
- **ZoomInfo intent data** — we only use Search + Enrich, not Intent signals
- **Hosting / deployment** — v1 is local only. Vercel deployment is a v2 task.
- **Slack notifications** — not needed for a local tool

---

## Build Order Summary

| Phase | What Gets Built | Done When |
|-------|----------------|-----------|
| 1 | Scaffold + Upload + Parse | CSV uploads, parses, shows rows in browser |
| 2 | Event Context Form + AI Enrichment | Vague names resolve with reasoning shown |
| 3 | ZoomInfo + Common Room | Structured fields populated from data APIs |
| 4 | Review Table | Full edit/approve/skip UI working |
| 5 | HubSpot Push + Static List | Records in HubSpot, list created, success screen |

**Start each phase in a new Cursor Agent conversation, paste the relevant spec section as context, and reference the existing code structure.**