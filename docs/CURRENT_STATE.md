# Realm Enrichment Tool — Current State & Health Snapshot (Post-SPEC 3)

## What Works Reliably
End-to-end pipeline runs successfully for both list types (company names, contacts with full name + work email + company)
AI identity resolution handles ambiguous company names correctly when event context is provided
ZoomInfo enrichment returns accurate structured data when a match is found
30-day KV cache prevents duplicate ZoomInfo credit usage on re-runs of the same list within the cache window
HubSpot push creates static lists and writes enriched fields to new records reliably
www. stripping is implemented correctly in normalizeDomain — both normalized and www.-prefixed domains are included in HubSpot search queries
Selective overwrite logic is fully wired in: field-specific write rules are applied on every update. State, employees, revenue, and city overwrite existing HubSpot values; name, domain, industry, description, LinkedIn, phone, and operator-set fields are fill-empty-only. Batch updates no longer overwrite indiscriminately.
Contact-to-company association is written on every contact push. After contacts are created or updated, the tool looks up company HubSpot IDs by domain (companyDomain first, falling back to ziCompanyWebsite) and writes a structural CRM association using association type 279. Post-push success screen surfaces counts for associated, domain-not-found, and no-domain contacts.
Confidence buckets (Trusted / Needs Review / Excluded) are correctly defined. Trusted means zero operator action required. Excluded logic is precise. Needs Review surfaces only records with a real reason to look at. Both companies and contacts have Path A (ZoomInfo verified) and Path B (HubSpot verified) Trusted routes.
Three-phase pipeline architecture is implemented: AI → ZoomInfo → HubSpot pre-check, in that order, for both event mode and bulk mode. HubSpot pre-check now runs after ZoomInfo and uses the ZoomInfo-resolved domain as the primary match key, making company matching substantially more reliable.
Company name fallback matching is implemented: for companies with no domain that were not matched by domain lookup, the tool normalizes the resolved name and runs a CONTAINS_TOKEN search in HubSpot. Requires exactly one result to accept the match, logged in push summary.
Government detection is comprehensive: domain ends in .gov or .mil, plus name patterns covering military, federal agencies, state/local government, higher education (university of, community college, state college), school districts, courts, transit authorities. Substring matches with a code comment noting the low false-positive rate.
Column recognition is comprehensive: company column aliases include Company, Organization, Org, Account, Account Name, Employer. Contact column aliases cover all common event organizer formats including givenname, fname, surname, lname, position, role, emailaddress, businessemail, workemail, liurl, mobile, cell, mobilephone, repnotes, realmnotes, johnsnotes, comments, attended, attendance, format, eventformat, and pre-enriched columns domain, companydomain, website, state, region, employees, numberofemployees, industry, sector, vertical. Location fields in "City, ST" format are parsed and split.
CSV pre-enriched fields are treated as a Phase 1 data source: domain, state, employees, and industry from CSV columns are captured as csvDomain, csvState, csvEmployees, csvIndustry and fed into merge. ZoomInfo wins on conflict; CSV fills when ZoomInfo returns nothing. For contacts, csvTitle is highest trust — CSV title is never overwritten by ZoomInfo.
Personal email contacts are handled via ZoomInfo name+company lookup. When a contact's email is personal (gmail, yahoo, etc.) or missing, ZoomInfo is searched by name + company. If a work email is found, it becomes the canonical resolvedEmail; the personal email is stored in personalEmail for manual reference. Contact proceeds through the pipeline rather than being immediately excluded.
ZoomInfo contactAccuracyScore is captured and used in bucket logic. Scores below 50 flag the contact as Needs Review. Scores below 25 discard all ZoomInfo field values for that contact (ziMatchDiscarded: true), and the contact proceeds with AI + CSV + HubSpot data only.
KV health check false failure has been fixed: a bug where the KV health check endpoint could report an unhealthy status on the first call was resolved in the recent cache-stability work.

## What Works but Is Fragile
HubSpot contact matching: Contacts are matched by email only at pre-check. If a contact exists in HubSpot under a different email format, slightly different address, or personal vs. work email, the tool will not find them and will create a duplicate instead. Name + company fallback exists at push time but not at pre-check — so the pre-check result is less reliable than the push result.
Duplicate HubSpot records can still occur for edge cases: email mismatch, contacts with personal-only emails where ZoomInfo finds no work email, and contacts with no email at all. Recent sequencing, name-fallback, and domain tie-break improvements reduce this substantially, but do not eliminate it.
HubSpot folder API response shape can vary by portal (flat arrays vs nested `folder.childNodes`). Parser now handles both, but this remains a watch area when HubSpot changes list APIs.
Large runs remain operationally long and expensive. The architecture is stable, but throughput still scales roughly linearly with row count and API latency.
Stale cache can cause incorrect bucket results: if KV entries were written during older broken runs, cached records may carry fields or bucket assignments from the old blunt-overwrite behavior. Clearing KV and re-enriching the affected list resolves this.

