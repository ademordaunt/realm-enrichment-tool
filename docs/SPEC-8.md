# Realm Enrichment Tool — SPEC-8
## Bulk Job Stuck-Running Watchdog

**Status:** Complete  
**Scope:** Add watchdog-based recovery for bulk jobs stuck in `running` state  
**Tools:** Cursor / Claude Code

---

## Overview

Bulk jobs can stall due to interrupted worker execution while still appearing as `running`. SPEC-8 implemented a heartbeat + stale-running watchdog so these jobs automatically transition to `failed` and become recoverable through the existing resume flow.

---

## Item 8A — Heartbeat Writes During Chunk Processing

### Implemented Behavior

- At the start of each chunk run, the worker refreshes a heartbeat timestamp:
  - `src/app/api/jobs/process/route.ts`
  - `jobState.lastHeartbeatAt = Date.now()`

### Acceptance Criteria (Met)

1. **Heartbeat persisted per chunk**
   - Each chunk execution updates `lastHeartbeatAt` before processing continues.
2. **No client dependency**
   - Heartbeat updates occur in server job-processing path, independent of UI polling.

---

## Item 8B — Stale-Running Detection in Job Status Endpoint

### Implemented Behavior

- Status endpoint defines stale threshold:
  - `src/app/api/jobs/[jobId]/status/route.ts`
  - `STALE_RUNNING_MS = 5 * 60 * 1000`
- On status read, when:
  - `state.status === "running"`
  - `typeof state.lastHeartbeatAt === "number"`
  - `Date.now() - state.lastHeartbeatAt > STALE_RUNNING_MS`
- Endpoint auto-transitions job to failed:
  - `state.status = "failed"`
  - `state.failureReason = "...last activity was more than 5 minutes ago"`
  - `state.error = same message` (legacy UI path compatibility)
  - persisted with `setJobState(...)`

### Acceptance Criteria (Met)

1. **5-minute stale cutoff enforced**
   - Running jobs stale for >5 minutes are detected.
2. **Automatic state recovery**
   - Stale-running jobs no longer remain indefinitely in `running`.
3. **UI-compatible failure shape**
   - Failure reason is exposed via both `failureReason` and `error`.

---

## Item 8C — Resume Compatibility After Watchdog Failure

### Implemented Behavior

- Resume endpoint clears stale failure marker:
  - `src/app/api/jobs/[jobId]/resume/route.ts`
  - Clears `failureReason` before restart/requeue.
- `BulkJobState` model supports watchdog metadata:
  - `src/lib/utils/types.ts`
  - `lastHeartbeatAt?: number`
  - `failureReason?: string`

### Acceptance Criteria (Met)

1. **Resumable stale failures**
   - Jobs failed by watchdog can re-enter processing through existing resume path.
2. **State model coverage**
   - Type definitions include heartbeat and watchdog failure metadata.

---

## Validation Checklist

- Confirm heartbeat write appears in `jobs/process` chunk handler.
- Confirm status endpoint stale-running condition uses 5-minute threshold.
- Confirm stale-running transition writes `status = failed` and failure message.
- Confirm resume endpoint clears watchdog failure marker (`failureReason`).
- Confirm `BulkJobState` type includes `lastHeartbeatAt` and `failureReason`.

---

## Outcome

SPEC-8 is complete. Bulk jobs now recover safely from stuck-running states by automatically transitioning stale runs to failed and enabling clean retries through the existing resume flow.
