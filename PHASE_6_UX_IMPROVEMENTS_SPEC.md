# Phase 6 — UX Improvements Spec

**Scope:** UI/UX improvements across all existing phases. No new enrichment logic.  
**Stack:** Next.js 15, TypeScript, Tailwind CSS  
**Rule:** Do not modify any enrichment logic (AI, ZoomInfo, Common Room), parsing logic, or HubSpot push API logic. Only modify UI components and `page.tsx` unless explicitly told otherwise.

---

## 1. Upload Screen (Step 1)

### 1.1 Paginated Raw Preview
- Show only the first 10 rows of the raw preview table by default
- Add pagination below the table: "← Previous | Page 1 of 4 | Next →"
- Each page shows 10 rows
- This is called **pagination** — use simple prev/next buttons with a page counter
- No full page reload — update displayed rows in React state only

### 1.2 Duplicate Row Handling
- When duplicates are detected, replace the current yellow warning banner with a more actionable UI
- Show the duplicate warning with the affected row numbers as before
- Below the warning, show the two duplicate rows side by side so the user can see them
- Add two buttons:
  - **"Remove Duplicate"** — removes the second (later) occurrence and continues with the deduplicated list. Updates the row count display.
  - **"Keep Both"** — dismisses the warning and proceeds with both rows intact
- The user must click one of these before the "Continue" button becomes active
- If there are multiple duplicate pairs, handle them one at a time (show the first pair, resolve it, then show the next if any)
- After all duplicates are resolved, the Continue button activates

---

## 2. Event Context Screen (Step 2)

### 2.1 Remove fields
- Remove **Primary Industry** field entirely
- Remove **Additional Notes** field entirely

### 2.2 Event Date — Calendar picker
- Replace the plain text input with a proper date picker
- Use the native HTML `<input type="date">` styled to match the rest of the form
- Display the selected date in a human-readable format: "March 15, 2026"
- Store the value as a formatted string like "March 2026" for use in enrichment prompts (just month + year, not the specific day)

### 2.3 Region → State dropdown
- Rename the field label from "Region" to "State"
- Replace the current region select with a full US state dropdown (all 50 states + DC)
- Options should be full state names: "Alabama", "Alaska", ..., "Wyoming"
- Keep "National" and "International" as the first two options for non-state-specific events
- The selected value gets passed to the AI enrichment context as before

### 2.4 Audience Level — prefilled suggestion
- Pre-populate the Audience Level field with the value: `CISOs, SOC team leaders, security leaders`
- The user can edit it freely
- Style it so it's clear it's a suggestion: show the text in a slightly muted color until the user focuses the field, at which point it becomes normal text
- This is NOT a placeholder — the value is actually set in state so pressing Tab moves to the next field with the value retained

### 2.5 Field order
Final field order on the form:
1. Event Name (required)
2. Event Date (required, date picker)
3. State (required, dropdown)
4. Audience Level (required, pre-populated)
5. Lead Source (required, dropdown — see section 4.2 for options)

Move **Lead Source** from the final push screen to here — it makes more sense to capture it with event context. Remove it from the final push screen.

---

## 3. AI Enrichment Screen (Step 3)

### 3.1 Browser notification + sound
- When enrichment completes, trigger a browser notification:
  - Request notification permission when the enrichment step starts (before the API call): `Notification.requestPermission()`
  - If granted, fire: `new Notification('Realm Enrichment Tool', { body: 'Enrichment complete — ready for review!', icon: '/favicon.ico' })`
  - Also play a short notification sound using the Web Audio API (a simple pleasant 3-note chime, generated programmatically — do not use an external audio file)
- The notification should fire whether or not the user is on the tab

### 3.2 Cancel button
- Add a **"Cancel"** button below the progress bar
- On click: abort the in-flight fetch request (use `AbortController`) and navigate the user back to the Event Context form (Step 2)
- The event context form should retain all previously entered values — do not clear the form on cancel
- Add a small **"← Back to upload"** text link above the form on the Event Context screen that takes the user back to Step 1 (upload). This clears all state.

---

## 4. Review Table (Step 4 — renamed "Output")

### 4.1 Text wrapping
- Fix the LinkedIn URL column so it wraps properly and does not overflow into adjacent columns
- Set `max-w-[200px] break-all` on the LinkedIn cell
- All columns should have proper word wrapping

### 4.2 Column rename
Rename columns to these exact labels (in this order):
| Old name | New name |
|----------|----------|
| Approve | Approve |
| Raw Input | Raw Input |
| Resolved Name | Company Name |
| Domain | Company Domain Name |
| State | State/Region |
| Employees | Number of Employees |
| LinkedIn URL | LinkedIn Profile |
| Confidence | Confidence |
| Reasoning | Reasoning |

### 4.3 Full state names
- Replace all two-letter state abbreviations with full state names in the State/Region column
- Examples: "IL" → "Illinois", "TN" → "Tennessee", "NY" → "New York"
- Create a utility function `expandStateAbbreviation(abbr: string): string` in `src/lib/utils/states.ts`
- Apply this both when displaying in the table and when storing in the enriched row data

### 4.4 Row sorting
- Default sort order: **by confidence level (Low/Unresolved first, then Medium, then High), then alphabetically by Company Name within each group**
- Sort order: Unresolved → Low → Medium → High (lowest confidence at top so user sees what needs attention first)
- Within each confidence group: A → Z by Company Name
- This sort is applied automatically when the review table first renders
- Do not add a sort UI control — just apply this as the default

### 4.5 Inline editing — all columns
- Make ALL columns editable inline except: Approve (checkbox), Raw Input, Confidence, Reasoning
- This means adding inline edit to: Company Name, Company Domain Name, State/Region, Number of Employees, LinkedIn Profile
- State/Region inline edit should be a dropdown (same full state list as the context form) not a free text field
- All other editable fields remain free text inputs
- Edited cells retain the blue dot indicator from Phase 4

