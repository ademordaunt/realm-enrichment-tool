# Realm RevOps Enrichment Tool — Full Product Spec

**Version:** 1.1  
**Stack:** Next.js 16 (App Router), TypeScript, Tailwind CSS  
**Author:** Realm Security RevOps  
**Purpose:** Transform raw marketing event lead lists into HubSpot-ready records via AI enrichment, ZoomInfo, and Common Room — with a human review step before any data hits the CRM.

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
- Enriches every record through a three-layer pipeline: AI reasoning → ZoomInfo → Common Room
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
2. DETECT         → App auto-detects: Company List or Contact List
3. CONTEXT FORM   → User fills in event context (name, date, state/region optional, audience level)
4. ENRICH         → App runs enrichment pipeline (AI → ZoomInfo → Common Room)
                    Progress shown row-by-row with a live status indicator
5. REVIEW TABLE   → User reviews each record, sees confidence scores and AI reasoning
                    Can edit any field inline, approve, or skip individual rows
6. PUSH           → User clicks "Push to HubSpot"
                    App creates/updates Company or Contact records
                    App creates a static HubSpot list with all pushed record IDs
7. DONE           → Success screen with summary (X created, Y updated, Z skipped)
                    Link to the new HubSpot list
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
  audienceLevel: string;      // e.g. "CISOs, SOC team leaders, security leaders"
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
| Audience Level | text | yes | Default copy suggests CISO / security leadership |

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

**Validation:** `eventName`, `eventDate`, and `audienceLevel` must be non-empty after trim. **`region` is optional** — `null`, `undefined`, or `""` are accepted (normalized to `""` server-side).

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

**Batching:** The app requests AI enrichment in batches of **5** rows per HTTP call (`batchIndex` / `batchSize` on `POST /api/enrich/ai`); omit `batchIndex` for the legacy streaming NDJSON response (e.g. local curl). Progress advances batch by batch.

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

const response = await client.messages.create({
  model: 'claude-opus-4-5',
  max_tokens: 4096,
  tools: [{ type: 'web_search_20250305', name: 'web_search' }],
  messages: [{ role: 'user', content: prompt }]
});
```

### Dependencies to install
```bash
npm install @anthropic-ai/sdk
```

---

## 6. Phase 3 — ZoomInfo & Common Room Enrichment {#phase-3}

### Goal
After AI resolution gives us clean company names and domains, use ZoomInfo and Common Room to fill in structured fields with high accuracy. This phase runs automatically after Phase 2, then merges results.

### Routes

```
src/app/api/enrich/
  zoominfo/route.ts         → POST: ZoomInfo enrichment
  commonroom/route.ts       → POST: Common Room enrichment
  merge/route.ts            → POST: merge AI + ZoomInfo + CommonRoom results
```

### ZoomInfo Authentication

ZoomInfo uses OAuth 2.0 with JWT. Auth token must be obtained before making data calls and cached for the duration of the session (tokens expire after 1 hour).

**Auth endpoint:** `POST https://api.zoominfo.com/authenticate`

```typescript
// src/lib/zoominfo/auth.ts
const response = await fetch('https://api.zoominfo.com/authenticate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    username: process.env.ZOOMINFO_USERNAME,
    client_id: process.env.ZOOMINFO_CLIENT_ID,
    client_secret: process.env.ZOOMINFO_CLIENT_SECRET,
  })
});
const { jwt } = await response.json();
// Cache jwt in module-level variable with expiry timestamp
```

### `POST /api/enrich/zoominfo`

**Company enrichment flow (two API calls per company):**

Step 1 — Search: `POST https://api.zoominfo.com/search/company`
```json
{
  "outputFields": ["id", "name", "website", "employeeCount", "hqState", "linkedInUrl"],
  "searchInput": [{ "companyName": "Health Care Service Corporation" }]
}
```

Step 2 — Enrich (only if search returns a confident match):
`POST https://api.zoominfo.com/enrich/company`
```json
{
  "outputFields": ["name", "website", "employeeCount", "hqState", "linkedInUrl", "companyHQPhone"],
  "matchInput": [{ "companyWebsite": "hcsc.com" }]
}
```

**Contact enrichment flow:**

Step 1 — Search: `POST https://api.zoominfo.com/search/contact`
```json
{
  "outputFields": ["id", "firstName", "lastName", "email", "jobTitle", "companyName", "linkedInUrl"],
  "searchInput": [{
    "firstName": "Vivek",
    "lastName": "Kumar",
    "companyName": "Alter Domus"
  }]
}
```

Step 2 — Enrich (if search returns match):
`POST https://api.zoominfo.com/enrich/contact`
```json
{
  "matchInput": [{ "email": "resolved-work-email@company.com" }]
}
```

**Rate limiting:** ZoomInfo has per-minute rate limits. Process records sequentially with a 200ms delay between calls. For lists > 100 rows, add a queue with concurrency: 3.

**Merge logic:** ZoomInfo data wins over AI data for structured fields (employeeCount, state) because it's more accurate. AI data wins for LinkedIn URLs because ZoomInfo's are often stale.

### `POST /api/enrich/commonroom`

Common Room is best used for **contact identity resolution** — it often has LinkedIn profiles, job titles, and community activity for security practitioners.

**Search by name + company:**
```typescript
// Use Common Room MCP or REST API
// Query their contact database for matching individuals
// Return: linkedInUrl, currentTitle, currentCompany, email
```

**Note:** Common Room data supplements ZoomInfo — use it as a fallback for contacts ZoomInfo couldn't match, and to verify/find LinkedIn URLs.

### Merge Priority (per field)

