import { enrichCompanyWithCommonRoom, enrichContactWithCommonRoom } from "@/lib/enrichment/commonroom-enricher";
import { mergeEnrichedCompany, mergeEnrichedContact } from "@/lib/enrichment/merger";
import {
  delayBetweenZoomInfoCalls,
  enrichCompanyWithZoomInfo,
  enrichContactWithZoomInfo,
} from "@/lib/enrichment/zoominfo-enricher";
import type { EnrichedCompany, EnrichedContact } from "@/lib/utils/types";

export const maxDuration = 300;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!isRecord(body)) {
    return Response.json({ error: "Expected a JSON object." }, { status: 400 });
  }

  const { rows, listType } = body;

  if (!Array.isArray(rows) || rows.length === 0) {
    return Response.json(
      { error: "Expected non-empty `rows` array of enriched records." },
      { status: 400 },
    );
  }

  if (listType !== "companies" && listType !== "contacts") {
    return Response.json(
      { error: "`listType` must be \"companies\" or \"contacts\"." },
      { status: 400 },
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const total = rows.length;
        const zoomPartials: Array<
          Partial<EnrichedCompany> | Partial<EnrichedContact>
        > = [];

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const z =
            listType === "companies"
              ? await enrichCompanyWithZoomInfo(row as EnrichedCompany)
              : await enrichContactWithZoomInfo(row as EnrichedContact);
          zoomPartials.push(z);
          controller.enqueue(
            encoder.encode(
              `${JSON.stringify({
                type: "progress",
                start: i + 1,
                end: i + 1,
                total,
              })}\n`,
            ),
          );
          if (i < rows.length - 1) {
            await delayBetweenZoomInfoCalls(200);
          }
        }

        controller.enqueue(
          encoder.encode(
            `${JSON.stringify({
              type: "progress",
              start: 1,
              end: total,
              total,
            })}\n`,
          ),
        );

        const crPartials = await Promise.all(
          rows.map((row: EnrichedCompany | EnrichedContact) =>
            listType === "companies"
              ? enrichCompanyWithCommonRoom(row as EnrichedCompany)
              : enrichContactWithCommonRoom(row as EnrichedContact),
          ),
        );

        const merged = rows.map((row: EnrichedCompany | EnrichedContact, i: number) => {
          if (listType === "companies") {
            return mergeEnrichedCompany(
              row as EnrichedCompany,
              zoomPartials[i] as Partial<EnrichedCompany>,
              crPartials[i] as Partial<EnrichedCompany>,
            );
          }
          return mergeEnrichedContact(
            row as EnrichedContact,
            zoomPartials[i] as Partial<EnrichedContact>,
            crPartials[i] as Partial<EnrichedContact>,
          );
        });

        controller.enqueue(
          encoder.encode(
            `${JSON.stringify({
              type: "done",
              listType,
              rows: merged,
            })}\n`,
          ),
        );
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
