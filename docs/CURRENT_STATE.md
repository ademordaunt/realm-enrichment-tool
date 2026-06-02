# Realm Enrichment Tool — Current State & Health Snapshot

## Overall Status

Core enrichment and HubSpot push workflows are stable in event and bulk modes. Structural refactors and UI polish are reflected in the current codebase. Remaining work is narrow and isolated.

## What Works Reliably

- Pipeline execution order is consistent in both modes: AI → ZoomInfo/Common Room enrichment → HubSpot pre-check → LinkedIn fallback.
- Wizard orchestration is split across dedicated hooks (`useEnrichmentPipeline`, `useBulkJob`, `useWizardSession`, `useHubSpotPush`) with `page.tsx` acting as a thinner coordinator (~650 lines).
- Heavy screens are code-split (`EventContextForm`, `PrePushScreen`, `ReviewTable`, `PreReviewGate`; bulk progress is dynamically loaded by `EnrichingStep`).
- Contact-to-company association is attempted on every contact push with explicit post-push counts for associated, domain-not-found, and no-domain contacts.
- Manual edits are batched for review initialization (`POST /api/manual-edits/batch`) and persisted in Upstash Redis.
- Bulk row hydration validates row shape and skips malformed KV rows instead of crashing review load.
- Bulk stuck-running recovery: jobs write `lastHeartbeatAt` during chunk processing; the status endpoint auto-fails `running` jobs stale for >5 minutes so resume can recover them.
- Large contact pushes: sequential `findContactByNameAndCompany` fallback was removed from `push-handler.ts`; unmatched contacts rely on batched create + HubSpot duplicate handling. Push route `maxDuration` is **120** seconds.

## Import Modes (Operator Flow)

| Mode | Start enrichment | Cost estimate before run |
|------|------------------|---------------------------|
| **Marketing Event List** (`event`) | `useEnrichmentPipeline.runEnrichment` | No |
| **Bulk Import** (`bulk`) | `useBulkJob.startBulkJob` → `/api/jobs/start` + QStash worker | No |

`CostEstimateScreen` exists and is wired to `useEnrichmentPipeline` when `wizardImportMode === "bulk"` inside `runEnrichment`, but bulk import does **not** call `runEnrichment` — it calls `startBulkJob` directly. The cost-estimate step is therefore unused on the live bulk path. Bulk upload shows an optional warning when the list has fewer than 200 rows (suggest event mode).

## Lead Source Behavior (Post Fix)

- Contact pushes use a per-row extras resolver in `push-handler.ts`.
- `useExistingLeadSource` and `useExistingLeadSourceDescription` are honored per contact row:
  - when enabled, CSV row values are used;
  - when disabled, global Import Settings values are used.
- Contact HubSpot writes keep Lead Source fields fill-empty-only semantics in `contacts.ts`.
- Company pushes still use global extras (not per-row CSV toggles), which is intentional in current implementation.
- The Lead Source dropdown in `PrePushScreen` fetches live enum values from HubSpot (`GET /api/hubspot/properties/lead-source` → `/crm/v3/properties/contacts/lead_source__deal_source`). A hardcoded `LEAD_SOURCE_OPTIONS` array remains as a silent fallback if the fetch fails.

## Parsing

- Combined name columns (`Name`, `Full Name`, `Attendee Name`, `Participant Name`, `Attendee`, `Contact Name`) are detected during CSV parsing and automatically split into first and last name. Handles "Last, First" comma format, leading honorifics, and single-token names.
- If auto-detection returns an incorrect list type (contacts vs. companies), the operator can switch it via a "Switch to Companies / Contacts" link on the upload screen. The override re-runs parsing with the forced type.

## Push & Success Screen

- On contacts push, the success screen always shows the Company Associations block and Ownership Assignment block — zero counts are shown (not hidden). Zero associations is a meaningful red flag, not silence.
- Push streams NDJSON (`list_created` → `progress` → `done` or `error`). Client error **"HubSpot push finished without a result payload"** means the stream closed without a `done` event (often timeout or connection drop).
- Progress events are emitted during batch create/update only, not during the pre-write matching phase.
- 529 (API overload) errors from Anthropic retry with exponential backoff (1 s → 2 s → 4 s, up to 3 retries) before falling back to unresolved rows.

## Open Follow-Ups

- None tracked at this snapshot.

## Fragile Areas

- Contact identity edge cases: contacts in HubSpot under a different or missing email may be created as new records (name+company pre-match was removed to avoid push timeouts).
- Company pushes without domain still use sequential `findCompanyByName` (100 ms delay per candidate) for a subset of rows.
- HubSpot folder API response-shape drift remains a watch area.
- Very large runs remain linear in runtime/cost despite bulk background processing.
- Push matching phase has no server-side timing logs; debugging slow pushes requires HubSpot/Vercel logs.

## Product Gaps (Known)

- Owner assignment is still workflow-driven in HubSpot (tool does not directly assign owners).
- Automated test coverage remains limited; validation is still heavily runtime/manual.
- Parse UX for severely malformed inputs is improved but not fully operator-guided at per-row level.

## HubSpot Integration Health

MEDIUM-HIGH for intended event-import workflows.

- Reliable: list create/reuse, email/domain dedupe-and-match, batch create/update, associations, duplicate-on-create recovery.
- Residual risk: contact identity when CRM email differs from CSV or row has no email.
- Operational dependency: owner-assignment workflows and post-push verification.
