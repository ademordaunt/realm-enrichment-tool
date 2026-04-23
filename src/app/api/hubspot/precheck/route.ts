import { batchCheckCompaniesInHubSpot, normalizeDomain } from "@/lib/hubspot/companies";
import { batchCheckContactsInHubSpot } from "@/lib/hubspot/contacts";
import type { EnrichedCompany, EnrichedContact } from "@/lib/utils/types";

export const maxDuration = 30;

type PrecheckResult = {
  id: string;
  hubspotId: string | null;
  hubspotComplete: boolean;
  existingData: Record<string, string>;
};

const EMPTY_COMPANY_EXISTING_DATA: Record<string, string> = {
  domain: "",
  state: "",
  numberofemployees: "",
  linkedin_company_page: "",
  industry: "",
  description: "",
  city: "",
};

const EMPTY_CONTACT_EXISTING_DATA: Record<string, string> = {
  email: "",
  jobtitle: "",
  company: "",
  ds_liprofile: "",
  state: "",
  phone: "",
  job_level: "",
  job_function: "",
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isNonEmpty(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export async function POST(request: Request): Promise<Response> {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Bad request", detail: "Invalid JSON body." }, { status: 400 });
    }

    if (!isObject(body)) {
      return Response.json({ error: "Bad request", detail: "Expected JSON object." }, { status: 400 });
    }

    const { listType, rows } = body;
    if ((listType !== "companies" && listType !== "contacts") || !Array.isArray(rows)) {
      return Response.json(
        { error: "Bad request", detail: 'Expected `listType` and `rows`.' },
        { status: 400 },
      );
    }

    if (listType === "companies") {
      const companyRows = rows as EnrichedCompany[];
      const domains = companyRows.map((row) => normalizeDomain(String(row.domain ?? "")));
      const lookup = await batchCheckCompaniesInHubSpot(domains);

      const results: PrecheckResult[] = companyRows.map((row) => {
        const domain = normalizeDomain(String(row.domain ?? ""));
        const match = domain ? lookup.get(domain) : undefined;
        const existingData = { ...EMPTY_COMPANY_EXISTING_DATA, ...(match?.existingData ?? {}) };
        const hubspotComplete =
          isNonEmpty(existingData.domain) &&
          isNonEmpty(existingData.state) &&
          isNonEmpty(existingData.numberofemployees) &&
          isNonEmpty(existingData.linkedin_company_page) &&
          isNonEmpty(existingData.industry);
        return {
          id: row.id,
          hubspotId: match?.hubspotId ?? null,
          hubspotComplete: Boolean(match) && hubspotComplete,
          existingData,
        };
      });

      return Response.json({ results });
    }

    const contactRows = rows as EnrichedContact[];
    const emails = contactRows.map((row) => normalizeEmail(String(row.rawEmail || row.resolvedEmail || "")));
    const lookup = await batchCheckContactsInHubSpot(emails);
    const results: PrecheckResult[] = contactRows.map((row) => {
      const email = normalizeEmail(String(row.rawEmail || row.resolvedEmail || ""));
      const match = email ? lookup.get(email) : undefined;
      const existingData = { ...EMPTY_CONTACT_EXISTING_DATA, ...(match?.existingData ?? {}) };
      const hubspotComplete =
        isNonEmpty(existingData.jobtitle) &&
        isNonEmpty(existingData.company) &&
        isNonEmpty(existingData.ds_liprofile);
      return {
        id: row.id,
        hubspotId: match?.hubspotId ?? null,
        hubspotComplete: Boolean(match) && hubspotComplete,
        existingData,
      };
    });

    return Response.json({ results });
  } catch (error) {
    return Response.json(
      {
        error: "Internal server error",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
