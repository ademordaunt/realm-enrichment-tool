import { enrichContactWithCommonRoom } from "@/lib/enrichment/commonroom-enricher";
import { mergeEnrichedCompany, mergeEnrichedContact } from "@/lib/enrichment/merger";
import { checkKvConnectivity, getCachedContact } from "@/lib/cache/enrichment-cache";
import {
  delayBetweenZoomInfoCalls,
  enrichCompanyWithZoomInfo,
  enrichContactWithZoomInfo,
} from "@/lib/enrichment/zoominfo-enricher";
import type { EnrichedCompany, EnrichedContact } from "@/lib/utils/types";

export const maxDuration = 9;
void checkKvConnectivity();

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function badRequest(detail: string) {
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

  if (!isRecord(body)) {
    return badRequest("Expected a JSON object.");
  }

  const { rows, listType } = body;

  if (!Array.isArray(rows) || rows.length === 0) {
    return badRequest("Expected non-empty `rows` array of enriched records.");
  }

  if (listType !== "companies" && listType !== "contacts") {
    return badRequest('`listType` must be "companies" or "contacts".');
  }

  const chunkIndex =
    typeof body.chunkIndex === "number" && body.chunkIndex >= 0
      ? body.chunkIndex
      : 0;
  const chunkSize =
    typeof body.chunkSize === "number" && body.chunkSize > 0
      ? body.chunkSize
      : rows.length;
  const chunkRowOffset = chunkIndex * chunkSize;

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const allRows = rows as (EnrichedCompany | EnrichedContact)[];
        const totalRows =
          typeof body.totalRows === "number" && body.totalRows > 0
            ? body.totalRows
            : allRows.length;
        const nonHighTotalFromBody =
          typeof body.nonHighTotal === "number" && Number.isFinite(body.nonHighTotal)
            ? body.nonHighTotal
            : null;
        const nonHighTotal =
          nonHighTotalFromBody ??
          (listType === "companies"
            ? allRows.filter((r) => r.confidenceScore !== "high").length
            : allRows.filter((r) => {
                if (r.confidenceScore !== "high") return true;
                const c = r as EnrichedContact;
                return !c.linkedinUrl?.trim();
              }).length);
        const nonHighPrefixCount =
          typeof body.nonHighPrefixCount === "number" &&
          body.nonHighPrefixCount >= 0
            ? body.nonHighPrefixCount
            : 0;
        let nonHighIndex = nonHighPrefixCount;

        const mergedRows: (EnrichedCompany | EnrichedContact)[] = [];
        let enrichedCount = 0;
        let cachedCount = 0;
        const prospectorEndpoint = new URL(
          "/api/enrich/prospector",
          request.url,
        ).href;

        const emitProgress = (globalRowIndex: number, detail?: string) => {
          controller.enqueue(
            encoder.encode(
              `${JSON.stringify({
                type: "progress",
                start: globalRowIndex + 1,
                end: globalRowIndex + 1,
                total: totalRows,
                detail: detail ?? undefined,
              })}\n`,
            ),
          );
        };

        const isLastChunk = chunkRowOffset + allRows.length >= totalRows;

        for (let localI = 0; localI < allRows.length; localI++) {
          const globalI = chunkRowOffset + localI;
          const row = allRows[localI]!;

          if (listType === "companies" && row.confidenceScore === "high") {
            mergedRows.push(row);
            emitProgress(globalI);
            continue;
          }

          if (listType === "contacts") {
            const c = row as EnrichedContact;
            const cacheEmail = c.rawEmail?.trim() ?? "";
            if (cacheEmail) {
              const cached = await getCachedContact(cacheEmail);
              if (cached?.enrichedByZoomInfo) {
                cachedCount += 1;
                mergedRows.push({
                  ...cached,
                  id: c.id,
                });
                emitProgress(globalI);
                continue;
              }
            }
            if (c.confidenceScore === "high" && c.linkedinUrl?.trim()) {
              mergedRows.push(row);
              emitProgress(globalI);
              continue;
            }
          }

          nonHighIndex += 1;

          if (listType === "companies") {
            emitProgress(
              globalI,
              `ZoomInfo enriching ${nonHighIndex} of ${nonHighTotal} companies…`,
            );
            const zi = await enrichCompanyWithZoomInfo(row as EnrichedCompany);
            if (zi.enrichedByZoomInfo && zi.cachedHit) {
              cachedCount += 1;
            } else if (zi.enrichedByZoomInfo) {
              enrichedCount += 1;
            }
            const { cachedHit: _cachedHit, ...ziFields } = zi;
            mergedRows.push(
              mergeEnrichedCompany(row as EnrichedCompany, ziFields, {}),
            );
          } else {
            const contact = row as EnrichedContact;
            const linkedinOnlyHigh =
              contact.confidenceScore === "high" && !contact.linkedinUrl?.trim();

            emitProgress(
              globalI,
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
                globalI,
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

          if (localI < allRows.length - 1) {
            await delayBetweenZoomInfoCalls(200);
          }
        }

        if (isLastChunk) {
          controller.enqueue(
            encoder.encode(
              `${JSON.stringify({
                type: "progress",
                start: 1,
                end: totalRows,
                total: totalRows,
              })}\n`,
            ),
          );
        }

        controller.enqueue(
          encoder.encode(
            `${JSON.stringify({
              type: "done",
              listType,
              rows: mergedRows,
              enrichedCount,
              cachedCount,
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
  } catch (err) {
    return Response.json(
      { error: "Internal server error", detail: String(err) },
      { status: 500 },
    );
  }
}
