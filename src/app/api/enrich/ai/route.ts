import Anthropic from "@anthropic-ai/sdk";
import { enrichRowsWithProgress } from "@/lib/enrichment/ai-enricher";
import type { EventContext, RawCompanyRow, RawContactRow } from "@/lib/utils/types";

export const maxDuration = 300;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export async function POST(request: Request): Promise<Response> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey?.trim()) {
    return Response.json(
      {
        error:
          "Missing ANTHROPIC_API_KEY. Add it to .env.local (see comment in that file).",
      },
      { status: 500 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!isRecord(body)) {
    return Response.json({ error: "Expected a JSON object." }, { status: 400 });
  }

  const { rows, listType, context } = body;

  if (!Array.isArray(rows) || rows.length === 0) {
    return Response.json(
      { error: "Expected non-empty `rows` array." },
      { status: 400 },
    );
  }

  if (listType !== "companies" && listType !== "contacts") {
    return Response.json(
      { error: "`listType` must be \"companies\" or \"contacts\"." },
      { status: 400 },
    );
  }

  if (!isRecord(context)) {
    return Response.json({ error: "Expected `context` object." }, { status: 400 });
  }

  const ctx: EventContext = {
    eventName: String(context.eventName ?? "").trim(),
    eventDate: String(context.eventDate ?? "").trim(),
    region: String(context.region ?? "").trim(),
    audienceLevel: String(context.audienceLevel ?? "").trim(),
    listType: listType === "companies" ? "companies" : "contacts",
  };

  const required: (keyof EventContext)[] = ["eventName", "eventDate", "region", "audienceLevel"];
  const missing = required.filter((k) => !String(ctx[k] ?? "").trim());
  if (missing.length > 0) {
    return Response.json(
      { error: `Missing required context fields: ${missing.join(", ")}` },
      { status: 400 },
    );
  }

  const typedRows =
    listType === "companies"
      ? (rows as RawCompanyRow[])
      : (rows as RawContactRow[]);

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
}
