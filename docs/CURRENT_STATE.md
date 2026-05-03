Realm Enrichment Tool — Current State & Health Snapshot (v2)
What works reliably
End-to-end pipeline runs successfully for both list types (company names, contacts with full name + work email + company)
AI identity resolution handles ambiguous company names correctly when event context is provided
ZoomInfo enrichment returns accurate structured data when a match is found
30-day KV cache prevents duplicate ZoomInfo credit usage on re-runs of the same list within the cache window
HubSpot push creates static lists and writes enriched fields to new records reliably
Confidence bucket logic (Trusted / Needs Review / Excluded) runs end to end — buckets are assigned, just not correctly defined (see below)
www. stripping is implemented correctly in normalizeDomain — both normalized and www.-prefixed domains are included in HubSpot search queries

What works but is fragile
HubSpot contact matching: Contacts are matched by email only at pre-check. If a contact exists in HubSpot under a different email format, slightly different address, or personal vs. work email, the tool will not find them and will create a duplicate instead. Name + company fallback exists at push time but not at pre-check — so the pre-check result is less reliable than the push result.
HubSpot pre-check runs before ZoomInfo: Currently, HubSpot lookup uses the AI-resolved domain, not the ZoomInfo domain. ZoomInfo hasn't run yet at pre-check time. This means the match key going into HubSpot is only as good as AI's resolution — which is weaker than ZoomInfo's. This is a sequencing problem, not a matching logic problem.
Company matching — no name fallback: If a company has no domain after AI resolution and ZoomInfo also misses it, the tool will never find the existing HubSpot record. There is no normalized name match as a last-resort fallback.
Row reordering in Review & Edit: When a field like LinkedIn URL or state/region is edited manually, the row can visually disappear and reorder based on LinkedIn tier sorting. Technically correct behavior but disorienting in practice.
State/region picker: Auto-selects a state that is often wrong. Correcting it requires multiple back-navigation steps. "National" as an option is confusing since all US states are shown anyway. No free-text input for non-US regions (e.g. "Quebec") for large global companies the operator wants to include.
HubSpot folder picker: Hardcoded list of folders. If HubSpot folders change, this breaks silently and shows stale options.

What is broken or incomplete
Selective overwrite logic is not wired in: Two versions of the HubSpot update function exist in the codebase. Version A (careful): reads existing HubSpot record first, fills only empty fields. Version B (blunt): sends all enriched data and overwrites whatever is there. Version A exists but nothing calls it. Version B runs on every update. This means existing HubSpot data is being overwritten in cases where it should be preserved. This is a confirmed bug — highest priority Tier 1 fix.
Contact-to-company association does not exist: When a contact is pushed to HubSpot, the "company" field is written as a plain text string. No structural association is created between the contact record and a company object in the CRM. Contacts land in HubSpot unassociated, which breaks owner assignment workflows and leads to dirty data. The batchFindCompaniesByDomain function exists for company list pushes but is never called during contact pushes.
Confidence bucket definitions are incorrect: Trusted does not currently mean "zero review needed." Operators must eyeball Trusted records because the bucket rules don't reliably separate clean records from records that need attention. Bucket definitions for both companies and contacts are being fully reworked in the current sprint.
Pipeline architecture conflates collection and merging: Currently, sources run sequentially and each source overwrites the previous one. There are no explicit field-level trust rules governing what happens when sources conflict. This is the root cause of the data trust uncertainty. Three-phase architecture (collect, merge, push) is the Tier 1 architectural fix.
Duplicate HubSpot records created on most runs: Root causes: email mismatch, company name variation, domain format differences, and pre-check running before ZoomInfo (weaker match key). Deduplication runs before push but can't catch records it doesn't know exist.
Owner assignment post-push: Tool has no role. HubSpot workflows assign owners by state/region for companies, and by company owner for contacts. Fails when: contact's company is not in HubSpot, contact is not associated to a company, or contact works at an international company. Currently requires up to 30 minutes of manual cleanup after every push.
Government detection misses state universities: "university of " is not in the government detection pattern list. State universities currently pass through as valid records rather than being auto-excluded.
Column recognition is narrow: Company lists only recognize "company" and "companyname" as the company column header. Contact lists have a limited alias set that misses many real-world formats used by event organizers (e.g. "Organization," "Account Name," "companyname" on a contact list, domain/state/employees/ industry columns entirely, "Attended," "Format," etc.). Pre-enriched CSV columns (domain, state, employees, industry) are not captured as a data source — they are ignored or passed through without being used in enrichment.
No contact-level error messaging for unrecognized formats: When a list doesn't match supported formats, behavior is unpredictable rather than a clear, actionable error message.
Pre-Review screen missing Common Room stats: The enrichment summary shows ZoomInfo credits used and LinkedIn URLs from AI, but has no count for records enriched or verified via Common Room.
HubSpot push preview missing: Before pushing to HubSpot, the operator cannot see exactly which fields are being written for each record. There is no pre-push field preview table.
No test suite: Validation is entirely manual — operator runs real lists and reviews output. No automated way to verify that a code change hasn't broken expected behavior.

Known edge cases
Contact with personal email only: currently excluded entirely. Should attempt ZoomInfo lookup by name + company and use work email as canonical if found.
Contact with no email: currently produces unpredictable results. Should be handled gracefully with ZoomInfo lookup and clear flagging.
Contact whose company is not in HubSpot: contact lands cleanly, company is not created, no association is made, owner workflow fails. This is the most common cause of post-push owner cleanup time.
Large global companies with US operations (e.g. Fresenius, Sumitomo): auto-excluded as international even when they have significant US presence. Operator must manually override in Review & Edit.
Company names that are abbreviations or acronyms ("HCSC," "RUSH"): resolve correctly only when event context is provided. Without context, AI confidence drops.
Re-running the same list after 30-day cache expiry uses full ZoomInfo credits again with no warning.
Domain conflict between ZoomInfo and HubSpot: currently not flagged. Will silently use one or the other depending on pipeline order.
Two HubSpot company records with the same domain: no tie-breaking logic exists. Behavior is undefined.

HubSpot integration health
LOW. The integration functions but is not fully trustworthy.
Selective overwrite logic not wired in — updates overwrite indiscriminately
Duplicates created on most runs for a subset of records
Pre-check misses known contacts (email-only matching, runs before ZoomInfo)
No contact-to-company association written on push
Folder picker is hardcoded and will silently break if HubSpot folders change
Owner assignment entirely post-tool, requires manual cleanup after every push
Data trust rules implemented but not field-specific — global overwrite behavior rather than per-field rules

What requires the operator's brain right now
Writing Membership Notes: requires combining event organizer notes with rep knowledge — cannot be automated
Writing Lead Source Description: requires judgment call per record/event — cannot be automated
Deciding which international companies to include vs. exclude
Reviewing every LinkedIn URL from AI web search (~2/10 are wrong and need manual correction for contacts)
Post-push duplicate cleanup in HubSpot
Post-push owner assignment verification and manual fixes

Biggest risks for a new operator
Not knowing to check for and clean duplicates after every push
Not knowing to prep Membership Notes and Lead Source Description before running the tool
Not knowing which records in Review & Edit actually need attention vs. which are safe to approve
Trusting the HubSpot pre-check result as complete (it will miss records)
Not knowing the tool only reliably handles specific input formats — other formats produce unpredictable results
Not knowing that post-push owner assignment requires manual verification and cleanup every time

