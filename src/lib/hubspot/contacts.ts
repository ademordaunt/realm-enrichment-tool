import type { EnrichedContact } from "@/lib/utils/types";
import { hubspotFetch, readHubSpotError } from "@/lib/hubspot/http";

function contactProperties(contact: EnrichedContact): Record<string, string> {
  const props: Record<string, string> = {
    firstname: contact.firstName?.trim() ?? "",
    lastname: contact.lastName?.trim() ?? "",
    email: contact.resolvedEmail?.trim() ?? "",
    jobtitle: contact.title?.trim() ?? "",
    company: contact.resolvedCompany?.trim() ?? "",
    hs_linkedin_url: contact.linkedinUrl?.trim() ?? "",
    state: contact.location?.trim() ?? "",
  };
  const ls = contact.leadSource?.trim();
  if (ls) props.lead_source = ls;
  const lsd = contact.leadSourceDescription?.trim();
  if (lsd) props.lead_source_description = lsd;
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

export async function createContact(contact: EnrichedContact): Promise<string> {
  const res = await hubspotFetch("/crm/v3/objects/contacts", {
    method: "POST",
    body: JSON.stringify({
      properties: contactProperties(contact),
    }),
  });

  if (!res.ok) {
    throw new Error(await readHubSpotError(res));
  }

  const json = (await res.json()) as { id: string };
  return String(json.id);
}

export async function updateContact(id: string, contact: EnrichedContact): Promise<string> {
  const res = await hubspotFetch(`/crm/v3/objects/contacts/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({
      properties: contactProperties(contact),
    }),
  });

  if (!res.ok) {
    throw new Error(await readHubSpotError(res));
  }

  const json = (await res.json()) as { id: string };
  return String(json.id);
}
