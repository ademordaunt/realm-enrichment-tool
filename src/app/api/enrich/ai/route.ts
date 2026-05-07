import Anthropic from "@anthropic-ai/sdk";
import {
  enrichCompanyBatchWithCache,
  enrichContactBatchWithCache,
  enrichRowsWithProgress,
} from "@/lib/enrichment/ai-enricher";
import { isRecord } from "@/lib/utils/guards";
import type { EventContext, RawCompanyRow, RawContactRow } from "@/lib/utils/types";

/** Per-batch ceiling (Vercel hobby ~10s); batched JSON requests should finish within this window. */
export const maxDuration = 9;
export const LINKEDIN_SEARCH_ROUTE = "/api/enrich/linkedin-search";

function badRequest(detail: string) {
  return Response.json({ error: "Bad request", detail }, { status: 400 });
}

export async function POST(request: Request): Promise<Response> {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey?.trim()) {
      return Response.json(
        {
          error: "Internal server error",
          detail:
            "Missing ANTHROPIC_API_KEY. Add it to .env.local (see comment in that file).",
        },
        { status: 500 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest("Invalid JSON body.");
    }

    if (!isRecord(body)) {
      return badRequest("Expected a JSON object.");
    }

    const { rows, listType, context } = body;

    if (!Array.isArray(rows) || rows.length === 0) {
      return badRequest("Expected non-empty `rows` array.");
    }

    if (listType !== "companies" && listType !== "contacts") {
      return badRequest('`listType` must be "companies" or "contacts".');
    }

    if (!isRecord(context)) {
      return badRequest("Expected `context` object.");
    }

    const listTypeNorm = listType === "companies" ? "companies" : "contacts";
    const audienceLevelRaw = String(context.audienceLevel ?? "").trim();

    const importModeRaw = context.importMode;
    const importMode: EventContext["importMode"] =
      importModeRaw === "bulk" ? "bulk" : "event";

    const ctx: EventContext = {
      eventName: String(context.eventName ?? "").trim(),
      eventDate: String(context.eventDate ?? "").trim(),
      region: String(context.region ?? "").trim(),
      audienceLevel:
        listTypeNorm === "companies"
          ? audienceLevelRaw || "Business professionals"
          : audienceLevelRaw,
      listType: listTypeNorm,
      importMode,
    };

    if (importMode === "bulk") {
      if (!ctx.eventName.trim()) {
        return badRequest("Missing required context fields: eventName");
      }
      ctx.eventDate = ctx.eventDate.trim() || "Not specified";
      if (listTypeNorm === "contacts") {
        ctx.audienceLevel = ctx.audienceLevel.trim() || "Business professionals";
      }
    } else {
      const required: (keyof EventContext)[] =
        listTypeNorm === "contacts"
          ? ["eventName", "eventDate", "audienceLevel"]
          : ["eventName", "eventDate"];
      const missing = required.filter((k) => !String(ctx[k] ?? "").trim());
      if (missing.length > 0) {
        return badRequest(`Missing required context fields: ${missing.join(", ")}`);
      }
    }

    const typedRows =
      listType === "companies"
        ? (rows as RawCompanyRow[])
        : (rows as RawContactRow[]);

    const batchIndexRaw = body.batchIndex;
    const batchSizeRaw = body.batchSize;
    const isBatchMode =
      typeof batchIndexRaw === "number" &&
      Number.isInteger(batchIndexRaw) &&
      batchIndexRaw >= 0;

    if (isBatchMode) {
      const batchSize =
        typeof batchSizeRaw === "number" && batchSizeRaw > 0 ? batchSizeRaw : 3;
      const client = new Anthropic({ apiKey });
      try {
        const { rows: enriched, allCacheHits } =
          listType === "companies"
            ? await enrichCompanyBatchWithCache(
                client,
                typedRows as RawCompanyRow[],
                ctx,
              )
            : await enrichContactBatchWithCache(
                client,
                typedRows as RawContactRow[],
                ctx,
              );
        return Response.json({
          mode: "batch" as const,
          batchIndex: batchIndexRaw,
          batchSize,
          listType,
          rows: enriched,
          allCacheHits,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Enrichment failed.";
        return Response.json(
          {
            error: "Internal server error",
            detail: message,
            batchIndex: batchIndexRaw,
          },
          { status: 500 },
        );
      }
    }

    const client = new Anthropic({ apiKey });
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const ev of enrichRowsWithProgress(
            client,
            typedRows,
            listType,
            ctx,
          )) {
            controller.enqueue(encoder.encode(`${JSON.stringify(ev)}\n`));
          }
          controller.close();
        } catch (e) {
          const message = e instanceof Error ? e.message : "Enrichment failed.";
          controller.enqueue(
            encoder.encode(`${JSON.stringify({ type: "error", message })}\n`),
          );
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[enrich/ai] unexpected error:", err);
    return Response.json(
      { error: "Internal server error", detail: "AI enrichment failed. Please try again." },
      { status: 500 },
    );
  }
}
