import type { EnrichedCompany } from "@/lib/utils/types";
import { hubspotFetch, readHubSpotError } from "@/lib/hubspot/http";

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

function companyProperties(company: EnrichedCompany): Record<string, string> {
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

export async function createCompany(company: EnrichedCompany): Promise<string> {
  const res = await hubspotFetch("/crm/v3/objects/companies", {
    method: "POST",
    body: JSON.stringify({
      properties: companyProperties(company),
    }),
  });

  if (!res.ok) {
    throw new Error(await readHubSpotError(res));
  }

  const json = (await res.json()) as { id: string };
  return String(json.id);
}

export async function updateCompany(id: string, company: EnrichedCompany): Promise<string> {
  const res = await hubspotFetch(`/crm/v3/objects/companies/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({
      properties: companyProperties(company),
    }),
  });

  if (!res.ok) {
    throw new Error(await readHubSpotError(res));
  }

  const json = (await res.json()) as { id: string };
  return String(json.id);
}
