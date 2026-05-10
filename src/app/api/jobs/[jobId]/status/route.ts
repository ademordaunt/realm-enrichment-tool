import { getJobState, setJobState } from "@/lib/cache/enrichment-cache";

const STALE_RUNNING_MS = 5 * 60 * 1000;
const STALE_RUNNING_FAILURE_REASON =
  "Job stopped responding — last activity was more than 5 minutes ago";

export async function GET(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
): Promise<Response> {
  const { jobId } = await context.params;
  const state = await getJobState(jobId);
  if (!state) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (
    state.status === "running" &&
    typeof state.lastHeartbeatAt === "number" &&
    Date.now() - state.lastHeartbeatAt > STALE_RUNNING_MS
  ) {
    state.status = "failed";
    state.failureReason = STALE_RUNNING_FAILURE_REASON;
    // Keep legacy failed UI path working without additional UI changes.
    state.error = STALE_RUNNING_FAILURE_REASON;
    await setJobState(jobId, state);
  }
  return Response.json(state);
}
