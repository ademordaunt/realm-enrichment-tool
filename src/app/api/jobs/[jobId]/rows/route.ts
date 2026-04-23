import { getJobEnrichedRows, getJobState } from "@/lib/cache/enrichment-cache";

export async function GET(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
): Promise<Response> {
  const { jobId } = await context.params;
  const state = await getJobState(jobId);
  if (!state) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const rows = await getJobEnrichedRows(jobId, state.totalAiChunks);
  return Response.json({ rows, listType: state.listType });
}
