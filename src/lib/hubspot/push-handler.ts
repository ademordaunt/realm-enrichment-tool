import type { HubSpotCompanyPushExtras } from "@/lib/hubspot/companies";
import {
  batchCreateCompanies,
  batchFindCompaniesByDomain,
  batchUpdateCompanies,
  findCompanyByName,
} from "@/lib/hubspot/companies";
import { normalizeDomain } from "@/lib/utils/domain";
import { isRecord } from "@/lib/utils/guards";
import {
  batchAssociateContactsToCompanies,
  batchCreateContacts,
  batchFindContactsByEmail,
  batchUpdateContacts,
  findContactByNameAndCompany,
} from "@/lib/hubspot/contacts";
import { getHubSpotAccessToken, hubspotFetch, readHubSpotError } from "@/lib/hubspot/http";
import { addRecordsToList } from "@/lib/hubspot/lists";
import type { HubSpotPushDonePayload } from "@/lib/hubspot/push-result";
import type { EnrichedCompany, EnrichedContact } from "@/lib/utils/types";

function deduplicateApproved(
  approved: Array<EnrichedCompany | EnrichedContact>,
  listType: "companies" | "contacts",
): Array<EnrichedCompany | EnrichedContact> {
  const seenKey = new Set<string>();
  const domainDeduped = approved.filter((row) => {
    const key =
      listType === "companies"
        ? normalizeDomain((row as EnrichedCompany).domain ?? "")
        : (row as EnrichedContact).resolvedEmail?.trim().toLowerCase() ?? "";
    if (!key) return true;
    if (seenKey.has(key)) return false;
    seenKey.add(key);
    return true;
  });

  if (listType !== "companies") return domainDeduped;

  const seenNameState = new Set<string>();
  return domainDeduped.filter((row) => {
    const c = row as EnrichedCompany;
    const name = (c.resolvedName ?? "").trim().toLowerCase();
    const state = (c.state ?? "").trim().toLowerCase();
    if (!name) return true;
    const nsKey = `${name}|${state}`;
    if (seenNameState.has(nsKey)) return false;
    seenNameState.add(nsKey);
    return true;
  });
}

type NdjsonProgress = { type: "progress"; current: number; total: number };
type NdjsonListCreated = {
  type: "list_created";
  listId: string;
  listName: string;
  folderId?: string;
};
type NdjsonDone = { type: "done" } & HubSpotPushDonePayload;
type NdjsonError = { type: "error"; message: string };

type CompanyBatchSets = {
  toUpdate: Array<{ id: string; company: EnrichedCompany }>;
  finalToCreate: EnrichedCompany[];
  nameMatchedCount: number;
  companiesNoState: number;
};

type ContactBatchSets = {
  toUpdate: Array<{ id: string; contact: EnrichedContact }>;
  toCreate: EnrichedContact[];
  rowIdToHsCompanyId: Map<string, string>;
  contactsNoDomain: number;
  contactsDomainNotFound: number;
};

