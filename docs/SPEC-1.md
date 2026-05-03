# SPEC 1 — Tier 1: Foundation
# Realm Enrichment Tool

## How to use this SPEC

Read all referenced documents in /docs before starting:
- product-brief.md
- current-state.md
- company-field-trust-rules.html
- contact-field-trust-rules.html

These are the source of truth for all product decisions,
data rules, and architectural intent. When in doubt on any
behavior, consult those documents before making assumptions.

Execute all sections in order. Do not skip ahead. Each section
depends on the previous one. After completing each section,
run the development server and verify the described behavior
before moving to the next section.

Do not change any UI, visual design, or copy unless explicitly
instructed in this SPEC. This build is backend logic,
pipeline architecture, and data rules only.

---

## Section 1 — Column recognition expansion

### File to modify
`src/lib/parsers/column-mapper.ts`

### What to change

**1a. Company column aliases**

Update `isCompanyHeader` to recognize all of the following
normalized tokens as the company column:
- `company`
- `companyname`
- `organization`
- `org`
- `account`
- `accountname`
- `employer`

**1b. Contact column aliases — update CONTACT_HEADER_MAP**

Add the following missing aliases to the existing map:

| Normalized alias | Maps to field |
|---|---|
| `givenname` | `firstName` |
| `fname` | `firstName` |
| `firstname` | `firstName` (already exists — confirm) |
| `first` | `firstName` (already exists — confirm) |
| `surname` | `lastName` |
| `lname` | `lastName` |
| `lastname` | `lastName` (already exists — confirm) |
| `last` | `lastName` (already exists — confirm) |
| `position` | `title` |
| `role` | `title` |
| `jobtitle` | `title` (already exists — confirm) |
| `companyname` | `company` |
| `organization` | `company` |
| `org` | `company` |
| `account` | `company` |
| `accountname` | `company` |
| `employer` | `company` |
| `emailaddress` | `email` (already exists — confirm) |
| `businessemail` | `email` (already exists — confirm) |
| `workemail` | `email` (already exists — confirm) |
| `liurl` | `linkedinUrl` |
| `mobile` | `phone` |
| `cell` | `phone` |
| `mobilephone` | `phone` |
| `repnotes` | `membershipNotes` |
| `realmnotes` | `membershipNotes` |
| `johnsnotes` | `membershipNotes` |
| `comments` | `membershipNotes` |
| `attended` | `attended` |
| `attendance` | `attended` |
| `didattend` | `attended` |
| `format` | `eventFormat` |
| `eventformat` | `eventFormat` |
| `attendancetype` | `eventFormat` |

**1c. New fields for contact rows — add to RawContactRow type**

Add these fields to the `RawContactRow` type in
`src/lib/utils/types.ts`:
- `attended?: string`
- `eventFormat?: string`
- `companyDomain?: string`
- `state?: string`
- `employees?: string`
- `industry?: string`

**1d. New column aliases for contact rows — add to CONTACT_HEADER_MAP**

| Normalized alias | Maps to field |
|---|---|
| `domain` | `companyDomain` |
| `companydomain` | `companyDomain` |
| `companydomainname` | `companyDomain` |
| `website` | `companyDomain` |
| `web` | `companyDomain` |
| `state` | `state` |
| `stateregion` | `state` |
| `region` | `state` |
| `province` | `state` |
| `employees` | `employees` |
| `numberofemployees` | `employees` |
| `numemployees` | `employees` |
| `employeecount` | `employees` |
| `headcount` | `employees` |
| `industry` | `industry` |
| `primaryindustry` | `industry` |
| `sector` | `industry` |
| `vertical` | `industry` |

**1e. New fields for company rows — add to RawCompanyRow type**

Add these fields to the `RawCompanyRow` type:
- `domain?: string`
- `state?: string`
- `employees?: string`
- `industry?: string`

**1f. Company column aliases for pre-enriched columns**

In `mapCompanyRow`, after mapping the primary company name
column, also check for and map:
- `domain` / `companydomain` / `companydomainname` / `website`
  → `domain`
- `state` / `stateregion` / `region` → `state`
- `employees` / `numberofemployees` / `numemployees`
  / `employeecount` / `headcount` → `employees`
