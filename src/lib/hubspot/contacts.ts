import type { HubSpotCompanyPushExtras } from "@/lib/hubspot/companies";
import type { EnrichedContact } from "@/lib/utils/types";
import { hubspotFetch, readHubSpotError } from "@/lib/hubspot/http";

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

function contactProperties(
  contact: EnrichedContact,
  extras?: HubSpotCompanyPushExtras,
): Record<string, string> {
  const props: Record<string, string> = {
    firstname: contact.firstName?.trim() ?? "",
    lastname: contact.lastName?.trim() ?? "",
    email: contact.resolvedEmail?.trim() ?? "",
    jobtitle: contact.title?.trim() ?? "",
    company: contact.resolvedCompany?.trim() ?? "",
    ds_liprofile: contact.linkedinUrl?.trim() ?? "",
    state: contact.location?.trim() ?? "",
  };
  const phone = contact.phone?.trim();
  if (phone) props.phone = phone;
  const ls = contact.leadSource?.trim();
  if (ls) props.lead_source__deal_source = ls;
  const lsd = contact.leadSourceDescription?.trim();
  if (lsd) props.lead_source_description = lsd;
  const n = contact.membershipNotes?.trim() || contact.notes?.trim();
  if (n) props.hs_content_membership_notes = n;
  if (contact.ziManagementLevel?.trim()) props.job_level = contact.ziManagementLevel.trim();
  if (contact.ziJobFunction?.trim()) props.job_function = contact.ziJobFunction.trim();
  if (contact.ziCompanyPrimaryIndustry?.trim()) {
    props.industry = contact.ziCompanyPrimaryIndustry.trim();
  }
  if (contact.ziCompanyEmployeeCount?.trim()) {
    props.numemployees = contact.ziCompanyEmployeeCount.trim();
  }
  if (
    isEmpty(contact.companyDomain) &&
    contact.ziCompanyWebsite?.trim()
  ) {
    props.website = contact.ziCompanyWebsite.trim();
  }
  if (extras?.leadSource?.trim()) props.lead_source__deal_source = extras.leadSource.trim();
  if (extras?.leadSourceDescription?.trim()) {
    props.lead_source_description = extras.leadSourceDescription.trim();
  }
  if (extras?.notes?.trim()) props.hs_content_membership_notes = extras.notes.trim();
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
    `/crm/v3/objects/contacts/${encodeURIComponent(id)}?properties=firstname,lastname,email,jobtitle,company,ds_liprofile,state,phone,lead_source__deal_source,lead_source_description,hs_content_membership_notes,job_level,job_function,numemployees,industry,website`,
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
    updates.industry = contact.ziCompanyPrimaryIndustry.trim();
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
