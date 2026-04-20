import type { HubSpotCompanyPushExtras } from "@/lib/hubspot/companies";
import type { EnrichedContact } from "@/lib/utils/types";
import { hubspotFetch, readHubSpotError } from "@/lib/hubspot/http";

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
    hs_linkedin_url: contact.linkedinUrl?.trim() ?? "",
    state: contact.location?.trim() ?? "",
  };
  const phone = contact.phone?.trim();
  if (phone) props.phone = phone;
  const ls = contact.leadSource?.trim();
  if (ls) props.lead_source = ls;
  const lsd = contact.leadSourceDescription?.trim();
  if (lsd) props.lead_source_description = lsd;
  const n = contact.membershipNotes?.trim() || contact.notes?.trim();
  if (n) props.notes = n;
  if (extras?.leadSource?.trim()) props.lead_source = extras.leadSource.trim();
  if (extras?.leadSourceDescription?.trim()) {
    props.lead_source_description = extras.leadSourceDescription.trim();
  }
  if (extras?.notes?.trim()) props.notes = extras.notes.trim();
  return props;
}

export async function findExistingContact(email: string): Promise<string | null> {
  const e = email.trim().toLowerCase();
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
    `/crm/v3/objects/contacts/${encodeURIComponent(id)}?properties=firstname,lastname,email,jobtitle,company,hs_linkedin_url,state,phone,lead_source,lead_source_description,notes`,
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
  if (isEmpty(ex.hs_linkedin_url)) {
    updates.hs_linkedin_url = contact.linkedinUrl?.trim() ?? "";
  }
  if (isEmpty(ex.state)) {
    updates.state = contact.location?.trim() ?? "";
  }
  if (isEmpty(ex.phone) && contact.phone?.trim()) {
    updates.phone = contact.phone.trim();
  }
  if (extras) {
    if (extras.leadSource?.trim() && isEmpty(ex.lead_source)) {
      updates.lead_source = extras.leadSource.trim();
    }
    if (extras.leadSourceDescription?.trim() && isEmpty(ex.lead_source_description)) {
      updates.lead_source_description = extras.leadSourceDescription.trim();
    }
    const noteCandidate =
      extras.notes?.trim() ||
      contact.membershipNotes?.trim() ||
      contact.notes?.trim();
    if (noteCandidate && isEmpty(ex.notes)) {
      updates.notes = noteCandidate;
    }
  } else {
    if (contact.leadSource?.trim() && isEmpty(ex.lead_source)) {
      updates.lead_source = contact.leadSource.trim();
    }
    if (contact.leadSourceDescription?.trim() && isEmpty(ex.lead_source_description)) {
      updates.lead_source_description = contact.leadSourceDescription.trim();
    }
    const noteCandidate = contact.membershipNotes?.trim() || contact.notes?.trim();
    if (noteCandidate && isEmpty(ex.notes)) {
      updates.notes = noteCandidate;
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