- `industry` / `primaryindustry` / `sector` / `vertical`
  → `industry`

**1g. Location field — split parsing**

For both company and contact rows, when a `location` field
is mapped (e.g. "Atlanta, GA" or "New York, NY"), implement
a `parseLocation` helper that:
- Splits on the last comma
- Trims both parts
- If the right part is a 2-letter US state abbreviation in
  `US_STATE_ABBREVS`, sets `state` from it and `city` from
  the left part
- If no comma or no valid state abbreviation found, stores
  the whole string as `location` and leaves `state` empty

**1h. Update detectListType and rowLooksLikeHeaderRow**

Add the new normalized aliases from 1b, 1d to both
`detectListType` and `rowLooksLikeHeaderRow` so the
detection heuristics work with the expanded alias set.

### Acceptance criteria
- Upload a CSV with column "Organization" → tool detects
  company list correctly
- Upload a CSV with column "First" and "Last" → tool detects
  contact list correctly
- Upload Image 3 format (company + title + industry + city
  + state + employees) → all columns map correctly
- Upload Image 6 format (first, last, title, company,
  location as "City, State") → location splits correctly
- Upload Image 9 format (attended, format, first, last,
  company, title, email) → attended and format map correctly

---

## Section 2 — CSV as a data source (Phase 1)

### Context
Pre-enriched CSV columns are now treated as a Phase 1
data source alongside ZoomInfo and HubSpot. They feed
into the merge phase rather than being ignored.

### Files to modify
- `src/lib/enrichment/ai-enricher.ts`
- `src/lib/enrichment/merger.ts`

### What to change

**2a. Pass CSV fields into enrichment rows**

When building the initial enrichment payload from parsed rows,
carry the following CSV fields forward onto the enrichment row
so they are available during merge:

For companies:
- `csvDomain` — from `RawCompanyRow.domain` if present
- `csvState` — from `RawCompanyRow.state` if present
- `csvEmployees` — from `RawCompanyRow.employees` if present
- `csvIndustry` — from `RawCompanyRow.industry` if present

For contacts:
- `csvDomain` — from `RawContactRow.companyDomain` if present
- `csvState` — from `RawContactRow.state` if present
- `csvEmployees` — from `RawContactRow.employees` if present
- `csvIndustry` — from `RawContactRow.industry` if present
- `csvTitle` — from `RawContactRow.title` if present
  (title is highest trust for contacts — CSV wins over ZoomInfo)

Add these as optional fields to `EnrichedCompany` and
`EnrichedContact` types in `src/lib/utils/types.ts`.

**2b. Trust hierarchy for CSV fields in merger**

In `merger.ts`, apply CSV fields with the following priority:

For companies (lower trust than ZoomInfo, higher than nothing):
- `csvDomain`: use as AI-equivalent domain. ZoomInfo domain
  still wins on conflict. If ZoomInfo has no domain and AI
  has no domain, use csvDomain.
- `csvState`: use as fallback if ZoomInfo returns no state.
  Do not use if ZoomInfo returns a state.
- `csvEmployees`: use as fallback if ZoomInfo returns no
  employee count. Do not use if ZoomInfo returns one.
- `csvIndustry`: use as fallback if ZoomInfo returns no
  industry. Do not use if ZoomInfo returns one.

For contacts:
- `csvTitle`: highest trust. Use CSV title first. ZoomInfo
  fills only if CSV has no title. Never overwrite CSV title
  with ZoomInfo title.
- `csvDomain`: same as company — ZoomInfo wins on conflict,
  CSV used as fallback.
- `csvState`: fallback only.
- `csvEmployees`: fallback only.
- `csvIndustry`: fallback only.

### Acceptance criteria
- Upload company list with domain column → domain field
  populated from CSV on rows where ZoomInfo finds no domain
- Upload contact list with title column → CSV title used,
  ZoomInfo title only fills rows where CSV title is empty
- Upload company list with state column → CSV state used
  as fallback when ZoomInfo state is empty

---

## Section 3 — Three-phase pipeline architecture

