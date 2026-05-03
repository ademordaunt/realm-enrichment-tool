Realm Enrichment Tool — Product Brief (v2)
What it is
A web app that transforms raw marketing event CSVs into clean, enriched lead lists and pushes them into HubSpot as static lists. Supports both company lists and contact lists across a wide variety of input formats.
Why it exists
Every marketing event produces an attendee spreadsheet in a different format with varying data quality. Getting those records into HubSpot — clean, enriched, and organized — previously required 2-3 hours of manual work across ZoomInfo, Common Room, HubSpot, LinkedIn, Claude, and Google. This tool automates that pipeline end to end.
Who uses it
Primary user: Tyler (marketing ops). One person. Technical level: comfortable with web tools, has Claude Code, builds websites. Can modify and extend the codebase independently. Secondary context: built and maintained by Casey (rev ops). No other users intended.

Pipeline architecture — three phases
The pipeline runs in three phases. This is the load-bearing design decision of the entire tool.
Phase 1 — Collect independently
All sources run and return their raw payloads before any merging occurs. Nothing overwrites anything in this phase.
Collection order (companies):
AI — identity resolution only. Returns candidate name, domain, confidence score, and one-sentence reasoning.
ZoomInfo — always runs, independent of HubSpot status. Returns full structured payload anchored to ZoomInfo's domain.
HubSpot lookup — runs after ZoomInfo, using ZoomInfo's domain as the match key (AI domain as fallback if ZoomInfo returned nothing).
Collection order (contacts):
AI — identity resolution, returns candidate company, domain, confidence.
ZoomInfo — always runs. Returns full contact payload including contactAccuracyScore.
Common Room — looked up by work email, then by LinkedIn handle if email lookup returns nothing.
HubSpot lookup — runs after ZoomInfo, using resolved work email as the match key.
CSV fields are also treated as a data source in Phase 1. Pre-enriched columns (domain, state, employees, industry, title) are captured and fed into the merge phase rather than ignored.
Phase 2 — Merge using field-specific trust rules
Each field has an explicit source priority, conflict rule, and write rule. See the Company Field Trust Rules and Contact Field Trust Rules documents for the complete tables.
Key principles:
Accuracy over efficiency. If uncertain, flag — don't guess.
Conflicts surface as Needs Review with a tooltip reason.
The merge produces one record per row. No source "wins overall" — each field has its own winner.
Phase 3 — Push only what's better
Use domain as the match key for company create vs. update.
Use work email as the match key for contact create vs. update, with name + company as fallback.
Write only fields where the merged value improves on what HubSpot already has, per field-specific write rules.
Never overwrite email or domain.
Before writing each contact, attempt domain-based company lookup and write a structural HubSpot association if found.

Supported input formats
The tool uses fuzzy column name matching. A wide range of header labels map to the correct fields automatically.
Company lists — recognized column aliases include: Company, Company Name, Organization, Org, Account, Account Name, Employer (and normalized variants)
Contact lists — recognized fields include: First/Last name, Email, Title, Company, Phone, LinkedIn, Domain, State, Employees, Industry, Location, Notes, Lead Source, Lead Source Description, Attended, Format, and their common aliases across event organizer formats.
Supported format matrix:
FORMAT — Company name only Handled: yes. AI resolves domain and identity.
FORMAT — Company name + domain Handled: yes. Domain treated as Phase 1 source.
FORMAT — Company name + pre-enriched fields Handled: yes. State, employees, industry, domain from CSV used as Phase 1 source alongside ZoomInfo.
FORMAT — Full contact with work email Handled: yes. Standard path.
FORMAT — Contact with personal email only Handled: yes. ZoomInfo looked up by name + company. Work email used as canonical if found. Personal email stored as additional email if HubSpot supports it. Contact excluded only if ZoomInfo also finds no work email.
FORMAT — Contact with no email Handled: yes, gracefully. ZoomInfo, HubSpot, and Common Room looked up by name + company. Work email used if found. Flagged as Needs Review if no email resolved from any source.
FORMAT — Contact with combined city/state location field Handled: yes. Parsed and split on comma before processing.
FORMAT — Contact with no company Handled: flag immediately. Cannot enrich or associate without a company name.

Data accuracy hierarchy
Accuracy is the top priority. Efficiency is second. Source trust is field-specific — see the full trust tables for companies and contacts. General principles:
ZoomInfo wins on most structured fields (state, employees, revenue, city, industry) because it is the most current structured data source.
CSV wins on personal fields for contacts (name, title, phone, email) because the person self-reported at registration.
HubSpot wins on LinkedIn URL (pre-review) because manually verified URLs are highest trust.
Common Room wins on contact LinkedIn URL because it is self-reported by the community member.
AI wins on description because ZoomInfo descriptions are boilerplate.
Domain and email are never overwritten — they are identity keys, not data fields.
ZoomInfo contactAccuracyScore is used as an internal signal for contacts:
85+: corroborates high confidence
50-84: neutral, no effect
Below 50: flag as Needs Review
Below 25: discard ZoomInfo enrichment data for this contact

