import type { EnrichedCompany } from "@/lib/utils/types";
import { hubspotFetch, readHubSpotError } from "@/lib/hubspot/http";

export type HubSpotCompanyPushExtras = {
  leadSource?: string;
  leadSourceDescription?: string;
  notes?: string;
};

function normalizeDomain(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]!;
}

function websiteFromDomain(domain: string): string {
  const d = normalizeDomain(domain);
  return d ? `https://www.${d}` : "";
}

function isEmpty(val: string | null | undefined): boolean {
  if (val == null) return true;
  return String(val).trim() === "";
}

function isEmptyOrZeroEmployees(val: string | null | undefined): boolean {
  if (val == null) return true;
  const s = String(val).trim();
  return s === "" || s === "0";
}

function mergeLeadExtras(props: Record<string, string>, extras?: HubSpotCompanyPushExtras) {
  if (!extras) return;
  if (extras.leadSource?.trim()) props.lead_source = extras.leadSource.trim();
  if (extras.leadSourceDescription?.trim()) {
    props.lead_source_description = extras.leadSourceDescription.trim();
  }
  if (extras.notes?.trim()) props.notes = extras.notes.trim();
}

function companyProperties(
  company: EnrichedCompany,
  extras?: HubSpotCompanyPushExtras,
): Record<string, string> {
  const domain = normalizeDomain(company.domain);
  const props: Record<string, string> = {
    name: company.resolvedName?.trim() || company.rawInput?.trim() || "Unknown",
    domain,
    website: websiteFromDomain(company.domain),
    state: company.state?.trim() ?? "",
    linkedin_company_page: company.linkedinUrl?.trim() ?? "",
  };
  if (company.numberOfEmployees != null && !Number.isNaN(company.numberOfEmployees)) {
    props.numberofemployees = String(company.numberOfEmployees);
  }
  if (company.revenue != null && !Number.isNaN(Number(company.revenue))) {
    props.annualrevenue = String(company.revenue * 1000);
  }
  if (company.industry?.trim()) {
    props.industry = company.industry.trim();
  }
  if (company.description?.trim()) {
    props.description = company.description.trim();
  }
  if (company.city?.trim()) {
    props.city = company.city.trim();
  }
  mergeLeadExtras(props, extras);
  return props;
}

export async function findExistingCompany(domain: string): Promise<string | null> {
  const d = normalizeDomain(domain);
  if (!d) return null;

  const res = await hubspotFetch("/crm/v3/objects/companies/search", {
    method: "POST",
    body: JSON.stringify({
      filterGroups: [
        {
          filters: [
            {
              propertyName: "domain",
              operator: "EQ",
              value: d,
            },
          ],
        },
      ],
      limit: 1,
      properties: ["domain"],
    }),
  });

  if (!res.ok) {
    throw new Error(await readHubSpotError(res));
  }

  const json = (await res.json()) as { results?: { id: string }[] };
  const id = json.results?.[0]?.id;
  return id ?? null;
}

export async function createCompany(
  company: EnrichedCompany,
  extras?: HubSpotCompanyPushExtras,
): Promise<string> {
  const res = await hubspotFetch("/crm/v3/objects/companies", {
    method: "POST",
    body: JSON.stringify({
      properties: companyProperties(company, extras),
    }),
  });

  if (!res.ok) {
    throw new Error(await readHubSpotError(res));
  }

  const json = (await res.json()) as { id: string };
  return String(json.id);
}

export async function updateCompany(
  id: string,
  company: EnrichedCompany,
  extras?: HubSpotCompanyPushExtras,
): Promise<string> {
  const res = await hubspotFetch(
    `/crm/v3/objects/companies/${encodeURIComponent(id)}?properties=name,domain,website,state,numberofemployees,linkedin_company_page,lead_source,lead_source_description,notes,annualrevenue,industry,description,city`,
  );

  if (!res.ok) {
    throw new Error(await readHubSpotError(res));
  }

  const json = (await res.json()) as { properties?: Record<string, string | null> };
  const ex = json.properties ?? {};

  const updates: Record<string, string> = {};

  if (isEmpty(ex.name)) {
    updates.name = company.resolvedName?.trim() || company.rawInput?.trim() || "Unknown";
  }
  if (isEmpty(ex.domain)) {
    updates.domain = normalizeDomain(company.domain);
  }
  if (isEmpty(ex.website)) {
    updates.website = websiteFromDomain(company.domain);
  }
  if (isEmpty(ex.state)) {
    updates.state = company.state?.trim() ?? "";
  }
  if (isEmptyOrZeroEmployees(ex.numberofemployees)) {
    if (company.numberOfEmployees != null && !Number.isNaN(company.numberOfEmployees)) {
      updates.numberofemployees = String(company.numberOfEmployees);
    }
  }
  if (isEmpty(ex.linkedin_company_page)) {
    updates.linkedin_company_page = company.linkedinUrl?.trim() ?? "";
  }
  if (isEmpty(ex.annualrevenue)) {
    if (company.revenue != null && !Number.isNaN(Number(company.revenue))) {
      updates.annualrevenue = String(company.revenue * 1000);
    }
  }
  if (isEmpty(ex.industry) && company.industry?.trim()) {
    updates.industry = company.industry.trim();
  }
  if (isEmpty(ex.description) && company.description?.trim()) {
    updates.description = company.description.trim();
  }
  if (isEmpty(ex.city) && company.city?.trim()) {
    updates.city = company.city.trim();
  }
  if (extras) {
    if (extras.leadSource?.trim() && isEmpty(ex.lead_source)) {
      updates.lead_source = extras.leadSource.trim();
    }
    if (extras.leadSourceDescription?.trim() && isEmpty(ex.lead_source_description)) {
      updates.lead_source_description = extras.leadSourceDescription.trim();
    }
    if (extras.notes?.trim() && isEmpty(ex.notes)) {
      updates.notes = extras.notes.trim();
    }
  }

  if (Object.keys(updates).length === 0) {
    return id;
  }

  const patchRes = await hubspotFetch(`/crm/v3/objects/companies/${encodeURIComponent(id)}`, {
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
