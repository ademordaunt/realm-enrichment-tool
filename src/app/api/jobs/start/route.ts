import {
  setJobRawRows,
  setJobState,
} from "@/lib/cache/enrichment-cache";
import { queueJobChunk } from "@/lib/jobs/qstash";
import { isRecord } from "@/lib/utils/guards";
import type {
  BulkJobState,
  EventContext,
  RawCompanyRow,
  RawContactRow,
} from "@/lib/utils/types";

export const maxDuration = 30;

function badRequest(detail: string): Response {
  return Response.json({ error: "Bad request", detail }, { status: 400 });
}

export async function POST(request: Request): Promise<Response> {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest("Invalid JSON body.");
    }
    if (!isRecord(body)) return badRequest("Expected JSON object.");

    const { listType, eventContext, rows } = body;
    if ((listType !== "companies" && listType !== "contacts") || !Array.isArray(rows)) {
      return badRequest("Expected `listType` and `rows`.");
    }
    if (!isRecord(eventContext)) return badRequest("Expected `eventContext` object.");
    if (rows.length === 0) return badRequest("Expected non-empty rows array.");

    const parsedEventContext: EventContext = {
      eventName: String(eventContext.eventName ?? "").trim(),
      eventDate: String(eventContext.eventDate ?? "").trim(),
      region: String(eventContext.region ?? "").trim(),
      audienceLevel: String(eventContext.audienceLevel ?? "").trim(),
      listType,
      importMode: "bulk",
    };
    if (!parsedEventContext.eventName) {
      return badRequest("Missing required eventContext.eventName.");
    }

    const jobId = crypto.randomUUID();
    const totalRows = rows.length;
    const totalAiChunks = Math.max(1, Math.ceil(totalRows / 15));
    const totalZoomChunks = Math.max(1, Math.ceil(totalRows / 25));

    const state: BulkJobState = {
      jobId,
      status: "queued",
      importMode: "bulk",
      listType,
      eventContext: parsedEventContext,
      totalRows,
      processedRows: 0,
      currentPhase: "ai",
      aiComplete: false,
      precheckComplete: false,
      zoomInfoComplete: false,
      linkedInComplete: false,
      enrichedCount: 0,
      cachedCount: 0,
      hubspotSkippedCount: 0,
      creditsUsed: 0,
      checkpointChunk: 0,
      totalAiChunks,
      totalZoomChunks,
      startedAt: new Date().toISOString(),
    };

    await setJobRawRows(jobId, rows as RawCompanyRow[] | RawContactRow[]);
    await setJobState(jobId, state);
    await queueJobChunk({ jobId, chunkIndex: 0, phase: "ai" });

    return Response.json({ jobId });
  } catch (err) {
    console.error("[Jobs/Start] error:", err);
    return Response.json(
      { error: "Internal server error", detail: "Failed to start enrichment job. Please try again." },
      { status: 500 },
    );
  }
}
