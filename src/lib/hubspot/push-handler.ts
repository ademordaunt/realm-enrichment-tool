import type { HubSpotCompanyPushExtras } from "@/lib/hubspot/companies";
import {
  createCompany,
  findExistingCompany,
  updateCompany,
} from "@/lib/hubspot/companies";
import {
  createContact,
  findExistingContact,
  updateContact,
} from "@/lib/hubspot/contacts";
import { getHubSpotAccessToken, hubspotFetch, readHubSpotError } from "@/lib/hubspot/http";
import { addRecordsToList } from "@/lib/hubspot/lists";
import type { HubSpotPushDonePayload } from "@/lib/hubspot/push-result";
import type { EnrichedCompany, EnrichedContact } from "@/lib/utils/types";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

type NdjsonProgress = { type: "progress"; current: number; total: number };
type NdjsonDone = { type: "done" } & HubSpotPushDonePayload;
type NdjsonError = { type: "error"; message: string };

async function createStaticListForPush(
  name: string,
  objectTypeId: string,
  folderId?: string,
): Promise<string> {
  const payload: Record<string, unknown> = {
    name,
    objectTypeId,
    processingType: "MANUAL",
  };
  if (folderId?.trim()) {
    const raw = folderId.trim();
    const n = Number(raw);
    payload.folderId = Number.isFinite(n) && String(n) === raw ? n : raw;
  }

  const res = await hubspotFetch("/crm/v3/lists", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(await readHubSpotError(res));
  }

  const json = (await res.json()) as {
    list?: { listId?: string; id?: string };
    listId?: string;
    id?: string;
  };
  const listId = json.list?.listId ?? json.list?.id ?? json.listId ?? json.id;
  if (!listId) {
    throw new Error("HubSpot did not return listId when creating a list.");
  }
  return String(listId);
}

/**
 * Validates the push request body and returns an NDJSON stream response, or a JSON error response.
 */
export async function handleHubSpotPushRequest(request: Request): Promise<Response> {
  try {
    getHubSpotAccessToken();
  } catch {
    return Response.json(
      { error: "Missing HUBSPOT_ACCESS_TOKEN. Add it to .env.local." },
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

  const {
    rows,
    listType,
    eventName,
    listName: listNameRaw,
    folderId: folderIdRaw,
    leadSource: leadSourceRaw,
    leadSourceDescription: leadSourceDescriptionRaw,
    useExistingLeadSource: useExistingLeadSourceRaw,
    useExistingLeadSourceDescription: useExistingLeadSourceDescriptionRaw,
    notes: notesRaw,
  } = body;

  if (!Array.isArray(rows)) {
    return Response.json({ error: "Expected `rows` array." }, { status: 400 });
  }

  if (listType !== "companies" && listType !== "contacts") {
    return Response.json(
      { error: "`listType` must be \"companies\" or \"contacts\"." },
      { status: 400 },
    );
  }

  const listName =
    String(listNameRaw ?? "").trim() || String(eventName ?? "").trim();
  if (!listName) {
    return Response.json(
      { error: "Expected non-empty `listName` or `eventName`." },
      { status: 400 },
    );
  }

  const folderId =
    folderIdRaw != null && String(folderIdRaw).trim() !== ""
      ? String(folderIdRaw).trim()
      : undefined;

  const leadSource = String(leadSourceRaw ?? "").trim();
  const leadSourceDescription = String(leadSourceDescriptionRaw ?? "").trim();
  const useExistingLeadSource = useExistingLeadSourceRaw === true;
  const useExistingLeadSourceDescription = useExistingLeadSourceDescriptionRaw === true;
  const notes = String(notesRaw ?? "").trim();

  const pushExtras: HubSpotCompanyPushExtras | undefined =
    leadSource || leadSourceDescription || notes
      ? {
          leadSource: leadSource || undefined,
          leadSourceDescription: leadSourceDescription || undefined,
          notes: notes || undefined,
        }
      : undefined;

  const approved = rows.filter((r) => isRecord(r) && r.status === "approved") as Array<
    EnrichedCompany | EnrichedContact
  >;

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (obj: NdjsonProgress | NdjsonDone | NdjsonError) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      };

      try {
        let created = 0;
        let updated = 0;
        const errors: { rowId: string; error: string }[] = [];
        const recordIds: string[] = [];

        const total = approved.length;

        for (let i = 0; i < approved.length; i++) {
          const row = approved[i]!;
          try {
            if (listType === "companies") {
              const c = row as EnrichedCompany;
              const existing = await findExistingCompany(c.domain);
              let id: string;
              if (existing) {
                id = await updateCompany(existing, c, pushExtras);
                updated++;
              } else {
                id = await createCompany(c, pushExtras);
                created++;
              }
              recordIds.push(id);
            } else {
              const c = row as EnrichedContact;
              const existing = await findExistingContact(c.resolvedEmail);
              const contactPushExtras: HubSpotCompanyPushExtras | undefined =
                (() => {
                  const rowLeadSource = useExistingLeadSource
                    ? c.leadSource?.trim() ?? ""
                    : leadSource;
                  const rowLeadSourceDescriptionFromCsv = c.leadSourceDescription?.trim() ?? "";
                  const rowLeadSourceDescription = useExistingLeadSourceDescription
                    ? rowLeadSourceDescriptionFromCsv || leadSourceDescription
                    : leadSourceDescription;
                  const rowNotes = notes;
                  if (!rowLeadSource && !rowLeadSourceDescription && !rowNotes) {
                    return undefined;
                  }
                  return {
                    leadSource: rowLeadSource || undefined,
                    leadSourceDescription: rowLeadSourceDescription || undefined,
                    notes: rowNotes || undefined,
                  };
                })();
              let id: string;
              if (existing) {
                id = await updateContact(existing, c, contactPushExtras);
                updated++;
              } else {
                id = await createContact(c, contactPushExtras);
                created++;
              }
              recordIds.push(id);
            }
          } catch (e) {
            const message = e instanceof Error ? e.message : "Unknown error";
            console.error("[hubspot/push] row failed", row.id, message);
            errors.push({ rowId: row.id, error: message });
          }

          write({ type: "progress", current: i + 1, total });
        }

        const objectTypeId = listType === "companies" ? "0-2" : "0-1";
        const listId = await createStaticListForPush(listName, objectTypeId, folderId);
        await addRecordsToList(listId, recordIds);

        const totalPushed = created + updated;

        const done: NdjsonDone = {
          type: "done",
          created,
          updated,
          errors,
          listId,
          listName,
          totalPushed,
        };
        write(done);
        controller.close();
      } catch (e) {
        const message = e instanceof Error ? e.message : "HubSpot push failed.";
        console.error("[hubspot/push]", message);
        write({ type: "error", message });
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