### Context
The current pipeline conflates collection and merging.
Sources run sequentially and each overwrites the previous.
This section restructures the pipeline so all sources
collect independently (Phase 1) before merging (Phase 2)
before pushing (Phase 3).

The most critical sequencing fix: HubSpot pre-check must
run AFTER ZoomInfo, using ZoomInfo's domain as the match
key rather than the AI-resolved domain.

### Files to modify
- `src/app/page.tsx` — event mode orchestration
- `src/app/api/jobs/process/route.ts` — bulk mode worker
- `src/app/api/hubspot/precheck/route.ts`

### What to change

**3a. Reorder enrichment phases — event mode**

In `runEnrichment` in `page.tsx`, change the execution order:

CURRENT ORDER:
1. AI enrichment
2. HubSpot pre-check
3. ZoomInfo verify
4. LinkedIn fallback

NEW ORDER:
1. AI enrichment (identity resolution only — unchanged)
2. ZoomInfo verify (always runs — unchanged)
3. HubSpot pre-check (NOW runs after ZoomInfo)
4. LinkedIn fallback (unchanged)

**3b. Pass ZoomInfo domain into HubSpot pre-check**

After ZoomInfo verify completes and rows have been updated
with ZoomInfo data, the rows passed into HubSpot pre-check
should now carry the ZoomInfo-resolved domain (if present)
rather than only the AI-resolved domain.

In `precheck/route.ts`, for company rows:
- Use `row.domain` as the primary lookup key (this will now
  be the ZoomInfo domain when ZoomInfo ran successfully)
- Normalization with `normalizeDomain` stays unchanged

For contact rows:
- Use the resolved work email as the primary lookup key
  (unchanged — email matching is correct)
- If the contact had a personal email in CSV but ZoomInfo
  returned a work email, the work email should be the
  resolved email by this point (handled in Section 5)

**3c. Reorder enrichment phases — bulk mode**

Apply the same reordering in `src/app/api/jobs/process/route.ts`.
The bulk worker should follow identical phase ordering:
AI → ZoomInfo → HubSpot pre-check → LinkedIn fallback.

### Acceptance criteria
- Console logs show ZoomInfo completing before HubSpot
  pre-check starts
- A company that exists in HubSpot with a domain that AI
  resolved slightly differently (e.g. AI got "rushuniversity.com"
  but ZoomInfo returns "rush.edu") now matches in HubSpot
  using the ZoomInfo domain
- Bulk mode follows the same order as event mode

---

## Section 4 — Selective overwrite logic (critical bug fix)

### Context
Two versions of the HubSpot update function exist.
Version A (careful): reads existing record, fills only
empty fields. Version B (blunt): sends all data, overwrites
everything. Version A exists but is never called.
Version B runs on every update.

This section wires in field-specific write rules so each
field follows its defined overwrite behavior from the
trust tables.

### Files to modify
- `src/lib/hubspot/companies.ts`
- `src/lib/hubspot/contacts.ts`
- `src/lib/hubspot/push-handler.ts`

### What to change

**4a. Company field write rules**

In `companyProperties` in `companies.ts`, implement the
following write behavior for each field. "Overwrite" means
always send the value. "Fill empty only" means only send
the value if the existing HubSpot field is empty or null.

| Field | HubSpot property | Write rule |
|---|---|---|
| Company name | `name` | Fill empty only |
| Domain | `domain` | Never overwrite. Fill if HubSpot has no domain. |
| Website | `website` | Fill empty only |
| State/Region | `state` | Overwrite |
| Employee count | `numberofemployees` | Overwrite |
| Annual revenue | `annualrevenue` | Overwrite |
| Industry | `industry` | Fill empty only |
| Description | `description` | Fill empty only |
| City | `city` | Overwrite |
| LinkedIn | `linkedin_company_page` | Fill empty only (never overwrite pre-review) |
| Phone | `phone` | Fill empty only |

Implementation: When building the properties payload for
a batch UPDATE (not create), check the existing HubSpot
values from the pre-check data stored on the row
(`row.existingData` or equivalent). For "fill empty only"
fields, only include the field in the payload if the
existing HubSpot value is null, undefined, or empty string.
For "overwrite" fields, always include the field regardless
of existing value.

