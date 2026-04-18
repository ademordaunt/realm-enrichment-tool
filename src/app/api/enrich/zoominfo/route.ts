import { enrichContactWithCommonRoom } from "@/lib/enrichment/commonroom-enricher";
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
        const allRows = rows as (EnrichedCompany | EnrichedContact)[];
        const total = allRows.length;
        const nonHighTotal = allRows.filter((r) => r.confidenceScore !== "high").length;
        let nonHighIndex = 0;

        const mergedRows: (EnrichedCompany | EnrichedContact)[] = [];

        const emitProgress = (i: number, detail?: string) => {
          controller.enqueue(
            encoder.encode(
              `${JSON.stringify({
                type: "progress",
                start: i + 1,
                end: i + 1,
                total,
                detail: detail ?? undefined,
              })}\n`,
            ),
          );
        };

        for (let i = 0; i < allRows.length; i++) {
          const row = allRows[i]!;

          if (row.confidenceScore === "high") {
            mergedRows.push(row);
            emitProgress(i);
            continue;
          }

          nonHighIndex += 1;

          if (listType === "companies") {
            emitProgress(
              i,
              `Checking ZoomInfo… (${nonHighIndex} of ${nonHighTotal} companies)`,
            );
            const zi = await enrichCompanyWithZoomInfo(row as EnrichedCompany);
            mergedRows.push(
              mergeEnrichedCompany(row as EnrichedCompany, zi, {}),
            );
          } else {
            const contact = row as EnrichedContact;
            emitProgress(
              i,
              `Checking Common Room… (${nonHighIndex} of ${nonHighTotal} contacts)`,
            );
            const crResult = await enrichContactWithCommonRoom(contact);
            const stillNeedsEnrichment =
              !crResult.linkedinUrl?.trim() && !crResult.resolvedCompany?.trim();

            let ziResult: Partial<EnrichedContact> = {};
            if (stillNeedsEnrichment) {
              emitProgress(
                i,
                `Checking ZoomInfo… (${nonHighIndex} of ${nonHighTotal} contacts)`,
              );
              ziResult = await enrichContactWithZoomInfo(contact);
            }

            mergedRows.push(
              mergeEnrichedContact(contact, ziResult, crResult),
            );
          }

          if (i < allRows.length - 1) {
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

        controller.enqueue(
          encoder.encode(
            `${JSON.stringify({
              type: "done",
              listType,
              rows: mergedRows,
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
