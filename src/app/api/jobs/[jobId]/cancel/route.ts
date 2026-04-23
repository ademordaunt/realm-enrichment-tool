import { getJobState, setJobState } from "@/lib/cache/enrichment-cache";

export async function POST(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
): Promise<Response> {
  const { jobId } = await context.params;
  const state = await getJobState(jobId);
  if (!state) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  state.status = "cancelled";
  await setJobState(jobId, state);
  return Response.json({ jobId, cancelled: true });
}
