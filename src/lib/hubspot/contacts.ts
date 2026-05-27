import type { HubSpotCompanyPushExtras } from "@/lib/hubspot/companies";
import type { EnrichedContact } from "@/lib/utils/types";
import { hubspotFetch, readHubSpotError } from "@/lib/hubspot/http";
import { toHubSpotIndustry } from "@/lib/hubspot/industry-map";

type HubSpotContactPrecheckResult = {
  hubspotId: string;
  existingData: Record<string, string>;
};

const CONTACT_PRECHECK_PROPERTIES = [
  "email",
  "jobtitle",
  "company",
  "ds_liprofile",
  "state",
  "phone",
  "job_level",
  "job_function",
  "hs_additional_emails",
  "lead_source__deal_source",
  "lead_source_description",
] as const;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function chunkValues(values: string[], size: number): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size));
  }
  return chunks;
}

async function hubspotSearchWithBackoff(path: string, body: string): Promise<Response> {
  const delays = [1000, 3000];
  let attempt = 0;
  while (true) {
    const res = await hubspotFetch(path, { method: "POST", body });
    if (res.status !== 429) return res;
    if (attempt >= delays.length) return res;
    await new Promise((resolve) => setTimeout(resolve, delays[attempt]!));
    attempt += 1;
  }
}

function isEmpty(val: string | null | undefined): boolean {
  if (val == null) return true;
  return String(val).trim() === "";
}