For batch CREATE, always send all available fields
(no existing data to preserve).

**4b. Contact field write rules**

In `contactProperties` in `contacts.ts`, implement the
following write behavior:

| Field | HubSpot property | Write rule |
|---|---|---|
| First name | `firstname` | Fill empty only |
| Last name | `lastname` | Fill empty only |
| Email | `email` | Never overwrite |
| Phone | `phone` | Fill empty only |
| Job title | `jobtitle` | Fill empty only |
| Company name | `company` | Fill empty only |
| LinkedIn | `ds_liprofile` | Fill empty only (never overwrite pre-review) |
| State/Region | `state` | Overwrite |
| City | `city` | Overwrite |
| Job level | `job_level` | Fill empty only |
| Job function | `job_function` | Fill empty only |
| Employee count | `numemployees` | Overwrite |
| Industry | `industry` | Fill empty only |
| Website | `website` | Fill empty only |
| Lead source | `lead_source__deal_source` | Fill empty only |
| Lead source description | `lead_source_description` | Fill empty only |
| Membership notes | `hs_content_membership_notes` | Fill empty only |

**4c. Existing data availability at write time**

The pre-check data for matched records is already available
on enriched rows (via `existingData` populated during
pre-check merge). Ensure this data is passed through to
`companyProperties` and `contactProperties` at push time
so the fill-empty-only logic has the existing values
to compare against.

For rows being CREATED (no hubspotId), existing data is
null — treat all fields as empty and send all available
values.

For rows being UPDATED (hubspotId present), use the
existing data from pre-check to determine which fields
to include in the payload.

### Acceptance criteria
- Run a list where a matched HubSpot company has an existing
  industry value → industry is NOT overwritten
- Run a list where a matched HubSpot company has no state →
  state IS written from ZoomInfo
- Run a list where a matched HubSpot company has a state →
  state IS overwritten with ZoomInfo value (overwrite rule)
- Run a list where a matched HubSpot contact has an existing
  job title → title is NOT overwritten
- Run a list where a matched HubSpot contact has no LinkedIn
  → LinkedIn IS filled from best available source

---

## Section 5 — Email resolution and personal email handling

### Context
Contacts with personal emails (gmail, yahoo, etc.) are
currently excluded entirely. The new behavior: attempt
ZoomInfo lookup by name + company, use work email as
canonical if found, store personal email as additional
email if possible.

No-email contacts should also be looked up by name + company
rather than immediately excluded.

### Files to modify
- `src/lib/enrichment/zoominfo-enricher.ts`
- `src/lib/enrichment/merger.ts`
- `src/lib/utils/types.ts`

### What to change

**5a. Detect personal vs work email**

Create a helper `isPersonalEmail(email: string): boolean`
in a shared utility file. Returns true if the email domain
matches a known personal/ISP provider list including but
not limited to:
gmail.com, yahoo.com, hotmail.com, outlook.com, icloud.com,
aol.com, comcast.net, verizon.net, att.net, msn.com,
live.com, me.com, mac.com, protonmail.com, proton.me

**5b. Personal email path — ZoomInfo lookup**

In ZoomInfo contact enrichment, when the contact's email
is personal (detected by 5a), do NOT use the email for
ZoomInfo lookup. Instead:
- Use name + company for ZoomInfo search
- If ZoomInfo returns a contact with a work email,
  use that work email as the canonical `resolvedEmail`
- Store the original personal email in a new field
  `personalEmail?: string` on `EnrichedContact`
- Mark `emailSource: "zoominfo"` on the row

**5c. No-email contacts**

When a contact has no email at all in the CSV:
- Attempt ZoomInfo search by firstName + lastName + company
- If ZoomInfo returns a contact with email, use it
- If ZoomInfo returns nothing, proceed without email
- Do NOT exclude — flag as Needs Review (handled in Section 7)

**5d. Additional email field**

Add `personalEmail?: string` to `EnrichedContact` type.
In `contactProperties`, if `personalEmail` is set and
HubSpot supports additional emails, include it as an
additional email. If HubSpot additional emails API is
not currently implemented, log the personal email and
note it in the push summary for manual reference.
Do not block the push on this.

