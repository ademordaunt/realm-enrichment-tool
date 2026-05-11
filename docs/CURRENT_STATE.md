# Realm Enrichment Tool — Current State & Health Snapshot

## Overall Status

Core enrichment and HubSpot push workflows are stable in event and bulk modes. Structural refactors and UI polish are reflected in the current codebase. Remaining work is narrow and isolated.

## What Works Reliably

- Pipeline execution order is consistent in both modes: AI -> ZoomInfo/Common Room enrichment -> HubSpot pre-check -> LinkedIn fallback.
- Wizard orchestration is split across dedicated hooks (`useEnrichmentPipeline`, `useBulkJob`, `useWizardSession`, `useHubSpotPush`) with `page.tsx` acting as a thinner coordinator.
- Heavy screens are code-split (`EventContextForm`, `PrePushScreen`, `ReviewTable`, `PreReviewGate`; bulk progress is dynamically loaded by `EnrichingStep`).
- Contact-to-company association is attempted on every contact push with explicit post-push counts for associated, domain-not-found, and no-domain contacts.
- Manual edits are batched for review initialization (`POST /api/manual-edits/batch`) and persisted in KV.
- Bulk row hydration now validates row shape and skips malformed KV rows instead of crashing review load.
- Bulk stuck-running recovery is implemented: jobs write `lastHeartbeatAt` during chunk processing, and the status endpoint auto-fails `running` jobs stale for >5 minutes so resume can recover them.

## Lead Source Behavior (Post Fix)

- Contact pushes now use a per-row extras resolver in `push-handler.ts`.
- `useExistingLeadSource` and `useExistingLeadSourceDescription` are honored per contact row:
  - when enabled, CSV row values are used;
  - when disabled, global Import Settings values are used.
- Contact HubSpot writes keep Lead Source fields fill-empty-only semantics in `contacts.ts`.
- Company pushes still use global extras (not per-row CSV toggles), which is intentional in current implementation.

## Open Follow-Ups

- None tracked at this snapshot.

## Fragile Areas

- Contact identity edge cases still risk duplicate creation (email drift, no-email rows, ambiguous existing CRM records).
- HubSpot folder API response-shape drift remains a watch area.
- Very large runs remain linear in runtime/cost despite bulk background processing.

## Product Gaps (Known)

- Owner assignment is still workflow-driven in HubSpot (tool does not directly assign owners).
- Automated test coverage remains limited; validation is still heavily runtime/manual.
- Parse UX for severely malformed inputs is improved but not fully operator-guided at per-row level.

## HubSpot Integration Health

MEDIUM-HIGH for intended event-import workflows.

- Reliable: list create/reuse, dedupe-and-match flow, batch create/update, associations.
- Residual risk: contact identity matching in edge cases.
- Operational dependency: owner-assignment workflows and post-push verification.
