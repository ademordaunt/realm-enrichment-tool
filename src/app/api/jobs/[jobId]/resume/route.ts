import { getJobState, setJobState } from "@/lib/cache/enrichment-cache";
import { queueJobChunk } from "@/lib/jobs/qstash";

export async function POST(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
): Promise<Response> {
  const { jobId } = await context.params;
  const state = await getJobState(jobId);
  if (!state) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (state.status !== "failed") {
    return Response.json(
      { error: "Bad request", detail: "Only failed jobs can be resumed." },
      { status: 400 },
    );
  }

  const phase =
    state.currentPhase === "zoominfo" || state.currentPhase === "linkedin"
      ? state.currentPhase
      : "ai";
  state.status = "queued";
  state.error = undefined;
  await setJobState(jobId, state);
  await queueJobChunk({ jobId, chunkIndex: state.checkpointChunk, phase });
  return Response.json({ jobId, requeued: true });
}