## What Is Broken or Incomplete
Owner assignment post-push: Tool still does not directly assign owners. HubSpot workflows assign owners by state/region for companies and by associated company for contacts. Manual post-push verification is still required for no-association and international edge cases.
No test suite: Validation is still primarily manual with live-run checks.
No robust per-row parse error UX for heavily non-standard input files: detection is better, but some malformed formats still degrade into weak enrichment results rather than hard-stop actionable errors.

## Known Edge Cases
isFullyPopulatedContactRow now requires companyDomain: A contact row with all other fields populated (firstName, lastName, email, company, title) but no companyDomain will not be treated as pre-populated and will go through AI enrichment rather than bypassing it. This is intentional — a domain is required for the contact trusted bucket and for association — but operators uploading pre-enriched contact lists without a domain column should be aware that AI will still run for those rows.
Contact with personal email only: ZoomInfo lookup by name + company now runs. Work email is used as canonical if found. Contact is only excluded if ZoomInfo also finds no work email.
Contact with no email: ZoomInfo lookup by name + company runs. Contact is flagged as Needs Review if no email resolves from any source, not excluded.
Contact whose company is not in HubSpot: Contact lands cleanly, no association is made, owner workflow may not fire. Success screen surfaces the count. Consider running a company list first to backfill company records.
Large global companies with US operations (e.g. Fresenius, Sumitomo): Auto-excluded as international if ZoomInfo returns no US state. Operator can flip excluded international records to Needs Review using the "Include anyway" override in Review & Edit.
Company names that are abbreviations or acronyms ("HCSC," "RUSH"): Resolve correctly only when event context is provided. Without context, AI confidence drops.
Re-running the same list after 30-day cache expiry uses full ZoomInfo credits again with no warning.
Two HubSpot company records with the same domain: Tie-broken automatically by most recent hs_lastmodifieddate. The chosen record ID is logged; skipped duplicates are logged but not surfaced in push summary.
Stale KV cache from earlier runs: records cached before overwrite fixes may carry stale data. Clear cache and re-run to force fresh enrichment.

## HubSpot Integration Health
MEDIUM-HIGH. Core list creation, create/update, selective overwrite, and association behavior are reliable in day-to-day runs, with remaining edge-case risk concentrated in identity matching.
Selective overwrite logic is wired in — fields are written per defined rules
Contact-to-company associations are written on every contact push
HubSpot pre-check runs after ZoomInfo with ZoomInfo domain as match key (AI domain fallback)
Domain tie-breaking for duplicate HubSpot company records is implemented
Company name fallback matching exists for no-domain companies
Live folder picker now calls HubSpot directly (contacts + companies object types), parses nested folder trees, and supports retry/no-folder fallback
Duplicates are still possible for email-mismatch and no-email contact edge cases
Owner assignment remains post-tool (workflow-driven in HubSpot)

## What Still Requires Operator Judgment
Writing Membership Notes: requires combining event organizer notes with rep knowledge — cannot be automated
Writing Lead Source Description: requires judgment call per record/event — cannot be automated
Deciding which international companies to include vs. exclude (override is available in Review & Edit)
Reviewing every LinkedIn URL from AI web search (amber flag rows at top of Trusted — ~2/10 are wrong and need manual correction for contacts)
Post-push owner assignment verification and manual fixes for contacts with no company association
Verifying push summary for name-matched companies (low-confidence matches logged in push summary)

## Biggest Risks for a New Operator
Not knowing to prep Membership Notes and Lead Source Description before running the tool
Trusting the HubSpot pre-check result as complete for contact email matching — it will miss records matched only by name
Not knowing which records in Review & Edit actually need attention vs. which are safe to approve
Not knowing the tool only reliably handles specific input formats — other formats produce unpredictable results
Not knowing that post-push owner assignment requires manual verification and cleanup every time
Running a list that depends on old cached rows without first clearing KV cache — stale cache entries can produce incorrect bucket assignments