async function deduplicateAndMatchCompanies(rowsC: EnrichedCompany[]): Promise<CompanyBatchSets> {
  const companiesNoState = rowsC.filter((c) => !c.state?.trim()).length;

  const known: EnrichedCompany[] = [];
  const unknown: EnrichedCompany[] = [];
  for (const c of rowsC) {
    if (typeof c.hubspotId === "string" && c.hubspotId.trim() !== "") {
      known.push(c);
    } else {
      unknown.push(c);
    }
  }

  const idMap = await batchFindCompaniesByDomain(unknown.map((r) => r.domain));

  const toUpdate: Array<{ id: string; company: EnrichedCompany }> = [];
  for (const c of known) {
    toUpdate.push({ id: c.hubspotId!.trim(), company: c });
  }
  for (const c of unknown) {
    const d = normalizeDomain(c.domain);
    const hid = d ? idMap.get(d) : undefined;
    if (hid) toUpdate.push({ id: hid, company: c });
  }

  const toUpdateIds = new Set(toUpdate.map((x) => x.company.id));
  const toCreate = unknown.filter((c) => !toUpdateIds.has(c.id));

  let nameMatchedCount = 0;
  for (const c of toCreate) {
    if (c.domain?.trim()) continue;
    const name = c.resolvedName?.trim() || c.rawInput?.trim();
    if (!name) continue;
    const fallbackId = await findCompanyByName(name);
    if (fallbackId) {
      toUpdate.push({ id: fallbackId, company: { ...c, matchedByName: true } });
      nameMatchedCount += 1;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const finalToCreateIds = new Set(toUpdate.map((x) => x.company.id));
  const finalToCreate = toCreate.filter((c) => !finalToCreateIds.has(c.id));

  return { toUpdate, finalToCreate, nameMatchedCount, companiesNoState };
}

async function deduplicateAndMatchContacts(rowsT: EnrichedContact[]): Promise<ContactBatchSets> {
  let contactsNoDomain = 0;
  let contactsDomainNotFound = 0;

  const allDomains = rowsT.flatMap((t) => {
    const d = (t.companyDomain?.trim() || t.ziCompanyWebsite?.trim()) ?? "";
    return d ? [d] : [];
  });
  const domainToCompanyIdMap = await batchFindCompaniesByDomain(allDomains);

  for (const t of rowsT) {
    const domain = t.companyDomain?.trim() || t.ziCompanyWebsite?.trim() || "";
    if (!domain) {
      contactsNoDomain += 1;
    } else {
      const compHsId = domainToCompanyIdMap.get(normalizeDomain(domain));
      if (compHsId) {
        t.hubspotCompanyId = compHsId;
      } else {
        contactsDomainNotFound += 1;
      }
    }
  }

  const known: EnrichedContact[] = [];
  const unknown: EnrichedContact[] = [];
  for (const t of rowsT) {
    if (typeof t.hubspotId === "string" && t.hubspotId.trim() !== "") {
      known.push(t);
    } else {
      unknown.push(t);
    }
  }

  const idMap = await batchFindContactsByEmail(unknown.map((r) => r.resolvedEmail));

  const toUpdate: Array<{ id: string; contact: EnrichedContact }> = [];
  for (const t of known) {
    toUpdate.push({ id: t.hubspotId!.trim(), contact: t });
  }
  for (const t of unknown) {
    const em = t.resolvedEmail?.trim().toLowerCase() ?? "";
    const hid = em ? idMap.get(em) : undefined;
    if (hid) toUpdate.push({ id: hid, contact: t });
  }

  const matchedIds = new Set<string>(toUpdate.map((x) => x.contact.id));
  for (const t of unknown) {
    if (matchedIds.has(t.id)) continue;
    const firstName = t.firstName?.trim() ?? "";
    const lastName = t.lastName?.trim() ?? "";
    const company = t.resolvedCompany?.trim() ?? "";
    if (!firstName || !lastName || !company) continue;
    const fallbackId = await findContactByNameAndCompany(firstName, lastName, company);
    if (fallbackId) {
      toUpdate.push({ id: fallbackId, contact: t });
      matchedIds.add(t.id);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const toUpdateIds = new Set(toUpdate.map((x) => x.contact.id));
  const toCreate = unknown.filter((t) => !toUpdateIds.has(t.id));

  const rowIdToHsCompanyId = new Map<string, string>(
    rowsT.filter((t) => t.hubspotCompanyId).map((t) => [t.id, t.hubspotCompanyId!]),
  );

  return { toUpdate, toCreate, rowIdToHsCompanyId, contactsNoDomain, contactsDomainNotFound };
}

function buildPushExtras(
  c: EnrichedContact,
  leadSource: string,
  leadSourceDescription: string,
  notes: string,
  useExistingLeadSource: boolean,
  useExistingLeadSourceDescription: boolean,
): HubSpotCompanyPushExtras | undefined {
  const rowLeadSource = useExistingLeadSource ? (c.leadSource?.trim() ?? "") : leadSource;
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
}

function parseListIdFromHubSpotListsJson(json: {
  list?: { listId?: string | number; id?: string | number; hs_list_id?: string | number };
  listId?: string | number;
  id?: string | number;
  hs_list_id?: string | number;
  list_id?: string | number;
  objectId?: string | number;
  object_id?: string | number;
}): string | null {
  const listId =
    json.list?.listId ??
    json.list?.id ??
    json.list?.hs_list_id ??
    json.listId ??
    json.id ??
    json.hs_list_id ??
    json.list_id ??
    json.objectId ??
    json.object_id;
  return listId != null && String(listId).trim() !== "" ? String(listId) : null;
}

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
    const createErr = await readHubSpotError(res);
    if (!/already exist/i.test(createErr)) {
      throw new Error(createErr);
    }
    const getPath = `/crm/v3/lists/object-type-id/${encodeURIComponent(objectTypeId)}/name/${encodeURIComponent(name)}`;
    const getRes = await hubspotFetch(getPath, { method: "GET" });
    if (!getRes.ok) {
      throw new Error(createErr);
    }
    const getJson = (await getRes.json()) as Parameters<typeof parseListIdFromHubSpotListsJson>[0];
    const existingId = parseListIdFromHubSpotListsJson(getJson);
    if (!existingId) {
      throw new Error(createErr);
    }
    return existingId;
  }

  const json = (await res.json()) as Parameters<typeof parseListIdFromHubSpotListsJson>[0];
  const listId = parseListIdFromHubSpotListsJson(json);
  if (!listId) {
    throw new Error("HubSpot did not return listId when creating a list.");
  }
  return listId;
}

/**
 * Validates the push request body and returns an NDJSON stream response, or a JSON error response.
 */
export async function handleHubSpotPushRequest(
  request: Request,
): Promise<Response> {
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

  const approvedRaw = rows.filter((r) => isRecord(r) && r.status === "approved") as Array<
    EnrichedCompany | EnrichedContact
  >;
  const approved = deduplicateApproved(approvedRaw, listType);

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (obj: NdjsonProgress | NdjsonListCreated | NdjsonDone | NdjsonError) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      };

      let created = 0;
      let updated = 0;
      let nameMatchedCount = 0;
      let contactsAssociated = 0;
      let contactsDomainNotFound = 0;
      let contactsNoDomain = 0;
      let companiesNoState = 0;
      const errors: { rowId: string; error: string }[] = [];
      const recordIds: string[] = [];

      const total = approved.length;
      let currentProgress = 0;
      const emitProgress = (current: number) => {
        write({ type: "progress", current: Math.min(current, total), total });
      };
      const onAfterChunk = (n: number) => {
        currentProgress = Math.min(currentProgress + n, total);
        emitProgress(currentProgress);
      };

      const mergeRowErrors = (batchErrors: Array<{ rowId: string; error: string }>) => {
        for (const e of batchErrors) {
          errors.push(e);
        }
      };

      try {
        const objectTypeId = listType === "companies" ? "0-2" : "0-1";
        const listId = await createStaticListForPush(listName, objectTypeId, folderId);
        write({
          type: "list_created",
          listId,
          listName,
          ...(folderId ? { folderId } : {}),
        });
        write({ type: "progress", current: 0, total });

        if (listType === "companies") {
          const rowsC = approved as EnrichedCompany[];
          const {
            toUpdate,
            finalToCreate,
            nameMatchedCount: matched,
            companiesNoState: noState,
          } = await deduplicateAndMatchCompanies(rowsC);
          nameMatchedCount = matched;
          companiesNoState = noState;

          const { success: uOk, rowErrors: uErr } = await batchUpdateCompanies(
            toUpdate,
            pushExtras,
            onAfterChunk,
          );
          updated += uOk.length;
          mergeRowErrors(uErr);
          uOk.forEach((r) => recordIds.push(r.id));

          const { success: cOk, rowErrors: cErr } = await batchCreateCompanies(
            finalToCreate,
            pushExtras,
            onAfterChunk,
          );
          created += cOk.length;
          mergeRowErrors(cErr);
          cOk.forEach((r) => recordIds.push(r.id));
        } else {
          const rowsT = approved as EnrichedContact[];
          const {
            toUpdate,
            toCreate,
            rowIdToHsCompanyId,
            contactsNoDomain: noDomain,
            contactsDomainNotFound: notFound,
          } = await deduplicateAndMatchContacts(rowsT);
          contactsNoDomain = noDomain;
          contactsDomainNotFound = notFound;

          const resolveContactExtras = (c: EnrichedContact) =>
            buildPushExtras(
              c,
              leadSource,
              leadSourceDescription,
              notes,
              useExistingLeadSource,
              useExistingLeadSourceDescription,
            );

          const { success: uOk, rowErrors: uErr } = await batchUpdateContacts(
            toUpdate,
            resolveContactExtras,
            onAfterChunk,
          );
          updated += uOk.length;
          mergeRowErrors(uErr);
          uOk.forEach((r) => recordIds.push(r.id));

          const { success: cOk, rowErrors: cErr } = await batchCreateContacts(
            toCreate,
            resolveContactExtras,
            onAfterChunk,
          );
          created += cOk.length;
          mergeRowErrors(cErr);
          cOk.forEach((r) => recordIds.push(r.id));

          // Write contact-to-company associations for all successfully pushed contacts
          const allPushed = [...uOk, ...cOk];
          const associations: Array<{ contactHubSpotId: string; companyHubSpotId: string }> = [];
          for (const pushed of allPushed) {
            const companyHsId = rowIdToHsCompanyId.get(pushed.rowId);
            if (companyHsId) {
              associations.push({ contactHubSpotId: pushed.id, companyHubSpotId: companyHsId });
            }
          }
          if (associations.length > 0) {
            const assocResult = await batchAssociateContactsToCompanies(associations);
            contactsAssociated = assocResult.associated;
            if (assocResult.errors.length > 0) {
              console.error(
                `[hubspot/push] ${assocResult.errors.length} association errors`,
                assocResult.errors.slice(0, 3),
              );
            }
          }
        }

        if (currentProgress < total) {
          currentProgress = total;
          emitProgress(total);
        }

        const totalPushed = created + updated;

        const done: NdjsonDone = {
          type: "done",
          created,
          updated,
          errors,
          listId,
          listName,
          totalPushed,
          ...(folderId ? { folderId } : {}),
          ...(nameMatchedCount > 0 ? { nameMatchedCount } : {}),
          ...(listType === "companies" && companiesNoState > 0 ? { companiesNoState } : {}),
          ...(listType === "contacts"
            ? {
                contactsAssociated,
                contactsDomainNotFound,
                contactsNoDomain,
                contactsNoCompanyAssociation: contactsDomainNotFound + contactsNoDomain,
              }
            : {}),
        };

        try {
          await addRecordsToList(listId, recordIds);
        } catch (membershipErr) {
          const msg =
            membershipErr instanceof Error ? membershipErr.message : String(membershipErr);
          console.error("[hubspot/push] membership add failed:", msg);
          done.errors.push({
            rowId: "membership",
            error: `List created but membership add failed: ${msg}`,
          });
        }

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