### 4.6 "Approve" button replaces "Push to HubSpot"
- Rename the sticky footer button from "Push X companies to HubSpot →" to **"Approve →"**
- Clicking it does NOT push to HubSpot yet
- Instead it navigates to a new **Pre-Push screen** (Step 5 — see section 5)
- The button still shows the count: "Approve 32 records →"
- Still disabled until at least 1 row is approved

---

## 5. New Pre-Push Screen (new Step 5)

This is a new screen inserted between the review table and the HubSpot push.

### 5.1 Layout
- Header: "Ready to Import"
- Subtitle: "Review your import settings before pushing to HubSpot"
- Show a read-only summary table of approved records (compact, no editing — just Name, Domain, Confidence columns)
- Below the summary table: the import settings form

### 5.2 Import settings form fields

**List/Segment Name** (required, text input)
- Pre-populated with the event name from context (e.g. "CISOExecNet Midwest Mar. 2026")
- User can edit

**List/Segment Folder** (required, dropdown)
- Fetch real folder list from HubSpot on page load using:
  ```
  GET https://api.hubapi.com/contacts/v1/lists/folders
  ```
- Display folder names as options
- Show a loading state while fetching: "Loading folders..."
- If fetch fails, fall back to a free text input with a note: "Could not load folders — enter manually"
- Add a new API route `src/app/api/hubspot/folders/route.ts` that fetches and returns the folder list

**Lead Source** (required, dropdown)
- This field moves here from the Event Context form (remove it from Step 2)
- Options (exact strings):
  - Marketing - Advertisement
  - Marketing - CisoExecNet
  - Marketing - CISO XC
  - Marketing - Cyalliance
  - Marketing - Cybersecurity Summit
  - Marketing - ExecWeb
  - Marketing - FutureCon
  - Marketing - SageTap
  - Marketing - Social Media
  - Marketing - Trade Show
  - Marketing - Webinar
  - Marketing - Website

**Lead Source Description** (required, text input)
- Pre-populated with the event name from context
- User can edit

**Notes** (optional, textarea)
- Free text, no pre-population

### 5.3 Navigation
- **"← Back to Review"** button — goes back to the review table (Step 4), preserving all edits and approval states
- **"Push to HubSpot →"** button — triggers the actual push (calls `/api/hubspot/push`)
- The Push button is disabled until List Name, Lead Source, and Lead Source Description are filled

### 5.4 Pass import settings to HubSpot push
- Update `POST /api/hubspot/push` to accept additional fields: `listName`, `folderId`, `leadSource`, `leadSourceDescription`, `notes`
- Pass `leadSource` and `leadSourceDescription` as HubSpot contact/company properties on every pushed record
- Use `listName` instead of `eventName` for the static list name
- If `folderId` is provided, pass it when creating the static list

---

## 6. HubSpot Push — Never Overwrite Existing Values

### 6.1 Update push logic in `src/lib/hubspot/companies.ts` and `src/lib/hubspot/contacts.ts`

**Current behavior:** `updateCompany` and `updateContact` send all fields, overwriting whatever is in HubSpot.

**New behavior:** Before updating, fetch the existing record's current property values. Only include a property in the PATCH request if the current HubSpot value is null, empty string, or "0" (for numberofemployees).

**Implementation for `updateCompany`:**
```typescript
// 1. Fetch existing record properties
GET /crm/v3/objects/companies/{id}?properties=name,domain,website,state,numberofemployees,linkedin_company_page

// 2. Build update payload with only null/empty fields
const updates: Record<string, string> = {};
if (!existing.name) updates.name = company.resolvedName;
if (!existing.domain) updates.domain = company.domain;
if (!existing.website) updates.website = `https://www.${company.domain}`;
if (!existing.state) updates.state = company.state;
if (!existing.numberofemployees || existing.numberofemployees === '0') 
  updates.numberofemployees = String(company.numberOfEmployees ?? '');
if (!existing.linkedin_company_page) updates.linkedin_company_page = company.linkedinUrl;

// 3. Only PATCH if there is something to update
if (Object.keys(updates).length > 0) {
  PATCH /crm/v3/objects/companies/{id} with { properties: updates }
}
```

Apply the same pattern to `updateContact` for all contact fields.

---

## 7. Success Screen

### 7.1 Minor updates
- Change "HubSpot List Created:" label to "HubSpot Segment Created:"
- The list link should use `listName` (from the pre-push form) not `eventName`
- Show the Lead Source that was used: "Lead Source: Marketing - CisoExecNet"

---

## Implementation order for Cursor

Build in this order to avoid breaking existing functionality:

1. `src/lib/utils/states.ts` — state abbreviation expansion utility (needed by multiple components)
2. `src/app/api/hubspot/folders/route.ts` — HubSpot folder fetch
3. Update `src/lib/hubspot/companies.ts` and `contacts.ts` — no-overwrite logic
4. Update `src/app/api/hubspot/push/route.ts` — accept new fields
5. Update `src/components/ReviewTable.tsx` — column renames, sorting, full state names, all-column editing, text wrapping, "Approve →" button
6. New `src/components/PrePushScreen.tsx` — the new Step 5
7. Update `src/components/EventContextForm.tsx` — remove fields, add date picker, state dropdown, pre-populated audience level, remove Lead Source (moved to PrePushScreen)
8. Update upload screen in `src/app/page.tsx` — pagination, duplicate handling UI
9. Update enrichment screen — browser notification, sound, cancel button, back link
10. Update `src/app/page.tsx` — wire new step flow, pass new fields through

**When done, stop. Do not loop or re-edit completed files.**