function additionalEmailTokens(existingVal: string | null | undefined): string[] {
  return String(existingVal ?? "")
    .split(/[;,]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function additionalEmailTokenSetsEqual(a: string, b: string): boolean {
  const norm = (s: string) =>
    additionalEmailTokens(s)
      .map((t) => t.toLowerCase())
      .sort()
      .join("|");
  return norm(a) === norm(b);
}

/** Ensures `personalEmail` appears in HubSpot secondary emails without dropping existing values. */
function mergeHsAdditionalEmailsWithPersonal(
  existingVal: string | null | undefined,
  personalEmail: string,
): string {
  const personal = personalEmail.trim();
  const tokens = additionalEmailTokens(existingVal);
  const lowerPersonal = personal.toLowerCase();
  if (!tokens.some((t) => t.toLowerCase() === lowerPersonal)) {
    tokens.push(personal);
  }
  return tokens.join("; ");
}

/**
 * Builds HubSpot properties payload for a contact.
 *
 * When `existingData` is provided (update path), field-specific write rules are applied:
 * - "Fill empty only": included only when the existing HubSpot value is empty.
 * - "Never overwrite" (email): never sent on updates.
 * - "Overwrite": always sent when we have a non-empty value.
 *
 * When `existingData` is omitted (create path), all available fields are sent.
 */
function contactProperties(
  contact: EnrichedContact,
  extras?: HubSpotCompanyPushExtras,
  existingData?: Record<string, string>,
): Record<string, string> {
  const ex = existingData ?? {};
  const isUpdate = existingData !== undefined;
  const props: Record<string, string> = {};

  // firstname — Fill empty only
  if (isEmpty(ex.firstname)) props.firstname = contact.firstName?.trim() ?? "";

  // lastname — Fill empty only
  if (isEmpty(ex.lastname)) props.lastname = contact.lastName?.trim() ?? "";

  // email — Never overwrite (only sent on create)
  if (!isUpdate) props.email = contact.resolvedEmail?.trim() ?? "";

  // jobtitle — Fill empty only
  if (isEmpty(ex.jobtitle)) props.jobtitle = contact.title?.trim() ?? "";

  // company — Fill empty only
  if (isEmpty(ex.company)) props.company = contact.resolvedCompany?.trim() ?? "";

  // ds_liprofile (LinkedIn) — Fill empty only
  if (contact.linkedinUrl?.trim() && isEmpty(ex.ds_liprofile)) {
    props.ds_liprofile = contact.linkedinUrl.trim();
  }

  // state — Overwrite (send whenever we have a value)
  const state = contact.location?.trim() ?? "";
  if (state) props.state = state;

  // phone — Fill empty only
  if (contact.phone?.trim() && isEmpty(ex.phone)) props.phone = contact.phone.trim();

  // lead source — Fill empty only (extras take priority over row value)
  const leadSourceVal = extras?.leadSource?.trim() || contact.leadSource?.trim();
  if (leadSourceVal && isEmpty(ex.lead_source__deal_source)) {
    // WRITE RULE: fill-empty-only — Lead Source is operator-set and must never be overwritten by enrichment.
    props.lead_source__deal_source = leadSourceVal;
  }

  // lead source description — Fill empty only
  const lsdVal = extras?.leadSourceDescription?.trim() || contact.leadSourceDescription?.trim();
  if (lsdVal && isEmpty(ex.lead_source_description)) {
    props.lead_source_description = lsdVal;
  }

  // membership notes — Fill empty only
  const notesVal = extras?.notes?.trim() || contact.membershipNotes?.trim() || contact.notes?.trim();
  if (notesVal && isEmpty(ex.hs_content_membership_notes)) {
    props.hs_content_membership_notes = notesVal;
  }

  // job_level — Fill empty only
  if (contact.ziManagementLevel?.trim() && isEmpty(ex.job_level)) {
    props.job_level = contact.ziManagementLevel.trim();
  }

  // job_function — Fill empty only
  if (contact.ziJobFunction?.trim() && isEmpty(ex.job_function)) {
    props.job_function = contact.ziJobFunction.trim();
  }

  // industry — Fill empty only
  if (contact.ziCompanyPrimaryIndustry?.trim() && isEmpty(ex.industry)) {
    const industryEnum = toHubSpotIndustry(contact.ziCompanyPrimaryIndustry);
    if (industryEnum) props.industry = industryEnum;
  }

  // numemployees — Overwrite
  if (contact.ziCompanyEmployeeCount?.trim()) {
    props.numemployees = contact.ziCompanyEmployeeCount.trim();
  }

  // website — Fill empty only
  if (isEmpty(contact.companyDomain) && contact.ziCompanyWebsite?.trim() && isEmpty(ex.website)) {
    props.website = contact.ziCompanyWebsite.trim();
  }

  // hs_additional_emails — include distinct personal when present; merge into existing list
  const personalEmail = contact.personalEmail?.trim() ?? "";
  const resolvedEmail = contact.resolvedEmail?.trim() ?? "";
  const shouldWritePersonalAdditional =
    Boolean(personalEmail) &&
    Boolean(resolvedEmail) &&
    personalEmail.toLowerCase() !== resolvedEmail.toLowerCase();
  if (shouldWritePersonalAdditional) {
    const merged = mergeHsAdditionalEmailsWithPersonal(ex.hs_additional_emails, personalEmail);
    if (!additionalEmailTokenSetsEqual(merged, String(ex.hs_additional_emails ?? ""))) {
      props.hs_additional_emails = merged;
    }
  }

  return props;
}

export async function findExistingContact(email: string): Promise<string | null> {
  const e = normalizeEmail(email);
  if (!e) return null;

  const res = await hubspotFetch("/crm/v3/objects/contacts/search", {
    method: "POST",
    body: JSON.stringify({
      filterGroups: [
        {
          filters: [
            {
              propertyName: "email",
              operator: "EQ",
              value: e,
            },
          ],
        },
      ],
      limit: 1,
      properties: ["email"],
    }),
  });

  if (!res.ok) {
    throw new Error(await readHubSpotError(res));
  }

  const json = (await res.json()) as { results?: { id: string }[] };
  const id = json.results?.[0]?.id;
  return id ?? null;
}

export async function findContactByNameAndCompany(
  firstName: string,
  lastName: string,
  company: string,
): Promise<string | null> {
  const fn = firstName.trim();
  const ln = lastName.trim();
  const co = company.trim();
  if (!fn || !ln || !co) return null;

  const res = await hubspotFetch("/crm/v3/objects/contacts/search", {
    method: "POST",
    body: JSON.stringify({
      filterGroups: [
        {
          filters: [
            { propertyName: "firstname", operator: "EQ", value: fn },
            { propertyName: "lastname", operator: "EQ", value: ln },
            { propertyName: "company", operator: "EQ", value: co },
          ],
        },
      ],
      properties: ["email", "firstname", "lastname", "company"],
      limit: 2,
    }),
  });

  if (!res.ok) {
    throw new Error(await readHubSpotError(res));
  }

  const json = (await res.json()) as { results?: Array<{ id?: string | number }> };
  const results = json.results ?? [];
  if (results.length !== 1) return null;

  const id = results[0]?.id;
  return id != null && String(id).trim() !== "" ? String(id) : null;
}

export async function batchCheckContactsInHubSpot(
  emails: string[],
): Promise<Map<string, HubSpotContactPrecheckResult>> {
  const normalizedEmails = Array.from(
    new Set(emails.map((email) => normalizeEmail(email)).filter((email) => Boolean(email))),
  );
  const results = new Map<string, HubSpotContactPrecheckResult>();
  if (normalizedEmails.length === 0) return results;

  for (const emailBatch of chunkValues(normalizedEmails, 100)) {
    let after: string | undefined;
    do {
      const searchBody = {
        filterGroups: [
          {
            filters: [
              {
                propertyName: "email",
                operator: "IN",
                values: emailBatch,
              },
            ],
          },
        ],
        limit: 200,
        properties: [...CONTACT_PRECHECK_PROPERTIES],
        sorts: [{ propertyName: "hs_lastmodifieddate", direction: "DESCENDING" }],
        ...(after ? { after } : {}),
      };
      const res = await hubspotSearchWithBackoff(
        "/crm/v3/objects/contacts/search",
        JSON.stringify(searchBody),
      );

      if (!res.ok) {
        throw new Error(await readHubSpotError(res));
      }

      const json = (await res.json()) as {
        results?: Array<{ id: string; properties?: Record<string, string | null> }>;
        paging?: { next?: { after?: string } };
      };
      for (const row of json.results ?? []) {
        const props = row.properties ?? {};
        const normalized = normalizeEmail(String(props.email ?? ""));
        if (!normalized || results.has(normalized)) continue;
        const existingData: Record<string, string> = {};
        for (const key of CONTACT_PRECHECK_PROPERTIES) {
          existingData[key] = String(props[key] ?? "");
        }
        results.set(normalized, { hubspotId: String(row.id), existingData });
      }
      after = json.paging?.next?.after;
    } while (after);
  }

  return results;
}

const HUBSPOT_BATCH_SIZE = 100;
const HUBSPOT_BATCH_COOLDOWN_MS = 200;

function delayBatchCooldown(cOffset: number): Promise<void> {
  if (cOffset <= 0) return Promise.resolve();
  return new Promise((r) => setTimeout(r, HUBSPOT_BATCH_COOLDOWN_MS));
}

type HubspotBatchCrmItemError = {
  message?: string;
  in?: { id?: string };
  context?: { id?: string[]; index?: number } | null;
  category?: string;
};

type HubspotBatchCrmResponse = {
  status?: string;
  results?: Array<{ id?: string } | null | undefined>;
  errors?: HubspotBatchCrmItemError[];
  numErrors?: number;
};

function errorMessageForBatchIndex(
  body: HubspotBatchCrmResponse,
  j: number,
  fallback: string,
): string {
  for (const e of body.errors ?? []) {
    const idx =
      (e as { index?: number }).index ??
      (e.context as { index?: number } | undefined)?.index;
    if (idx === j) return e.message || fallback;
  }
  if (body.errors?.[j]) return body.errors[j]!.message || fallback;
  return fallback;
}

/** HubSpot batch create sometimes returns per-index errors like "Contact already exists. Existing ID: 123". */
function parseHubSpotDuplicateExistingId(message: string): string | null {
  const m = message.match(
    /\b(?:Contact|Company) already exists\.?\s*Existing ID:\s*(\d+)\b/i,
  );
  return m?.[1]?.trim() ?? null;
}

/**
 * Emails (normalized) → HubSpot id; same search pattern as precheck, 100 / chunk, 200ms between chunks.
 */
export async function batchFindContactsByEmail(emails: string[]): Promise<Map<string, string>> {
  const normalized = Array.from(
    new Set(emails.map((e) => normalizeEmail(e)).filter((e) => Boolean(e))),
  );
  const out = new Map<string, string>();
  for (let i = 0; i < normalized.length; i += HUBSPOT_BATCH_SIZE) {
    await delayBatchCooldown(i);
    const part = await batchCheckContactsInHubSpot(normalized.slice(i, i + HUBSPOT_BATCH_SIZE));
    for (const [e, v] of part) {
      out.set(e, v.hubspotId);
    }
  }
  return out;
}

export type BatchContactRowOk = { id: string; resolvedEmail: string; rowId: string };
export type BatchContactRowError = { rowId: string; error: string };

export async function batchCreateContacts(
  contacts: EnrichedContact[],
  resolveExtras: (c: EnrichedContact) => HubSpotCompanyPushExtras | undefined,
  onAfterChunk?: (size: number) => void,
): Promise<{ success: BatchContactRowOk[]; rowErrors: BatchContactRowError[] }> {
  const success: BatchContactRowOk[] = [];
  const rowErrors: BatchContactRowError[] = [];
  if (contacts.length === 0) return { success, rowErrors };

  for (let c = 0; c < contacts.length; c += HUBSPOT_BATCH_SIZE) {
    await delayBatchCooldown(c);
    const chunk = contacts.slice(c, c + HUBSPOT_BATCH_SIZE);
    const res = await hubspotFetch("/crm/v3/objects/contacts/batch/create", {
      method: "POST",
      body: JSON.stringify({
        inputs: chunk.map((row) => ({
          properties: contactProperties(row, resolveExtras(row)),
        })),
      }),
    });
    if (!res.ok) {
      const errText = await readHubSpotError(res);
      if (/already exists/i.test(errText)) {
        const toUpdateFromHttp: Array<{ id: string; contact: EnrichedContact }> = [];
        for (const row of chunk) {
          const singleRes = await hubspotFetch("/crm/v3/objects/contacts", {
            method: "POST",
            body: JSON.stringify({
              properties: contactProperties(row, resolveExtras(row)),
            }),
          });
          if (singleRes.ok) {
            const json = (await singleRes.json()) as { id?: string };
            const newId = json.id != null ? String(json.id) : null;
            if (newId) {
              success.push({ id: newId, resolvedEmail: row.resolvedEmail, rowId: row.id });
            } else {
              rowErrors.push({ rowId: row.id, error: "HubSpot create returned no id." });
            }
          } else {
            const rowErr = await readHubSpotError(singleRes);
            const existingId = parseHubSpotDuplicateExistingId(rowErr);
            if (existingId) {
              toUpdateFromHttp.push({ id: existingId, contact: row });
            } else {
              rowErrors.push({ rowId: row.id, error: rowErr });
            }
          }
        }
        if (toUpdateFromHttp.length > 0) {
          const seenHubSpotIds = new Set<string>();
          const dedupedToUpdate: Array<{ id: string; contact: EnrichedContact }> = [];
          for (const row of toUpdateFromHttp) {
            if (seenHubSpotIds.has(row.id)) {
              success.push({
                id: row.id,
                resolvedEmail: row.contact.resolvedEmail,
                rowId: row.contact.id,
              });
              continue;
            }
            seenHubSpotIds.add(row.id);
            dedupedToUpdate.push(row);
          }
          const upd = await batchUpdateContacts(dedupedToUpdate, resolveExtras);
          success.push(...upd.success);
          rowErrors.push(...upd.rowErrors);
        }
        onAfterChunk?.(chunk.length);
        continue;
      }
      for (const row of chunk) {
        rowErrors.push({ rowId: row.id, error: errText });
      }
      onAfterChunk?.(chunk.length);
      continue;
    }
    const body = (await res.json()) as HubspotBatchCrmResponse;
    const toUpdate: Array<{ id: string; contact: EnrichedContact }> = [];
    for (let j = 0; j < chunk.length; j++) {
      const r = body.results?.[j];
      const id = r?.id != null ? String(r.id) : null;
      if (id) {
        const row = chunk[j]!;
        success.push({ id, resolvedEmail: row.resolvedEmail, rowId: row.id });
      } else {
        const row = chunk[j]!;
        const msg = errorMessageForBatchIndex(
          body,
          j,
          "HubSpot batch create returned no id for this row.",
        );
        const existingId = parseHubSpotDuplicateExistingId(msg);
        if (existingId) {
          toUpdate.push({ id: existingId, contact: row });
        } else {
          rowErrors.push({ rowId: row.id, error: msg });
        }
      }
    }
    if (toUpdate.length > 0) {
      const seenHubSpotIds = new Set<string>();
      const dedupedToUpdate: Array<{ id: string; contact: EnrichedContact }> = [];
      for (const row of toUpdate) {
        if (seenHubSpotIds.has(row.id)) {
          success.push({ id: row.id, resolvedEmail: row.contact.resolvedEmail, rowId: row.contact.id });
          continue;
        }
        seenHubSpotIds.add(row.id);
        dedupedToUpdate.push(row);
      }
      const upd = await batchUpdateContacts(dedupedToUpdate, resolveExtras);
      success.push(...upd.success);
      rowErrors.push(...upd.rowErrors);
    }
    onAfterChunk?.(chunk.length);
  }
  return { success, rowErrors };
}

export async function batchUpdateContacts(
  rows: Array<{ id: string; contact: EnrichedContact }>,
  resolveExtras: (c: EnrichedContact) => HubSpotCompanyPushExtras | undefined,
  onAfterChunk?: (size: number) => void,
): Promise<{ success: BatchContactRowOk[]; rowErrors: BatchContactRowError[] }> {
  const success: BatchContactRowOk[] = [];
  const rowErrors: BatchContactRowError[] = [];
  if (rows.length === 0) return { success, rowErrors };

  for (let c = 0; c < rows.length; c += HUBSPOT_BATCH_SIZE) {
    await delayBatchCooldown(c);
    const chunk = rows.slice(c, c + HUBSPOT_BATCH_SIZE);
    const res = await hubspotFetch("/crm/v3/objects/contacts/batch/update", {
      method: "POST",
      body: JSON.stringify({
        inputs: chunk.map((row) => ({
          id: row.id,
          properties: contactProperties(row.contact, resolveExtras(row.contact), row.contact.existingData ?? {}),
        })),
      }),
    });
    if (!res.ok) {
      const errText = await readHubSpotError(res);
      for (const row of chunk) {
        rowErrors.push({ rowId: row.contact.id, error: errText });
      }
      onAfterChunk?.(chunk.length);
      continue;
    }
    const body = (await res.json()) as HubspotBatchCrmResponse;
    for (let j = 0; j < chunk.length; j++) {
      const r = body.results?.[j];
      const outId = r?.id != null ? String(r.id) : null;
      const comp = chunk[j]!.contact;
      if (outId) {
        success.push({ id: outId, resolvedEmail: comp.resolvedEmail, rowId: comp.id });
      } else {
        rowErrors.push({
          rowId: comp.id,
          error: errorMessageForBatchIndex(
            body,
            j,
            "HubSpot batch update returned no id for this row.",
          ),
        });
      }
    }
    onAfterChunk?.(chunk.length);
  }
  return { success, rowErrors };
}

/**
 * Writes HubSpot contact-to-company associations in batches of 100.
 * Uses association type 279 (standard primary contact-company link).
 */
export async function batchAssociateContactsToCompanies(
  associations: Array<{ contactHubSpotId: string; companyHubSpotId: string }>,
): Promise<{ associated: number; errors: Array<{ contactHubSpotId: string; error: string }> }> {
  let associated = 0;
  const errors: Array<{ contactHubSpotId: string; error: string }> = [];
  if (associations.length === 0) return { associated, errors };

  for (let c = 0; c < associations.length; c += HUBSPOT_BATCH_SIZE) {
    await delayBatchCooldown(c);
    const chunk = associations.slice(c, c + HUBSPOT_BATCH_SIZE);
    const res = await hubspotFetch("/crm/v4/associations/contacts/companies/batch/create", {
      method: "PUT",
      body: JSON.stringify({
        inputs: chunk.map(({ contactHubSpotId, companyHubSpotId }) => ({
          from: { id: contactHubSpotId },
          to: { id: companyHubSpotId },
          types: [
            {
              associationCategory: "HUBSPOT_DEFINED",
              associationTypeId: 279,
            },
          ],
        })),
      }),
    });

    if (!res.ok) {
      const errText = await readHubSpotError(res);
      for (const { contactHubSpotId } of chunk) {
        errors.push({ contactHubSpotId, error: errText });
      }
      continue;
    }
    associated += chunk.length;
  }

  return { associated, errors };
}

export async function createContact(
  contact: EnrichedContact,
  extras?: HubSpotCompanyPushExtras,
): Promise<string> {
  const res = await hubspotFetch("/crm/v3/objects/contacts", {
    method: "POST",
    body: JSON.stringify({
      properties: contactProperties(contact, extras),
    }),
  });

  if (!res.ok) {
    throw new Error(await readHubSpotError(res));
  }

  const json = (await res.json()) as { id: string };
  return String(json.id);
}

export async function updateContact(
  id: string,
  contact: EnrichedContact,
  extras?: HubSpotCompanyPushExtras,
): Promise<string> {
  const res = await hubspotFetch(
    `/crm/v3/objects/contacts/${encodeURIComponent(id)}?properties=firstname,lastname,email,jobtitle,company,ds_liprofile,state,phone,lead_source__deal_source,lead_source_description,hs_content_membership_notes,job_level,job_function,numemployees,industry,website,hs_additional_emails`,
  );

  if (!res.ok) {
    throw new Error(await readHubSpotError(res));
  }

  const json = (await res.json()) as { properties?: Record<string, string | null> };
  const ex = json.properties ?? {};

  const updates: Record<string, string> = {};

  if (isEmpty(ex.firstname)) {
    updates.firstname = contact.firstName?.trim() ?? "";
  }
  if (isEmpty(ex.lastname)) {
    updates.lastname = contact.lastName?.trim() ?? "";
  }
  if (isEmpty(ex.email)) {
    updates.email = contact.resolvedEmail?.trim() ?? "";
  }
  if (isEmpty(ex.jobtitle)) {
    updates.jobtitle = contact.title?.trim() ?? "";
  }
  if (isEmpty(ex.company)) {
    updates.company = contact.resolvedCompany?.trim() ?? "";
  }
  if (isEmpty(ex.ds_liprofile)) {
    updates.ds_liprofile = contact.linkedinUrl?.trim() ?? "";
  }
  if (isEmpty(ex.state)) {
    updates.state = contact.location?.trim() ?? "";
  }
  if (isEmpty(ex.phone) && contact.phone?.trim()) {
    updates.phone = contact.phone.trim();
  }
  if (extras) {
    if (extras.leadSource?.trim() && isEmpty(ex.lead_source__deal_source)) {
      // WRITE RULE: fill-empty-only — Lead Source is operator-set and must never be overwritten by enrichment.
      updates.lead_source__deal_source = extras.leadSource.trim();
    }
    if (extras.leadSourceDescription?.trim() && isEmpty(ex.lead_source_description)) {
      updates.lead_source_description = extras.leadSourceDescription.trim();
    }
    const noteCandidate =
      extras.notes?.trim() ||
      contact.membershipNotes?.trim() ||
      contact.notes?.trim();
    if (noteCandidate && isEmpty(ex.hs_content_membership_notes)) {
      updates.hs_content_membership_notes = noteCandidate;
    }
  } else {
    if (contact.leadSource?.trim() && isEmpty(ex.lead_source__deal_source)) {
      // WRITE RULE: fill-empty-only — Lead Source is operator-set and must never be overwritten by enrichment.
      updates.lead_source__deal_source = contact.leadSource.trim();
    }
    if (contact.leadSourceDescription?.trim() && isEmpty(ex.lead_source_description)) {
      updates.lead_source_description = contact.leadSourceDescription.trim();
    }
    const noteCandidate = contact.membershipNotes?.trim() || contact.notes?.trim();
    if (noteCandidate && isEmpty(ex.hs_content_membership_notes)) {
      updates.hs_content_membership_notes = noteCandidate;
    }
  }

  if (contact.ziManagementLevel?.trim() && isEmpty(ex.job_level)) {
    updates.job_level = contact.ziManagementLevel.trim();
  }
  if (contact.ziJobFunction?.trim() && isEmpty(ex.job_function)) {
    updates.job_function = contact.ziJobFunction.trim();
  }
  if (contact.ziCompanyPrimaryIndustry?.trim() && isEmpty(ex.industry)) {
    const industryEnum = toHubSpotIndustry(contact.ziCompanyPrimaryIndustry);
    if (industryEnum) updates.industry = industryEnum;
  }
  if (
    contact.ziCompanyEmployeeCount?.trim() &&
    isEmpty(ex.numemployees)
  ) {
    updates.numemployees = contact.ziCompanyEmployeeCount.trim();
  }
  if (
    isEmpty(contact.companyDomain) &&
    contact.ziCompanyWebsite?.trim() &&
    isEmpty(ex.website)
  ) {
    updates.website = contact.ziCompanyWebsite.trim();
  }
  const pushPersonal = contact.personalEmail?.trim() ?? "";
  const pushResolved = contact.resolvedEmail?.trim() ?? "";
  const shouldWritePersonalAdditional =
    Boolean(pushPersonal) &&
    Boolean(pushResolved) &&
    pushPersonal.toLowerCase() !== pushResolved.toLowerCase();

  if (shouldWritePersonalAdditional) {
    const merged = mergeHsAdditionalEmailsWithPersonal(ex.hs_additional_emails, pushPersonal);
    if (!additionalEmailTokenSetsEqual(merged, String(ex.hs_additional_emails ?? ""))) {
      updates.hs_additional_emails = merged;
    }
  }

  if (Object.keys(updates).length === 0) {
    return id;
  }

  const patchRes = await hubspotFetch(`/crm/v3/objects/contacts/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({
      properties: updates,
    }),
  });

  if (!patchRes.ok) {
    throw new Error(await readHubSpotError(patchRes));
  }

  const out = (await patchRes.json()) as { id: string };
  return String(out.id);
}