Confidence buckets
Companies
TRUSTED — requires zero operator action. A company is Trusted if it passes Excluded and meets Path A or Path B:
Path A (ZoomInfo verified):
AI resolved identity successfully
ZoomInfo returned a full payload
No domain conflict, no meaningful name conflict
State/region populated
Employee count populated
LinkedIn verified or AI-sourced with amber flag
Path B (HubSpot verified):
AI resolved identity successfully
HubSpot record exists and is complete (domain, state, employees all populated)
No domain conflict
LinkedIn verified or AI-sourced with amber flag
NEEDS REVIEW — passed Excluded but has at least one of:
No domain after full enrichment
Domain conflict between ZoomInfo and HubSpot
Company name conflict (AI + ZoomInfo agree on a name meaningfully different from HubSpot)
ZoomInfo returned nothing (AI only, no verification)
AI confidence low and ZoomInfo also returned nothing
Empty state/region after full enrichment
Empty employee count after full enrichment
EXCLUDED — auto-excluded if any of these are true:
International AND ZoomInfo returned no US state/region
Government entity (domain ends in .gov or .mil, or name matches known government patterns including "university of ")
AI total non-resolution (no domain, no resolved name, complete failure)
ZoomInfo returned nothing AND AI confidence is low
International override: operator can flip excluded records to Needs Review manually in Review & Edit.
Contacts
TRUSTED — requires zero operator action. A contact is Trusted if it passes Excluded and meets Path A or Path B:
Path A (ZoomInfo verified):
Work email resolved, no conflict
Company name and domain both present
ZoomInfo returned a payload
ZoomInfo contactAccuracyScore 50 or above
Job title populated
LinkedIn present (verified or AI-sourced with amber flag)
Path B (HubSpot or Common Room verified):
Work email resolved, no conflict
HubSpot or Common Room record exists and is complete (email, title, company, state all populated)
Company name and domain both present
LinkedIn present (verified or AI-sourced with amber flag)
Display order within Trusted:
AI LinkedIn amber flag records — top (for quick spot-check)
Fully clean records
NEEDS REVIEW — passed Excluded but has at least one of:
Personal email AND no domain
Email conflict between CSV and HubSpot for same person
No company name after enrichment
No domain after enrichment
Missing LinkedIn after all four sources failed
ZoomInfo returned nothing (AI only)
ZoomInfo contactAccuracyScore below 50
Job title empty after full enrichment
EXCLUDED — auto-excluded if any of these are true:
Personal email AND ZoomInfo found no work email
No name at all
AI total non-resolution AND ZoomInfo found nothing

HubSpot write rules
Write rules are field-specific. The full rules are in the Company Field Trust Rules and Contact Field Trust Rules documents. General principles:
Always fill empty fields regardless of source.
Only overwrite existing fields per the field-specific write rule for that field.
Domain and email are never overwritten.
LinkedIn is never overwritten pre-review. Post-review, operator-approved value is written as truth.
Fast-aging fields (state, employees, revenue, city) are overwritten with ZoomInfo values.
Stable or curated fields (industry, description, LinkedIn, phone) are fill-empty-only.
Operator-set fields (lead source, lead source description, membership notes) are never touched by enrichment.
The selective overwrite logic (fill-empty vs overwrite per field) must be wired into the batch update path. Currently batch updates overwrite indiscriminately — this is a known bug and a Tier 1 fix.

Contact-to-company association
During a contact push, the tool always attempts a domain-based company lookup before writing the contact.
Logic:
Use companyDomain (top-level field, from AI resolution) as primary key. Fall back to ziCompanyWebsite if companyDomain is empty.
Call batchFindCompaniesByDomain against enriched contact domains.
If one match found: write the contact, then call HubSpot associations API to link contact → company.
If multiple matches found: associate to the most recently modified company record. Flag in push summary.
If no match found: write the contact unassociated. Surface in post-push report.
Post-push report surfaces two counters:
"X contacts: company domain present but not found in HubSpot — consider running a company list to backfill"
"X contacts: no company domain available — association not possible"
Auto-creating company records during contact pushes is deferred to V2.

Record ownership
The tool does not directly assign HubSpot owners. HubSpot workflows handle owner assignment by state/region.
The tool's role:
Ensure state/region is populated on every record (new pipeline makes this much more reliable).
Ensure contact-to-company association is attempted for every contact (required for ownership workflow to fire correctly).
Surface expected ownership failures before the operator opens HubSpot.
Pre-push and success screens show:
"X companies have no state/region — will not get an owner assigned automatically"
"X contacts have no company association in HubSpot — will not get an owner assigned automatically"

What success looks like
Upload list → pipeline runs unattended → operator returns to a clean Review & Edit table → Trusted bucket requires zero manual review → Needs Review bucket is small and each record has a specific, actionable reason → operator checks amber LinkedIn dots at top of Trusted → push to HubSpot → pre-push ownership failure count is low → no duplicates created → owners auto-assigned via HubSpot workflows → list is ready to hand to sales.
What it is NOT
Not for enriching incomplete existing HubSpot records (V1)
Not for auto-creating company records during contact pushes (V2)
Not a replacement for manual judgment on membership notes and lead source description — those require operator brain
Not currently authenticated — anyone with the URL can access it and consume ZoomInfo credits / access the CRM. Basic auth is a near-term priority before wider sharing.
Non-negotiables
Data accuracy over speed — never guess when you can flag
Never create duplicates in HubSpot
Trusted bucket must mean zero review needed
Domain and email are never overwritten
Operator-set fields are never touched by enrichment
Tool must be operable by a non-technical marketing ops person without reading documentation
Deployment
Hosted on Vercel
Codebase shared with Tyler via GitHub
ZoomInfo credits and Anthropic costs tied to Casey's accounts — transfer to shared/team accounts before full handoff
Current maturity
V1.5 — pipeline runs end to end. Three-phase architecture, field-specific trust rules, contact-to-company association, and confidence bucket rework are the focus of the current build sprint. HubSpot integration has known duplicate and matching issues being addressed. Not yet suitable for an untrained operator without supervision.