| Field | Priority Order |
|-------|---------------|
| resolvedName / resolvedCompany | AI → ZoomInfo |
| domain / website | ZoomInfo → AI |
| state | ZoomInfo → AI |
| numberOfEmployees | ZoomInfo → AI |
| linkedinUrl (company) | ZoomInfo → AI |
| linkedinUrl (contact) | Common Room → AI → ZoomInfo |
| resolvedEmail | ZoomInfo → AI |
| confidenceScore | Upgrade to 'high' if ZoomInfo matched |

### Environment Variables
```
ZOOMINFO_USERNAME=your-email@realm.security
ZOOMINFO_CLIENT_ID=...
ZOOMINFO_CLIENT_SECRET=...
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
src/app/api/
  hubspot/
    push/route.ts           → POST: push records to HubSpot
    list/route.ts           → POST: create static list + add record IDs
```

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

### `POST /api/hubspot/list`

After push succeeds, automatically create a static list:

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

### ZoomInfo

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `https://api.zoominfo.com/authenticate` | POST | Get JWT token |
| `https://api.zoominfo.com/search/company` | POST | Search companies by name |
| `https://api.zoominfo.com/enrich/company` | POST | Enrich company by domain |
| `https://api.zoominfo.com/search/contact` | POST | Search contacts by name + company |
| `https://api.zoominfo.com/enrich/contact` | POST | Enrich contact by email |

### HubSpot

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/crm/v3/objects/companies/search` | POST | Find existing company |
| `/crm/v3/objects/companies` | POST | Create company |
| `/crm/v3/objects/companies/{id}` | PATCH | Update company |
| `/crm/v3/objects/contacts/search` | POST | Find existing contact |
| `/crm/v3/objects/contacts` | POST | Create contact |
| `/crm/v3/objects/contacts/{id}` | PATCH | Update contact |
| `/crm/v3/lists` | POST | Create static list |
| `/crm/v3/lists/{listId}/memberships/add` | PUT | Add records to list |

### Anthropic

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/v1/messages` | POST | AI enrichment (Claude Sonnet; prompts built in `ai-enricher.ts`) |

### This app (Next.js API routes)

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/enrich/ai` | POST | Streams NDJSON progress + enriched rows. **Context validation:** `eventName`, `eventDate`, `audienceLevel` required; **`region` optional** (empty OK). |

---

## 10. Environment Variables {#env-vars}

Create `.env.local` in project root:

```bash
# Anthropic (for AI enrichment)
ANTHROPIC_API_KEY=sk-ant-...

# ZoomInfo
ZOOMINFO_USERNAME=your-email@realm.security
ZOOMINFO_CLIENT_ID=...
ZOOMINFO_CLIENT_SECRET=...

# HubSpot
HUBSPOT_ACCESS_TOKEN=pat-na1-...
HUBSPOT_PORTAL_ID=...     # Your HubSpot account ID (from the URL: app.hubspot.com/contacts/XXXXXXX)
```

**NEVER commit `.env.local` to git.** Ensure `.gitignore` includes it (Next.js default does).

Tyler creates his own `.env.local` with his own credentials when he sets up the app.

---

## 11. File Structure {#file-structure}

```
realm-enrichment-tool/
├── src/
│   ├── app/
│   │   ├── page.tsx                          # Main app — single page, step-based UI
│   │   ├── layout.tsx                        # Root layout
│   │   └── api/
│   │       ├── parse/
│   │       │   └── route.ts                  # CSV/Excel parsing
│   │       └── enrich/
│   │           ├── ai/route.ts               # Claude AI enrichment
│   │           ├── zoominfo/route.ts         # ZoomInfo enrichment
│   │           ├── commonroom/route.ts       # Common Room enrichment
│   │           └── merge/route.ts            # Merge all sources
│   │       └── hubspot/
│   │           ├── push/route.ts             # Push records to HubSpot
│   │           └── list/route.ts             # Create static list
│   ├── components/
│   │   ├── UploadZone.tsx                    # Drag-and-drop file upload
│   │   ├── EventContextForm.tsx              # Event context form (Step 2)
│   │   ├── EnrichmentProgress.tsx            # Live progress bar during enrichment
│   │   ├── ReviewTable.tsx                   # Main review/edit table (Step 4)
│   │   ├── CompanyRow.tsx                    # Individual company row in table
│   │   ├── ContactRow.tsx                    # Individual contact row in table
│   │   ├── ConfidenceBadge.tsx              # Color-coded confidence indicator
│   │   ├── ReasoningTooltip.tsx             # AI reasoning popover
│   │   └── SuccessScreen.tsx                # Post-push summary
│   ├── lib/
│   │   ├── parsers/
│   │   │   ├── csv-parser.ts                # CSV parsing with papaparse
│   │   │   ├── excel-parser.ts              # Excel parsing with xlsx
│   │   │   └── column-mapper.ts             # Map raw columns to typed rows
│   │   ├── enrichment/
│   │   │   ├── ai-enricher.ts               # Claude API enrichment logic
│   │   │   ├── zoominfo-enricher.ts         # ZoomInfo API calls
│   │   │   ├── commonroom-enricher.ts       # Common Room API calls
│   │   │   └── merger.ts                    # Merge enrichment results
│   │   ├── hubspot/
│   │   │   ├── companies.ts                 # Company create/update/search
│   │   │   ├── contacts.ts                  # Contact create/update/search
│   │   │   └── lists.ts                     # Static list creation
│   │   ├── zoominfo/
│   │   │   └── auth.ts                      # ZoomInfo JWT auth + token cache
│   │   └── utils/
│   │       ├── email-detector.ts            # Detect personal vs work emails
│   │       ├── deduplication.ts             # Find duplicate rows in input
│   │       └── types.ts                     # All shared TypeScript interfaces
│   └── styles/
│       └── globals.css
├── .env.local                                # NEVER commit
├── .env.example                              # Safe to commit — shows required keys without values
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

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