import type { EnrichedCompany } from "@/lib/utils/types";
import { hubspotFetch, readHubSpotError } from "@/lib/hubspot/http";

export type HubSpotCompanyPushExtras = {
  leadSource?: string;
  leadSourceDescription?: string;
  notes?: string;
};

export function normalizeDomain(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]!;
}

type HubSpotCompanyPrecheckResult = {
  hubspotId: string;
  existingData: Record<string, string>;
};

const COMPANY_PRECHECK_PROPERTIES = [
  "domain",
  "state",
  "numberofemployees",
  "linkedin_company_page",
  "industry",
  "description",
  "city",
] as const;

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

export async function batchCheckCompaniesInHubSpot(
  domains: string[],
): Promise<Map<string, HubSpotCompanyPrecheckResult>> {
  const normalizedDomains = Array.from(
    new Set(
      domains
        .map((domain) => normalizeDomain(domain))
        .filter((domain) => Boolean(domain)),
    ),
  );

  const results = new Map<string, HubSpotCompanyPrecheckResult>();
  if (normalizedDomains.length === 0) return results;

  for (const domainBatch of chunkValues(normalizedDomains, 100)) {
    let after: string | undefined;
    do {
      const searchBody = {
        filterGroups: [
          {
            filters: [
              {
                propertyName: "domain",
                operator: "IN",
                values: domainBatch,
              },
            ],
          },
        ],
        limit: 200,
        properties: [...COMPANY_PRECHECK_PROPERTIES],
        sorts: [{ propertyName: "hs_lastmodifieddate", direction: "DESCENDING" }],
        ...(after ? { after } : {}),
      };
      const res = await hubspotSearchWithBackoff(
        "/crm/v3/objects/companies/search",
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
        const normalized = normalizeDomain(String(props.domain ?? ""));
        if (!normalized || results.has(normalized)) continue;
        const existingData: Record<string, string> = {};
        for (const key of COMPANY_PRECHECK_PROPERTIES) {
          existingData[key] = String(props[key] ?? "");
        }
        results.set(normalized, { hubspotId: String(row.id), existingData });
      }
      after = json.paging?.next?.after;
    } while (after);
  }

  return results;
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

const HUBSPOT_BATCH_SIZE = 100;
const HUBSPOT_BATCH_COOLDOWN_MS = 200;

function delayBatchCooldown(chunkIndex: number): Promise<void> {
  if (chunkIndex <= 0) return Promise.resolve();
  return new Promise((r) => setTimeout(r, HUBSPOT_BATCH_COOLDOWN_MS));
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

function parseHubSpotDuplicateExistingId(message: string): string | null {
  const m = message.match(
    /\b(?:Contact|Company) already exists\.?\s*Existing ID:\s*(\d+)\b/i,
  );
  return m?.[1]?.trim() ?? null;
}

/**
 * All domains in HubSpot (normalized) → record id, queried in 100-domain chunks with 200ms gaps.
 * Reuses the same /search IN pattern as precheck; safe for 1k+ domains.
 */
export async function batchFindCompaniesByDomain(domains: string[]): Promise<Map<string, string>> {
  const normalized = Array.from(
    new Set(
      domains
        .map((d) => normalizeDomain(d))
        .filter((d) => Boolean(d)),
    ),
  );
  const out = new Map<string, string>();
  for (let i = 0; i < normalized.length; i += HUBSPOT_BATCH_SIZE) {
    await delayBatchCooldown(i > 0 ? 1 : 0);
    const part = await batchCheckCompaniesInHubSpot(normalized.slice(i, i + HUBSPOT_BATCH_SIZE));
    for (const [d, v] of part) {
      out.set(d, v.hubspotId);
    }
  }
  return out;
}

export type BatchCompanyRowOk = { id: string; rawInput: string; rowId: string };
export type BatchCompanyRowError = { rowId: string; error: string };

/**
 * Up to 100 companies per call; 200ms between each chunk. Full `companyProperties` per row (overwrites on update).
 */
export async function batchCreateCompanies(
  companies: EnrichedCompany[],
  extras?: HubSpotCompanyPushExtras,
  onAfterChunk?: (size: number) => void,
): Promise<{ success: BatchCompanyRowOk[]; rowErrors: BatchCompanyRowError[] }> {
  const success: BatchCompanyRowOk[] = [];
  const rowErrors: BatchCompanyRowError[] = [];
  if (companies.length === 0) return { success, rowErrors };

  for (let c = 0; c < companies.length; c += HUBSPOT_BATCH_SIZE) {
    await delayBatchCooldown(c);
    const chunk = companies.slice(c, c + HUBSPOT_BATCH_SIZE);
    const res = await hubspotFetch("/crm/v3/objects/companies/batch/create", {
      method: "POST",
      body: JSON.stringify({
        inputs: chunk.map((row) => ({ properties: companyProperties(row, extras) })),
      }),
    });
    if (!res.ok) {
      const errText = await readHubSpotError(res);
      for (const row of chunk) {
        rowErrors.push({ rowId: row.id, error: errText });
      }
      onAfterChunk?.(chunk.length);
      continue;
    }
    const body = (await res.json()) as HubspotBatchCrmResponse;
    const toUpdate: Array<{ id: string; company: EnrichedCompany }> = [];
    for (let j = 0; j < chunk.length; j++) {
      const r = body.results?.[j];
      const id = r?.id != null ? String(r.id) : null;
      if (id) {
        const row = chunk[j]!;
        success.push({ id, rawInput: row.rawInput, rowId: row.id });
      } else {
        const row = chunk[j]!;
        const msg = errorMessageForBatchIndex(
          body,
          j,
          "HubSpot batch create returned no id for this row.",
        );
        const existingId = parseHubSpotDuplicateExistingId(msg);
        if (existingId) {
          toUpdate.push({ id: existingId, company: row });
        } else {
          rowErrors.push({ rowId: row.id, error: msg });
        }
      }
    }
    if (toUpdate.length > 0) {
      const upd = await batchUpdateCompanies(toUpdate, extras);
      success.push(...upd.success);
      rowErrors.push(...upd.rowErrors);
    }
    onAfterChunk?.(chunk.length);
  }
  return { success, rowErrors };
}

/**
 * Up to 100 per call; 200ms between chunks. Full `companyProperties` for each (no GET before PATCH).
 */
export async function batchUpdateCompanies(
  rows: Array<{ id: string; company: EnrichedCompany }>,
  extras?: HubSpotCompanyPushExtras,
  onAfterChunk?: (size: number) => void,
): Promise<{ success: BatchCompanyRowOk[]; rowErrors: BatchCompanyRowError[] }> {
  const success: BatchCompanyRowOk[] = [];
  const rowErrors: BatchCompanyRowError[] = [];
  if (rows.length === 0) return { success, rowErrors };

  for (let c = 0; c < rows.length; c += HUBSPOT_BATCH_SIZE) {
    await delayBatchCooldown(c);
    const chunk = rows.slice(c, c + HUBSPOT_BATCH_SIZE);
    const res = await hubspotFetch("/crm/v3/objects/companies/batch/update", {
      method: "POST",
      body: JSON.stringify({
        inputs: chunk.map((row) => ({
          id: row.id,
          properties: companyProperties(row.company, extras),
        })),
      }),
    });
    if (!res.ok) {
      const errText = await readHubSpotError(res);
      for (const row of chunk) {
        rowErrors.push({ rowId: row.company.id, error: errText });
      }
      onAfterChunk?.(chunk.length);
      continue;
    }
    const body = (await res.json()) as HubspotBatchCrmResponse;
    for (let j = 0; j < chunk.length; j++) {
      const r = body.results?.[j];
      const outId = r?.id != null ? String(r.id) : null;
      const comp = chunk[j]!.company;
      if (outId) {
        success.push({ id: outId, rawInput: comp.rawInput, rowId: comp.id });
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