### Acceptance criteria
- Contact with gmail address → ZoomInfo lookup by name +
  company runs, work email used as canonical if found
- Contact with no email → ZoomInfo lookup runs, not excluded
- Contact with personal email where ZoomInfo finds nothing
  → contact remains in pipeline as Needs Review,
  not excluded

---

## Section 6 — HubSpot matching improvements

### Context
Two matching gaps exist:
1. Companies have no name-based fallback when domain is empty
2. The duplicate company problem (two records, same domain)
   has no tie-breaking logic

### Files to modify
- `src/lib/hubspot/companies.ts`
- `src/lib/hubspot/push-handler.ts`

### What to change

**6a. Company name fallback matching**

In `push-handler.ts`, for company rows that have no domain
AND were not matched by domain lookup, add a last-resort
fallback:
- Normalize the company `resolvedName` (trim, lowercase,
  remove punctuation, remove common suffixes like "Inc",
  "LLC", "Corp", "Ltd", "Co")
- Search HubSpot for companies with a name containing the
  normalized string using a HubSpot name search
- Require exactly one result to accept the match
  (same pattern as findContactByNameAndCompany)
- If matched: use that hubspotId, flag the row with
  `matchedByName: true`
- If not matched or multiple results: proceed to create

This fallback is low-confidence. Any row matched via name
fallback should be surfaced in the push summary as
"Matched by name only — verify in HubSpot."

**6b. Duplicate domain tie-breaking**

In `batchFindCompaniesByDomain`, when a domain lookup
returns multiple HubSpot company records:
- Pick the record most recently modified
  (`hs_lastmodifieddate` descending)
- Log which record was selected and which were skipped
- Add a counter to the push summary: "X domain conflicts
  resolved automatically — verify in HubSpot"

**6c. Government detection — add state universities**

In `prereview.ts`, add `"university of "` to the
`GOV_NAME_PATTERNS` array.

Also add:
- `"community college"`
- `"state college"`

Note in a code comment that these are substring matches
and could theoretically match company names containing
these phrases — this is acceptable given the low frequency
and the availability of manual override.

### Acceptance criteria
- Company with no domain but clear name finds existing
  HubSpot record via name fallback
- Company with no domain and ambiguous name (multiple
  HubSpot matches) proceeds to create rather than
  matching incorrectly
- "University of Illinois" → excluded as government
- "University of Health Sciences" → excluded as government
- "Community College of Denver" → excluded as government

---

## Section 7 — Confidence bucket rework

### Context
The current bucket definitions do not reliably separate
records that need attention from records that are clean.
Trusted currently does not mean "zero review needed."
This section replaces the bucket logic entirely.

### Files to modify
- `src/lib/utils/prereview.ts`
- `src/lib/utils/types.ts` (if new fields needed)

### What to change

**7a. New Excluded logic — companies**

A company is EXCLUDED if ANY of these are true:
1. `isInternationalCompany(row)` returns true AND
   ZoomInfo returned no US state (row.state is empty
   after ZoomInfo enrichment)
2. `isGovernmentCompany(row)` returns true
3. AI total non-resolution: `row.resolvedName` is empty
   AND `row.domain` is empty after all enrichment
4. ZoomInfo returned nothing (row.enrichedByZoomInfo
   is false) AND AI confidence is low or unresolved
   (row.confidenceScore === "low" or row.identityConfidence
   === "low" or "unresolved")

**7b. New Excluded logic — contacts**

A contact is EXCLUDED if ANY of these are true:
1. `isPersonalEmail(row.resolvedEmail)` is true AND
   ZoomInfo found no work email (row.emailSource is not
   "zoominfo" and no work email resolved)
2. No name at all: firstName and lastName are both empty
3. AI total non-resolution AND ZoomInfo found nothing

**7c. New Needs Review logic — companies**

A company is NEEDS REVIEW if it passed Excluded and has
ANY of these:
1. No domain after full enrichment
   (`row.domain` is empty or null)
2. Domain conflict: ZoomInfo domain and HubSpot domain
   are both present and differ after normalization
