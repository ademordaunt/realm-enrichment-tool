import { enrichContactWithCommonRoom } from "@/lib/enrichment/commonroom-enricher";
import { mergeEnrichedCompany, mergeEnrichedContact } from "@/lib/enrichment/merger";
import {
  delayBetweenZoomInfoCalls,
  enrichCompanyWithZoomInfo,
  enrichContactWithZoomInfo,
} from "@/lib/enrichment/zoominfo-enricher";
import type { EnrichedCompany, EnrichedContact } from "@/lib/utils/types";

export const maxDuration = 9;

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
        const nonHighTotal =
          listType === "companies"
            ? allRows.filter((r) => r.confidenceScore !== "high").length
            : allRows.filter((r) => {
                if (r.confidenceScore !== "high") return true;
                const c = r as EnrichedContact;
                return !c.linkedinUrl?.trim();
              }).length;
        let nonHighIndex = 0;

        const mergedRows: (EnrichedCompany | EnrichedContact)[] = [];
        let enrichedCount = 0;
        const prospectorEndpoint = new URL(
          "/api/enrich/prospector",
          request.url,
        ).href;

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

          if (listType === "companies" && row.confidenceScore === "high") {
            mergedRows.push(row);
            emitProgress(i);
            continue;
          }

          if (listType === "contacts") {
            const c = row as EnrichedContact;
            if (c.confidenceScore === "high" && c.linkedinUrl?.trim()) {
              mergedRows.push(row);
              emitProgress(i);
              continue;
            }
          }

          nonHighIndex += 1;

          if (listType === "companies") {
            emitProgress(
              i,
              `ZoomInfo enriching ${nonHighIndex} of ${nonHighTotal} companies…`,
            );
            const zi = await enrichCompanyWithZoomInfo(row as EnrichedCompany);
            if (zi.enrichedByZoomInfo) {
              enrichedCount += 1;
            }
            mergedRows.push(
              mergeEnrichedCompany(row as EnrichedCompany, zi, {}),
            );
          } else {
            const contact = row as EnrichedContact;
            const linkedinOnlyHigh =
              contact.confidenceScore === "high" && !contact.linkedinUrl?.trim();

            emitProgress(
              i,
              `ZoomInfo & Common Room enriching ${nonHighIndex} of ${nonHighTotal} contacts…`,
            );
            const crResult = await enrichContactWithCommonRoom(contact);

            let prospectorPartial: Partial<EnrichedContact> = {};
            let prospectorFound = false;
            try {
              const prospectorRes = await fetch(prospectorEndpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  contacts: [
                    {
                      id: contact.id,
                      firstName: contact.firstName,
                      lastName: contact.lastName,
                      rawEmail: contact.rawEmail,
                      resolvedCompany: contact.resolvedCompany,
                      companyDomain: contact.companyDomain,
                    },
                  ],
                }),
              });
              if (prospectorRes.ok) {
                const prospectorJson = (await prospectorRes.json()) as {
                  results?: Array<{
                    id: string;
                    title?: string;
                    linkedInUrl?: string;
                    location?: string;
                    seniority?: string;
                    found: boolean;
                  }>;
                };
                const pr =
                  prospectorJson.results?.find((r) => r.id === contact.id) ??
                  prospectorJson.results?.[0];
                prospectorFound = pr?.found === true;
                if (pr?.found) {
                  prospectorPartial = {
                    title: pr.title,
                    linkedinUrl: pr.linkedInUrl,
                    location: pr.location,
                  };
                }
              } else {
                console.error(
                  "[ZoomInfo] Prospector HTTP error:",
                  prospectorRes.status,
                );
              }
            } catch (e) {
              console.error("[ZoomInfo] Prospector request failed:", e);
            }

            const crEnough =
              Boolean(crResult.linkedinUrl?.trim()) ||
              Boolean(crResult.resolvedCompany?.trim());
            const stillNeedsEnrichment = !crEnough && !prospectorFound;

            let ziResult: Partial<EnrichedContact> = {};
            if (stillNeedsEnrichment) {
              emitProgress(
                i,
                `ZoomInfo & Common Room enriching ${nonHighIndex} of ${nonHighTotal} contacts…`,
              );
              ziResult = await enrichContactWithZoomInfo(contact);
              if (ziResult.enrichedByZoomInfo) {
                enrichedCount += 1;
              }
            }

            const merged = mergeEnrichedContact(
              contact,
              ziResult,
              crResult,
              prospectorPartial,
            );

            if (linkedinOnlyHigh) {
              mergedRows.push({
                ...contact,
                linkedinUrl: merged.linkedinUrl,
                enrichedByCommonRoom:
                  contact.enrichedByCommonRoom ||
                  Boolean(crResult.linkedinUrl?.trim()),
                enrichedByZoomInfo:
                  contact.enrichedByZoomInfo ||
                  Boolean(ziResult.linkedinUrl?.trim()),
                confidenceScore: "high",
                needsReview: false,
              });
            } else {
              mergedRows.push(merged);
            }
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
              enrichedCount,
              creditsUsed: enrichedCount,
            })}\n`,
          ),
        );
        controller.close();
      } catch (e) {
        const message = e instanceof Error ? e.message : "Enrichment failed.";
        const zoomInfoAuthFailure =
          message.includes("ZoomInfo credentials missing") ||
          message.includes("ZoomInfo token request failed") ||
          message.includes("ZoomInfo token response missing access_token");
        controller.enqueue(
          encoder.encode(
            `${JSON.stringify({
              type: "error",
              message,
              ...(zoomInfoAuthFailure ? { zoomInfoAuthFailure: true } : {}),
            })}\n`,
          ),
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
