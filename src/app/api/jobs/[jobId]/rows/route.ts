import { getJobEnrichedRows, getJobState } from "@/lib/cache/enrichment-cache";
import { isValidEnrichedCompany, isValidEnrichedContact } from "@/lib/utils/guards";

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
  const validate = state.listType === "companies" ? isValidEnrichedCompany : isValidEnrichedContact;
  const validRows = rows.filter((row, i) => {
    const ok = validate(row);
    if (!ok) console.warn(`[jobs/rows] Skipping malformed row at index ${i}`);
    return ok;
  });
  return Response.json({ rows: validRows, listType: state.listType });
}