3. Company name conflict: AI and ZoomInfo agree on a name
   meaningfully different from HubSpot name
   (implement a `namesConflict(a, b)` helper that returns
   true if the root words differ meaningfully — ignore
   punctuation, "Inc", "LLC", etc.)
4. ZoomInfo returned nothing:
   `row.enrichedByZoomInfo` is false
5. AI confidence low but ZoomInfo returned data
   (partial verification only)
6. Empty state/region after full enrichment
7. Empty employee count after full enrichment

**7d. New Needs Review logic — contacts**

A contact is NEEDS REVIEW if it passed Excluded and has
ANY of these:
1. Personal email AND no domain
   (isPersonalEmail true AND row.companyDomain empty)
2. Email conflict: CSV email and HubSpot email differ
   for what appears to be the same person
   (flag if emails differ but name + company match)
3. No company name after enrichment
4. No domain after enrichment
5. Missing LinkedIn after all four sources failed
   (row.linkedinUrl is empty AND all source attempts
   returned nothing)
6. ZoomInfo returned nothing (enrichedByZoomInfo false)
7. ZoomInfo contactAccuracyScore below 50
   (add `ziContactAccuracyScore?: number` to
   EnrichedContact type, populate from ZoomInfo response)
8. Job title empty after full enrichment

**7e. New Trusted logic — companies**

A company is TRUSTED if it passed Excluded AND meets
Path A or Path B:

Path A (ZoomInfo verified):
- enrichedByZoomInfo is true
- No domain conflict (7c rule 2 is false)
- No name conflict (7c rule 3 is false)
- domain is non-empty
- state is non-empty
- employeeCount is non-empty

Path B (HubSpot verified):
- hubspotId is non-null (record exists in HubSpot)
- existingData has non-empty values for domain, state,
  and employees
- No domain conflict

LinkedIn amber flag (applies to both paths):
- If row.linkedinSource === "ai_search", mark row with
  `linkedinAmberFlag: true`
- Row remains Trusted — amber flag is display-only
- Add `linkedinAmberFlag?: boolean` to EnrichedCompany type

**7f. New Trusted logic — contacts**

A contact is TRUSTED if it passed Excluded AND meets
Path A or Path B:

Path A (ZoomInfo verified):
- resolvedEmail is a work email (not personal)
- No email conflict
- resolvedCompany is non-empty
- companyDomain is non-empty
- enrichedByZoomInfo is true
- ziContactAccuracyScore is 50 or above (or null/undefined —
  score missing is not a disqualifier, only low score is)
- title is non-empty
- linkedinUrl is non-empty

Path B (HubSpot or Common Room verified):
- resolvedEmail is a work email
- No email conflict
- HubSpot record exists (hubspotId non-null) with
  non-empty email, title, company, and state
  OR Common Room returned a full record
- resolvedCompany is non-empty
- companyDomain is non-empty
- linkedinUrl is non-empty

LinkedIn amber flag for contacts:
- Same as companies — ai_search source sets
  linkedinAmberFlag: true, row stays Trusted

Records with missing LinkedIn (linkedinUrl empty after
all sources) → always Needs Review, never Trusted.

**7g. Display ordering within Trusted**

Add a `trustedSortTier` value to each Trusted row:
- 1: linkedinAmberFlag is true (sort to top)
- 2: all other Trusted rows

Apply this sort in ReviewTable.tsx within the Trusted
filter view. Within each tier, maintain stable order.

**7h. International override**

For Excluded rows with exclusionReason "international",
add a UI control in ReviewTable.tsx that allows the
operator to flip the row from Excluded to Needs Review.
Label it "Include anyway" or similar.
This is the only bucket override available — operators
cannot manually force a row into Trusted.

### Acceptance criteria
- Run a real contact list — Trusted bucket contains only
  records where you would genuinely take no action
- A company verified by both ZoomInfo and HubSpot with
  clean data → Trusted
- A company with ZoomInfo data but no state → Needs Review
- A company that is international with no US state →
  Excluded
- A company that is international but ZoomInfo returned
  a US state → NOT excluded (passes through to bucket logic)
- A contact with missing LinkedIn → Needs Review
- A contact with AI LinkedIn → Trusted with amber flag
  at top of Trusted list
- Amber flag contacts sorted to top of Trusted view

---

## Section 8 — Contact-to-company association

### Context
Contacts currently land in HubSpot with a company name
text field but no structural CRM association. This section
adds domain-based company lookup and association writing
as part of every contact push.

### Files to modify
- `src/lib/hubspot/push-handler.ts`
- `src/lib/hubspot/contacts.ts`
- `src/lib/utils/types.ts`

### What to change

**8a. Domain-based company lookup before contact push**

In `push-handler.ts`, before writing contacts, add a
company pre-lookup phase:

1. Collect all non-empty `companyDomain` values from
   approved contact rows. Use `companyDomain` first,
   fall back to `ziCompanyWebsite` if companyDomain
   is empty.
2. Call `batchFindCompaniesByDomain` with those domains.
   This function already exists — reuse it.
3. Build a `domainToCompanyIdMap: Map<string, string>`
   from the results.

**8b. Tie-breaking for multiple companies on same domain**

If `batchFindCompaniesByDomain` returns multiple records
for a domain, pick the one with the most recent
`hs_lastmodifieddate`. Track these as resolved conflicts
for the push summary.

**8c. Write HubSpot association after contact create/update**

After all contacts are created or updated and their
hubspotIds are known, for each contact that has a resolved
`hubspotCompanyId` from the domain lookup:

Call HubSpot associations API:
```
PUT /crm/v4/associations/contacts/companies/batch/create
```

Body:
```json
{
  "inputs": [
    {
      "from": { "id": "<contactHubSpotId>" },
      "to": { "id": "<companyHubSpotId>" },
      "types": [
        {
          "associationCategory": "HUBSPOT_DEFINED",
          "associationTypeId": 279
        }
      ]
    }
  ]
}
```

associationTypeId 279 is the standard contact-to-company
primary association. Batch this in chunks of 100.
Add 200ms cooldown between chunks (same pattern as other
batch operations).

**8d. Add hubspotCompanyId to EnrichedContact**

Add `hubspotCompanyId?: string` to `EnrichedContact` type.
Populate it from the domain lookup map in push-handler
before creating/updating contacts.

**8e. Post-push counters for ownership report**

Track and surface in the push done payload:

- `contactsAssociated: number` — contacts successfully
  linked to a HubSpot company
- `contactsDomainNotFound: number` — contacts where
  domain was present but no HubSpot company found
- `contactsNoDomain: number` — contacts where no domain
  was available for lookup

Add these to `HubSpotPushDonePayload` in
`src/lib/hubspot/push-result.ts`.

Surface in `SuccessScreen`:
- "X contacts associated to HubSpot companies"
- "X contacts: company not in HubSpot
  (no company association made)"
- "X contacts: no company domain available
  (no company association possible)"

Also surface the ownership failure counters:
- "X companies have no state/region — may not get an
  owner assigned automatically"
- "X contacts have no HubSpot company association —
  may not get an owner assigned automatically"

Calculate ownership failure counts in push-handler before
writing to HubSpot:
- Company ownership failures: approved company rows where
  `state` is empty after enrichment
- Contact ownership failures: approved contact rows where
  `hubspotCompanyId` could not be resolved from domain

### Acceptance criteria
- Push a contact list where most contacts' company domains
  exist in HubSpot → contacts show as associated in HubSpot
  after push
- Push a contact whose company is not in HubSpot → contact
  created without association, success screen shows count
- Success screen shows association summary counts
- Success screen shows ownership failure counts for both
  companies and contacts

---

## Section 9 — ZoomInfo contactAccuracyScore

### Context
ZoomInfo returns a contactAccuracyScore (0-100) in contact
enrich responses. This field is not currently captured.
It should be captured and used in confidence bucket logic.

### Files to modify
- `src/lib/enrichment/zoominfo-enricher.ts`
- `src/lib/utils/types.ts`

### What to change

**9a. Add contactAccuracyScore to outputFields**

In `zoominfo-enricher.ts`, add `"contactAccuracyScore"` to
the contact enrich `outputFields` array.

**9b. Extract and store the score**

After contact enrich, extract `attrs.contactAccuracyScore`
(number or null) and store it as `ziContactAccuracyScore`
on the enriched contact row.

Add `ziContactAccuracyScore?: number` to `EnrichedContact`
in `types.ts` if not already added in Section 7.

**9c. Score thresholds**

These thresholds are consumed by the bucket logic in
Section 7. No additional logic needed here — just ensure
the value is correctly extracted and typed as number.

Thresholds (for reference — implemented in prereview.ts):
- 85+: corroborates high confidence
- 50-84: neutral
- Below 50: flag Needs Review
- Below 25: discard ZoomInfo enrichment data for this
  contact (do not use any ZoomInfo fields on this row)

For the below-25 case: add a flag `ziMatchDiscarded: true`
to the row and do not apply any ZoomInfo-sourced field
values during merge. The row proceeds with AI + CSV +
HubSpot data only.

### Acceptance criteria
- After ZoomInfo contact enrich, rows have
  ziContactAccuracyScore populated where ZoomInfo
  returned the field
- A contact with score below 25 does not receive
  ZoomInfo field values in the merged record
- A contact with score below 50 lands in Needs Review

---

## Section 10 — Pre-push field preview

### Context
Before pushing to HubSpot, the operator should see exactly
which fields are being written for each approved record.

### Files to modify
- `src/components/PrePushScreen.tsx` or equivalent
- `src/app/page.tsx` (if PrePushScreen receives props here)

### What to change

**10a. Field preview table**

In the Import Settings / pre-push screen, after the operator
sets list name, lead source, and folder, add a collapsible
section labeled "Preview fields being pushed to HubSpot."

When expanded, show a table with:
- One row per approved record
- Columns: Record name | Fields being written (count) |
  Fields being skipped — HubSpot already has value (count)
- Expandable per row to see the actual field values and
  whether each will be written or skipped

For "written" vs "skipped" determination, use the same
fill-empty-only logic from Section 4 — compare merged
values against existingData.

**10b. Ownership failure preview**

Below the field preview, show the ownership failure
counters calculated in Section 8e, before the push
happens. Label clearly:
"After this push, the following records may not have
an owner assigned automatically:"
- X companies with no state/region
- X contacts with no HubSpot company association

### Acceptance criteria
- Pre-push screen shows preview section
- Preview accurately reflects which fields will be
  written vs skipped for each record
- Ownership failure counts shown before push

---

## What this SPEC does NOT include

The following are intentionally deferred to SPEC 2 or SPEC 3:

- Confidence bucket UI rework (tooltips, display copy) → SPEC 3
- Row reordering fix → SPEC 3
- State/region picker fix → SPEC 3
- HubSpot folder picker live connection → SPEC 3
- International company graceful handling in UI → SPEC 3
- Auth → SPEC 3
- Pre-Review Common Room stats → SPEC 3
- Parsed table preview clarity → SPEC 3
- Broader confidence bucket UI (Trusted/Needs Review
  visual separation, amber dot display) → SPEC 2
- Auto-creating company records during contact push → V2
- Company Type field → V2
- Multiple emails per contact (HubSpot additional emails
  API) → V2 if API not readily available

---

## Testing this SPEC

There is no automated test suite. Manual validation steps:

1. Upload Image 1 format (company name only) → pipeline
   completes, ZoomInfo runs, HubSpot check runs after ZoomInfo
2. Upload Image 3 format (company + pre-enriched fields)
   → CSV fields used as Phase 1 source
3. Upload Image 9 format (full event format with attended,
   format, notes columns) → all columns mapped correctly
4. Upload a contact list where some contacts have personal
   emails → ZoomInfo lookup runs, work emails used where found
5. Upload a contact list with a contact whose company exists
   in HubSpot → contact associated to company after push
6. Verify success screen shows association counts and
   ownership failure counts
7. Verify an existing HubSpot company with a manually
   curated industry → industry NOT overwritten after push
8. Verify an existing HubSpot company with a stale state
   → state IS overwritten with ZoomInfo value after push
9. Verify Trusted bucket contains only records you would
   genuinely take no action on
10. Verify contacts with missing LinkedIn land in Needs Review
11. Verify contacts with AI LinkedIn land in Trusted with
    amber flag at top of list