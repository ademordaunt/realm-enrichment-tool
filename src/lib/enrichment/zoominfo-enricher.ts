import {
  getCachedCompany,
  setCachedCompany,
  setCachedContact,
} from "@/lib/cache/enrichment-cache";
import { isPersonalEmail } from "@/lib/utils/contacts";
import type { EnrichedCompany, EnrichedContact, LinkedInSource } from "@/lib/utils/types";
import { getZoomInfoToken, invalidateZoomInfoToken } from "@/lib/zoominfo/auth";

/** ZoomInfo partial plus pre-merge confidence (never persisted on EnrichedCompany). */
export type ZoomInfoCompanyEnrichmentResult = Partial<EnrichedCompany> & {
  originalConfidence: EnrichedCompany["confidenceScore"];
  cachedHit?: boolean;
};

/** ZoomInfo partial plus pre-merge confidence (never persisted on EnrichedContact). */
export type ZoomInfoContactEnrichmentResult = Partial<EnrichedContact> & {
  originalConfidence: EnrichedContact["confidenceScore"];
};

const SEARCH_COMPANY_URL = "https://api.zoominfo.com/gtm/data/v1/companies/search";
const ENRICH_COMPANY_URL = "https://api.zoominfo.com/gtm/data/v1/companies/enrich";
const SEARCH_CONTACT_URL = "https://api.zoominfo.com/gtm/data/v1/contacts/search";
const ENRICH_CONTACT_URL = "https://api.zoominfo.com/gtm/data/v1/contacts/enrich";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeDomain(website: string): string {
  let w = website.trim().toLowerCase();
  w = w.replace(/^https?:\/\//, "");
  w = w.replace(/^www\./, "");
  return w.split("/")[0].split("?")[0];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isUrlObject(u: unknown): u is { url: string } {
  return (
    typeof u === "object" &&
    u !== null &&
    "url" in u &&
    typeof (u as Record<string, unknown>).url === "string"
  );
}

/** Extract first company hit from ZoomInfo search (supports common response shapes). */
function firstCompanySearchHit(json: unknown): {
  website?: string;
  name?: string;
  matchScore?: number;
} | null {
  if (!isRecord(json)) return null;
  const data = json.data;
  if (Array.isArray(data) && data.length > 0) {
    const first = data[0];
    if (isRecord(first)) {
      const attrs = first.attributes;
      if (isRecord(attrs)) {
        return {
          website: typeof attrs.website === "string" ? attrs.website : undefined,
          name: typeof attrs.name === "string" ? attrs.name : undefined,
          matchScore:
            typeof attrs.matchScore === "number" ? attrs.matchScore : undefined,
        };
      }
    }
  }
  const results = json.results ?? json.searchResults;
  if (Array.isArray(results) && results[0] && isRecord(results[0])) {
    const r = results[0] as Record<string, unknown>;
    return {
      website: typeof r.website === "string" ? r.website : undefined,
      name: typeof r.name === "string" ? r.name : undefined,
    };
  }
  return null;
}

async function zoomInfoFetch(
  url: string,
  init: RequestInit,
  allowRetry: boolean,
): Promise<Response> {
  if (typeof init.body === "string") {
    console.log(
      "[ZoomInfo] outgoing request body length (chars):",
      init.body.length,
    );
  } else if (init.body != null) {
    console.log("[ZoomInfo] outgoing request body: non-string body");
  }
  let token = await getZoomInfoToken();
  let res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/vnd.api+json",
      Accept: "application/vnd.api+json",
      Authorization: `Bearer ${token}`,
      ...init.headers,
    },
  });

  if (res.status === 401 && allowRetry) {
    invalidateZoomInfoToken();
    token = await getZoomInfoToken();
    res = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/vnd.api+json",
        Accept: "application/vnd.api+json",
        Authorization: `Bearer ${token}`,
        ...init.headers,
      },
    });
  }

  return res;
}

function hasCompanySearchMatch(
  searchJson: unknown,
  hit: { website?: string; matchScore?: number } | null,
): boolean {
  if (isRecord(searchJson) && Array.isArray(searchJson.data) && searchJson.data.length > 0) {
    return true;
  }
  if (!hit) return false;
  if (hit.matchScore !== undefined && hit.matchScore < 0.5) return false;
  return Boolean(hit.website?.trim());
}

function linkedInUrlFromSocialMediaUrls(attrs: Record<string, unknown>): string | null {
  const social = attrs.socialMediaUrls;
  if (!Array.isArray(social)) return null;
  for (const s of social) {
    if (isUrlObject(s) && s.url.includes("linkedin.com")) {
      return s.url.trim();
    }
  }
  return null;
}

async function enrichWithRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status === 429 && i < retries - 1) {
        await sleep(2000 * (i + 1));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Max retries exceeded");
}

/**
 * Search then enrich company. Returns partial ZoomInfo fields plus `originalConfidence`
 * for merge mode; merger applies gap-fill vs ZoomInfo-wins.
 */
export async function enrichCompanyWithZoomInfo(
  company: EnrichedCompany,
): Promise<ZoomInfoCompanyEnrichmentResult> {
  const ziMeta = (
    fields: Partial<EnrichedCompany>,
    options?: { cachedHit?: boolean },
  ): ZoomInfoCompanyEnrichmentResult => ({
    ...fields,
    originalConfidence: company.confidenceScore,
    ...(options?.cachedHit ? { cachedHit: true } : {}),
  });

  const cacheKeyName = company.resolvedName ?? company.rawInput;
  const cached = await getCachedCompany(cacheKeyName);
  // Same KV key as AI cache — only skip ZoomInfo when this row was ZoomInfo-merged before.
  if (cached?.enrichedByZoomInfo) {
    // Field names must match EnrichedCompany type exactly — only fill gaps vs current AI row.
    const out: Partial<EnrichedCompany> = {};
    if (!company.linkedinUrl?.trim() && cached.linkedinUrl?.trim()) {
      out.linkedinUrl = cached.linkedinUrl.trim();
      out.linkedinSource = (cached.linkedinSource?.trim() ||
        "zoominfo") as LinkedInSource;
    }
    if (
      company.numberOfEmployees == null &&
      cached.numberOfEmployees != null &&
      !Number.isNaN(Number(cached.numberOfEmployees))
    ) {
      out.numberOfEmployees = Number(cached.numberOfEmployees);
    }
    if (!company.state?.trim() && cached.state?.trim()) {
      out.state = cached.state.trim();
    }
    if (!company.domain?.trim() && cached.domain?.trim()) {
      out.domain = cached.domain.trim();
    }
    if (!company.resolvedName?.trim() && cached.resolvedName?.trim()) {
      out.resolvedName = cached.resolvedName.trim();
    }
    if (
      company.revenue == null &&
      cached.revenue != null &&
      !Number.isNaN(Number(cached.revenue))
    ) {
      out.revenue = Number(cached.revenue);
    }
    if (!company.industry?.trim() && cached.industry?.trim()) {
      out.industry = cached.industry.trim();
    }
    if (!company.description?.trim() && cached.description?.trim()) {
      out.description = cached.description.trim();
    }
    if (!company.city?.trim() && cached.city?.trim()) {
      out.city = cached.city.trim();
    }
    out.enrichedByZoomInfo = true;
    return ziMeta(out, { cachedHit: true });
  }

  const searchBody = {
    data: {
      type: "CompanySearch",
      attributes: {
        companyName: company.rawInput,
        ...(company.domain ? { companyWebsite: company.domain } : {}),
      },
    },
  };

  let res = await zoomInfoFetch(
    SEARCH_COMPANY_URL,
    { method: "POST", body: JSON.stringify(searchBody) },
    true,
  );
  console.log("[ZoomInfo] search response status:", res.status);
  if (res.status === 400) {
    const errorBody = await res.text();
    console.log(
      "[ZoomInfo] company search 400 | response chars:",
      errorBody.length,
    );
    return ziMeta({});
  }
  if (!res.ok) {
    return ziMeta({});
  }
  const searchJson: unknown = await res.json();
  const searchData = isRecord(searchJson) ? searchJson.data : undefined;
  const searchResults = Array.isArray(searchData) ? searchData : [];
  const firstResource = isRecord(searchResults[0]) ? searchResults[0] : null;
  const rawCompanyId = firstResource?.id;
  const companyId =
    typeof rawCompanyId === "string"
      ? rawCompanyId
      : typeof rawCompanyId === "number"
        ? String(rawCompanyId)
        : null;
  console.log(
    "[ZoomInfo Search] company | row id:",
    company.id,
    "| matchedZoomId:",
    companyId ?? "none",
  );

  console.log(
    "[ZoomInfo] company search | result count:",
    searchResults.length,
    "| hasResource:",
    searchResults.length > 0,
  );
  const hit = firstCompanySearchHit(searchJson);
  if (!hasCompanySearchMatch(searchJson, hit)) {
    return ziMeta({});
  }

  if (!companyId) {
    return ziMeta({});
  }

  const enrichBody = {
    data: {
      type: "CompanyEnrich",
      attributes: {
        matchCompanyInput: [{ companyId }],
        outputFields: [
          "id",
          "name",
          "website",
          "socialMediaUrls",
          "employeeCount",
          "state",
          "revenue",
          "industries",
          "description",
          "city",
        ],
      },
    },
  };

  res = await zoomInfoFetch(
    ENRICH_COMPANY_URL,
    { method: "POST", body: JSON.stringify(enrichBody) },
    true,
  );
  console.log("[ZoomInfo] enrich response status:", res.status);
  if (res.status === 400) {
    const errorBody = await res.text();
    console.log(
      "[ZoomInfo] company enrich 400 | response chars:",
      errorBody.length,
    );
    return ziMeta({});
  }
  if (!res.ok) {
    return ziMeta({});
  }
  const enrichJson: unknown = await res.json();
  const enrichDataRoot = isRecord(enrichJson) ? enrichJson.data : undefined;
  const enrichItems = Array.isArray(enrichDataRoot)
    ? enrichDataRoot
    : enrichDataRoot && isRecord(enrichDataRoot)
      ? [enrichDataRoot]
      : [];
  const firstEnrich = isRecord(enrichItems[0]) ? enrichItems[0] : null;
  const attrs =
    firstEnrich && isRecord(firstEnrich.attributes) ? firstEnrich.attributes : {};

  const linkedInUrl = linkedInUrlFromSocialMediaUrls(attrs);
  const employeeCountRaw = attrs.employeeCount;
  const employeeCount =
    employeeCountRaw != null && !Number.isNaN(Number(employeeCountRaw))
      ? Number(employeeCountRaw)
      : null;
  const state = typeof attrs.state === "string" ? attrs.state.trim() : null;

  const revenueRaw = attrs.revenue;
  const revenue =
    revenueRaw != null && !Number.isNaN(Number(revenueRaw)) ? Number(revenueRaw) : null; // thousands

  const industries = attrs.industries;
  let industry: string | null = null;
  if (Array.isArray(industries) && industries.length > 0) {
    const first = industries[0];
    if (isRecord(first) && typeof first.name === "string") {
      const n = first.name.trim();
      industry = n || null;
    }
  }

  const description =
    typeof attrs.description === "string" ? attrs.description.trim() || null : null;
  const city = typeof attrs.city === "string" ? attrs.city.trim() || null : null;

  console.log("[ZoomInfo Enrich] company | row id:", company.id, {
    found: Boolean(attrs.id ?? firstEnrich?.id),
    linkedInFound: Boolean(linkedInUrl),
    employees: employeeCount,
    hasState: Boolean(state),
    revenue,
    hasIndustry: Boolean(industry),
    hasDescription: Boolean(description),
    hasCity: Boolean(city),
  });

  if (!attrs.id && !firstEnrich?.id) {
    return ziMeta({});
  }

  // Field names must match EnrichedCompany type exactly
  const out: Partial<EnrichedCompany> = {};
  if (linkedInUrl) {
    out.linkedinUrl = linkedInUrl;
    out.linkedinSource = "zoominfo" as LinkedInSource;
  }
  if (employeeCount != null) {
    out.numberOfEmployees = employeeCount;
  }
  if (state) {
    out.state = state;
  }
  if (typeof attrs.website === "string" && attrs.website.trim()) {
    out.domain = normalizeDomain(attrs.website);
  }
  if (typeof attrs.name === "string" && attrs.name.trim()) {
    out.resolvedName = attrs.name.trim();
  }
  if (revenue != null) {
    out.revenue = revenue;
  }
  if (industry) {
    out.industry = industry;
  }
  if (description) {
    out.description = description;
  }
  if (city) {
    out.city = city;
  }
  out.enrichedByZoomInfo = true;

  const mergedFull: EnrichedCompany = {
    ...company,
    ...out,
    confidenceScore: "high",
    enrichedByZoomInfo: true,
  };
  await setCachedCompany(cacheKeyName, mergedFull);

  return ziMeta(out);
}

export async function enrichCompaniesWithZoomInfo(
  companies: EnrichedCompany[],
): Promise<Map<string, ZoomInfoCompanyEnrichmentResult>> {
  const out = new Map<string, ZoomInfoCompanyEnrichmentResult>();
  if (companies.length === 0) return out;

  const cacheKeyById = new Map<string, string>();
  const companyIdToRowId = new Map<string, string>();
  const needsSearch: EnrichedCompany[] = [];
  const ziMetaFor = (
    row: EnrichedCompany,
    fields: Partial<EnrichedCompany>,
    options?: { cachedHit?: boolean },
  ): ZoomInfoCompanyEnrichmentResult => ({
    ...fields,
    originalConfidence: row.confidenceScore,
    ...(options?.cachedHit ? { cachedHit: true } : {}),
  });

  for (const company of companies) {
    const cacheKeyName = company.resolvedName ?? company.rawInput;
    cacheKeyById.set(company.id, cacheKeyName);
    const cached = await getCachedCompany(cacheKeyName);
    if (cached?.enrichedByZoomInfo) {
      const partial: Partial<EnrichedCompany> = {};
      if (!company.linkedinUrl?.trim() && cached.linkedinUrl?.trim()) {
        partial.linkedinUrl = cached.linkedinUrl.trim();
        partial.linkedinSource = (cached.linkedinSource?.trim() ||
          "zoominfo") as LinkedInSource;
      }
      if (
        company.numberOfEmployees == null &&
        cached.numberOfEmployees != null &&
        !Number.isNaN(Number(cached.numberOfEmployees))
      ) {
        partial.numberOfEmployees = Number(cached.numberOfEmployees);
      }
      if (!company.state?.trim() && cached.state?.trim()) partial.state = cached.state.trim();
      if (!company.domain?.trim() && cached.domain?.trim()) partial.domain = cached.domain.trim();
      if (!company.resolvedName?.trim() && cached.resolvedName?.trim()) {
        partial.resolvedName = cached.resolvedName.trim();
      }
      if (
        company.revenue == null &&
        cached.revenue != null &&
        !Number.isNaN(Number(cached.revenue))
      ) {
        partial.revenue = Number(cached.revenue);
      }
      if (!company.industry?.trim() && cached.industry?.trim()) partial.industry = cached.industry.trim();
      if (!company.description?.trim() && cached.description?.trim()) {
        partial.description = cached.description.trim();
      }
      if (!company.city?.trim() && cached.city?.trim()) partial.city = cached.city.trim();
      partial.enrichedByZoomInfo = true;
      out.set(company.id, ziMetaFor(company, partial, { cachedHit: true }));
      continue;
    }
    needsSearch.push(company);
  }

  if (needsSearch.length === 0) return out;

  for (const company of needsSearch) {
    const searchBody = {
      data: {
        type: "CompanySearch",
        attributes: {
          companyName: company.rawInput,
          ...(company.domain ? { companyWebsite: company.domain } : {}),
        },
      },
    };
    const searchRes = await enrichWithRetry(() =>
      zoomInfoFetch(SEARCH_COMPANY_URL, { method: "POST", body: JSON.stringify(searchBody) }, true),
    );
    if (!searchRes.ok) {
      out.set(company.id, ziMetaFor(company, {}));
      continue;
    }
    const searchJson = (await searchRes.json()) as unknown;
    const searchData = isRecord(searchJson) ? searchJson.data : undefined;
    const searchResults = Array.isArray(searchData) ? searchData : [];
    const firstResource = isRecord(searchResults[0]) ? searchResults[0] : null;
    const rawCompanyId = firstResource?.id;
    const companyId =
      typeof rawCompanyId === "string"
        ? rawCompanyId
        : typeof rawCompanyId === "number"
          ? String(rawCompanyId)
          : null;
    if (!companyId || !hasCompanySearchMatch(searchJson, firstCompanySearchHit(searchJson))) {
      out.set(company.id, ziMetaFor(company, {}));
      continue;
    }
    companyIdToRowId.set(companyId, company.id);
  }

  if (companyIdToRowId.size === 0) return out;

  const enrichBody = {
    data: {
      type: "CompanyEnrich",
      attributes: {
        matchCompanyInput: Array.from(companyIdToRowId.keys()).map((companyId) => ({ companyId })),
        outputFields: [
          "id",
          "name",
          "website",
          "socialMediaUrls",
          "employeeCount",
          "state",
          "revenue",
          "industries",
          "description",
          "city",
        ],
      },
    },
  };

  const enrichRes = await enrichWithRetry(() =>
    zoomInfoFetch(ENRICH_COMPANY_URL, { method: "POST", body: JSON.stringify(enrichBody) }, true),
  );
  if (!enrichRes.ok) {
    for (const company of needsSearch) {
      if (!out.has(company.id)) out.set(company.id, ziMetaFor(company, {}));
    }
    return out;
  }

  const enrichJson = (await enrichRes.json()) as unknown;
  const enrichDataRoot = isRecord(enrichJson) ? enrichJson.data : undefined;
  const enrichItems = Array.isArray(enrichDataRoot)
    ? enrichDataRoot
    : enrichDataRoot && isRecord(enrichDataRoot)
      ? [enrichDataRoot]
      : [];

  for (const item of enrichItems) {
    if (!isRecord(item)) continue;
    const idRaw = item.id;
    const zoomCompanyId =
      typeof idRaw === "string"
        ? idRaw
        : typeof idRaw === "number"
          ? String(idRaw)
          : null;
    if (!zoomCompanyId) continue;
    const rowId = companyIdToRowId.get(zoomCompanyId);
    if (!rowId) continue;
    const company = needsSearch.find((row) => row.id === rowId);
    if (!company) continue;
    const attrs = isRecord(item.attributes) ? item.attributes : {};
    const linkedInUrl = linkedInUrlFromSocialMediaUrls(attrs);
    const employeeCountRaw = attrs.employeeCount;
    const employeeCount =
      employeeCountRaw != null && !Number.isNaN(Number(employeeCountRaw))
        ? Number(employeeCountRaw)
        : null;
    const state = typeof attrs.state === "string" ? attrs.state.trim() : null;
    const revenueRaw = attrs.revenue;
    const revenue =
      revenueRaw != null && !Number.isNaN(Number(revenueRaw)) ? Number(revenueRaw) : null;
    const industries = attrs.industries;
    let industry: string | null = null;
    if (Array.isArray(industries) && industries.length > 0) {
      const first = industries[0];
      if (isRecord(first) && typeof first.name === "string") industry = first.name.trim() || null;
    }
    const description =
      typeof attrs.description === "string" ? attrs.description.trim() || null : null;
    const city = typeof attrs.city === "string" ? attrs.city.trim() || null : null;

    const partial: Partial<EnrichedCompany> = {};
    if (linkedInUrl) {
      partial.linkedinUrl = linkedInUrl;
      partial.linkedinSource = "zoominfo" as LinkedInSource;
    }
    if (employeeCount != null) partial.numberOfEmployees = employeeCount;
    if (state) partial.state = state;
    if (typeof attrs.website === "string" && attrs.website.trim()) {
      partial.domain = normalizeDomain(attrs.website);
    }
    if (typeof attrs.name === "string" && attrs.name.trim()) partial.resolvedName = attrs.name.trim();
    if (revenue != null) partial.revenue = revenue;
    if (industry) partial.industry = industry;
    if (description) partial.description = description;
    if (city) partial.city = city;
    partial.enrichedByZoomInfo = true;

    const mergedFull: EnrichedCompany = {
      ...company,
      ...partial,
      confidenceScore: "high",
      enrichedByZoomInfo: true,
    };
    const cacheKeyName = cacheKeyById.get(company.id) ?? (company.resolvedName ?? company.rawInput);
    await setCachedCompany(cacheKeyName, mergedFull);
    out.set(company.id, ziMetaFor(company, partial));
  }

  for (const company of needsSearch) {
    if (!out.has(company.id)) out.set(company.id, ziMetaFor(company, {}));
  }
  return out;
}

export async function enrichContactWithZoomInfo(
  contact: EnrichedContact,
): Promise<ZoomInfoContactEnrichmentResult> {
  const ziMeta = (fields: Partial<EnrichedContact>): ZoomInfoContactEnrichmentResult => ({
    ...fields,
    originalConfidence: contact.confidenceScore,
  });

  const rawEmail = contact.rawEmail?.trim() ?? "";
  const hasWorkEmail = Boolean(rawEmail) && !contact.isPersonalEmail;
  const isHighConfidence = contact.confidenceScore === "high";

  let personId: string | null = null;

  if (!hasWorkEmail) {
    const searchBody = {
      data: {
        type: "ContactSearch",
        attributes: {
          firstName: contact.firstName,
          lastName: contact.lastName,
          ...(contact.rawEmail && !contact.isPersonalEmail
            ? { emailAddress: contact.rawEmail }
            : {}),
          ...(contact.resolvedCompany ? { companyName: contact.resolvedCompany } : {}),
        },
      },
    };

    const res = await zoomInfoFetch(
      SEARCH_CONTACT_URL,
      { method: "POST", body: JSON.stringify(searchBody) },
      true,
    );
    console.log("[ZoomInfo] contact search response status:", res.status);
    if (res.status === 400) {
      const errorBody = await res.text();
      console.log(
        "[ZoomInfo] contact search 400 | response chars:",
        errorBody.length,
      );
      return ziMeta({});
    }
    if (!res.ok) {
      return ziMeta({});
    }
    const searchJson: unknown = await res.json();
    const searchData = isRecord(searchJson) ? searchJson.data : undefined;
    const searchResults = Array.isArray(searchData) ? searchData : [];
    const firstResource = isRecord(searchResults[0]) ? searchResults[0] : null;
    const rawPid = firstResource?.id;
    personId =
      typeof rawPid === "string"
        ? rawPid
        : typeof rawPid === "number"
          ? String(rawPid)
          : null;
    console.log(
      "[ZoomInfo Contact Search] row id:",
      contact.id,
      "| matchedZoomPersonId:",
      personId ?? "none",
    );

    if (!personId) {
      return ziMeta({});
    }
  } else {
    console.log(
      "[ZoomInfo Contact Search] skipped name search (work email path) | row id:",
      contact.id,
    );
  }

  const matchInput = hasWorkEmail
    ? { emailAddress: rawEmail }
    : personId
      ? { personId }
      : null;

  if (!matchInput) {
    return ziMeta({});
  }

  const enrichBody = {
    data: {
      type: "ContactEnrich",
      attributes: {
        matchPersonInput: [matchInput],
        outputFields: [
          "id",
          "firstName",
          "lastName",
          "jobTitle",
          "externalUrls",
          "state",
          "city",
          "companyName",
          "companyId",
          "companyPrimaryIndustry",
          "companyEmployeeCount",
          "companyWebsite",
          "managementLevel",
          "jobFunction",
          "phone",
          "mobilePhone",
          "email",
          "contactAccuracyScore",
        ],
      },
    },
  };

  const res = await zoomInfoFetch(
    ENRICH_CONTACT_URL,
    { method: "POST", body: JSON.stringify(enrichBody) },
    true,
  );
  console.log("[ZoomInfo] contact enrich response status:", res.status);
  if (res.status === 400) {
    const errorBody = await res.text();
    console.log(
      "[ZoomInfo] contact enrich 400 | response chars:",
      errorBody.length,
    );
    return ziMeta({});
  }
  if (!res.ok) {
    return ziMeta({});
  }
  const enrichJson: unknown = await res.json();
  const enrichDataRoot = isRecord(enrichJson) ? enrichJson.data : undefined;
  const enrichItems = Array.isArray(enrichDataRoot)
    ? enrichDataRoot
    : enrichDataRoot && isRecord(enrichDataRoot)
      ? [enrichDataRoot]
      : [];
  const firstEnrich = isRecord(enrichItems[0]) ? enrichItems[0] : null;
  const attrs =
    firstEnrich && isRecord(firstEnrich.attributes) ? firstEnrich.attributes : {};

  const linkedinUrl = Array.isArray(attrs.externalUrls)
    ? (attrs.externalUrls.find(
        (u: unknown): u is { url: string } =>
          isUrlObject(u) && u.url.includes("linkedin.com"),
      )?.url ?? null)
    : null;

  const result = {
    title: attrs.jobTitle ?? null,
    linkedinUrl: linkedinUrl,
    state: attrs.state ?? null,
    city: attrs.city ?? null,
    resolvedCompany: attrs.companyName ?? null,
    phone: attrs.phone ?? attrs.mobilePhone ?? null,
    enrichedByZoomInfo: !!attrs.id,
    contactAccuracyScore: attrs.contactAccuracyScore ?? null,
  };

  console.log("[ZoomInfo Contact Enrich] row id:", contact.id, {
    found: !!attrs.id,
    hasTitle: Boolean(result.title),
    linkedInFound: Boolean(result.linkedinUrl),
    hasCompany: Boolean(result.resolvedCompany),
    accuracyScore: result.contactAccuracyScore,
  });

  if (!attrs.id && !firstEnrich?.id) {
    return ziMeta({});
  }

  const pickStr = (
    ziVal: string | null,
    contactVal: string | undefined,
  ): string | undefined => {
    const z = ziVal?.trim();
    if (!z) return undefined;
    const c = (contactVal ?? "").trim();
    if (isHighConfidence && c) return undefined;
    return z;
  };

  const pickPhone = (): string | undefined => {
    const raw = result.phone;
    const z = typeof raw === "string" ? raw.trim() : "";
    if (!z) return undefined;
    if (isHighConfidence && contact.phone?.trim()) return undefined;
    return z;
  };

  const ziTitle = typeof result.title === "string" ? result.title.trim() || null : null;
  const ziLinkedin =
    typeof result.linkedinUrl === "string" ? result.linkedinUrl.trim() || null : null;
  const ziCompany =
    typeof result.resolvedCompany === "string" ? result.resolvedCompany.trim() || null : null;
  const locationZi =
    [result.city, result.state]
      .map((x) => (typeof x === "string" ? x.trim() : ""))
      .filter(Boolean)
      .join(", ") || null;

  // Field names must match EnrichedContact type exactly
  const out: Partial<EnrichedContact> = {};

  // When the original email was personal or missing, capture ZoomInfo's work email as resolvedEmail.
  const ziEmail = typeof attrs.email === "string" ? attrs.email.trim() : null;
  const originalEmailWasPersonalOrMissing = contact.isPersonalEmail || !contact.rawEmail?.trim();
  if (ziEmail && !isPersonalEmail(ziEmail) && originalEmailWasPersonalOrMissing) {
    out.resolvedEmail = ziEmail;
    out.emailSource = "zoominfo";
    if (contact.rawEmail?.trim()) {
      out.personalEmail = contact.rawEmail.trim();
    }
  }

  // ZoomInfo contact accuracy score — stored for confidence bucket logic (Section 7/9)
  const accuracyScore =
    typeof attrs.contactAccuracyScore === "number" ? attrs.contactAccuracyScore : null;
  if (accuracyScore != null) out.ziContactAccuracyScore = accuracyScore;

  const t = pickStr(ziTitle, contact.title);
  if (t) out.title = t;
  const li = pickStr(ziLinkedin, contact.linkedinUrl);
  if (li) {
    out.linkedinUrl = li;
    out.linkedinSource = "zoominfo" as LinkedInSource;
  }
  const co = pickStr(ziCompany, contact.resolvedCompany);
  if (co) out.resolvedCompany = co;
  const loc = pickStr(locationZi, contact.location);
  if (loc) out.location = loc;
  const ph = pickPhone();
  if (ph) out.phone = ph;

  const ziAttrStr = (v: unknown): string | null => {
    if (typeof v === "string") {
      const t = v.trim();
      return t || null;
    }
    if (typeof v === "number" && !Number.isNaN(v)) return String(v);
    if (isRecord(v) && typeof v.name === "string") {
      const t = v.name.trim();
      return t || null;
    }
    return null;
  };

  const ml = ziAttrStr(attrs.managementLevel);
  if (!(contact.ziManagementLevel ?? "").trim() && ml) {
    out.ziManagementLevel = ml;
  }

  const jf = ziAttrStr(attrs.jobFunction);
  if (!(contact.ziJobFunction ?? "").trim() && jf) {
    out.ziJobFunction = jf;
  }

  const empRaw = attrs.companyEmployeeCount;
  const empStr =
    empRaw != null && !Number.isNaN(Number(empRaw))
      ? String(Number(empRaw))
      : ziAttrStr(empRaw);
  if (!(contact.ziCompanyEmployeeCount ?? "").trim() && empStr) {
    out.ziCompanyEmployeeCount = empStr;
  }

  const ind = ziAttrStr(attrs.companyPrimaryIndustry);
  if (!(contact.ziCompanyPrimaryIndustry ?? "").trim() && ind) {
    out.ziCompanyPrimaryIndustry = ind;
  }

  const web = ziAttrStr(attrs.companyWebsite);
  if (!(contact.companyDomain ?? "").trim() && web) {
    out.ziCompanyWebsite = web;
  }

  out.enrichedByZoomInfo = true;

  const mergedFull: EnrichedContact = {
    ...contact,
    ...out,
    confidenceScore: "high",
    enrichedByZoomInfo: true,
  };
  const cacheEmail = contact.rawEmail?.trim();
  if (cacheEmail) {
    await setCachedContact(cacheEmail, mergedFull);
  }

  return ziMeta(out);
}

export async function enrichContactsWithZoomInfo(
  contacts: EnrichedContact[],
): Promise<Map<string, ZoomInfoContactEnrichmentResult>> {
  const out = new Map<string, ZoomInfoContactEnrichmentResult>();
  if (contacts.length === 0) return out;

  const personIdToRowId = new Map<string, string>();
  const enrichInputsByRowId = new Map<string, { emailAddress?: string; personId?: string }>();
  const ziMetaFor = (
    row: EnrichedContact,
    fields: Partial<EnrichedContact>,
  ): ZoomInfoContactEnrichmentResult => ({
    ...fields,
    originalConfidence: row.confidenceScore,
  });

  for (const contact of contacts) {
    const rawEmail = contact.rawEmail?.trim() ?? "";
    const hasWorkEmail = Boolean(rawEmail) && !contact.isPersonalEmail;
    if (hasWorkEmail) {
      enrichInputsByRowId.set(contact.id, { emailAddress: rawEmail });
      continue;
    }
    const searchBody = {
      data: {
        type: "ContactSearch",
        attributes: {
          firstName: contact.firstName,
          lastName: contact.lastName,
          ...(contact.rawEmail && !contact.isPersonalEmail
            ? { emailAddress: contact.rawEmail }
            : {}),
          ...(contact.resolvedCompany ? { companyName: contact.resolvedCompany } : {}),
        },
      },
    };
    const searchRes = await enrichWithRetry(() =>
      zoomInfoFetch(SEARCH_CONTACT_URL, { method: "POST", body: JSON.stringify(searchBody) }, true),
    );
    if (!searchRes.ok) {
      out.set(contact.id, ziMetaFor(contact, {}));
      continue;
    }
    const searchJson = (await searchRes.json()) as unknown;
    const searchData = isRecord(searchJson) ? searchJson.data : undefined;
    const searchResults = Array.isArray(searchData) ? searchData : [];
    const firstResource = isRecord(searchResults[0]) ? searchResults[0] : null;
    const rawPid = firstResource?.id;
    const personId =
      typeof rawPid === "string"
        ? rawPid
        : typeof rawPid === "number"
          ? String(rawPid)
          : null;
    if (!personId) {
      out.set(contact.id, ziMetaFor(contact, {}));
      continue;
    }
    personIdToRowId.set(personId, contact.id);
    enrichInputsByRowId.set(contact.id, { personId });
  }

  const matchPersonInput = contacts
    .map((row) => enrichInputsByRowId.get(row.id))
    .filter(Boolean) as Array<{ emailAddress?: string; personId?: string }>;

  if (matchPersonInput.length === 0) return out;

  const enrichBody = {
    data: {
      type: "ContactEnrich",
      attributes: {
        matchPersonInput,
        outputFields: [
          "id",
          "firstName",
          "lastName",
          "jobTitle",
          "externalUrls",
          "state",
          "city",
          "companyName",
          "companyId",
          "companyPrimaryIndustry",
          "companyEmployeeCount",
          "companyWebsite",
          "managementLevel",
          "jobFunction",
          "phone",
          "mobilePhone",
          "email",
          "contactAccuracyScore",
        ],
      },
    },
  };
  const enrichRes = await enrichWithRetry(() =>
    zoomInfoFetch(ENRICH_CONTACT_URL, { method: "POST", body: JSON.stringify(enrichBody) }, true),
  );
  if (!enrichRes.ok) {
    for (const contact of contacts) if (!out.has(contact.id)) out.set(contact.id, ziMetaFor(contact, {}));
    return out;
  }

  const enrichJson = (await enrichRes.json()) as unknown;
  const enrichDataRoot = isRecord(enrichJson) ? enrichJson.data : undefined;
  const enrichItems = Array.isArray(enrichDataRoot)
    ? enrichDataRoot
    : enrichDataRoot && isRecord(enrichDataRoot)
      ? [enrichDataRoot]
      : [];

  for (const item of enrichItems) {
    if (!isRecord(item)) continue;
    const attrs = isRecord(item.attributes) ? item.attributes : {};
    const rawPid = item.id;
    const personId =
      typeof rawPid === "string" ? rawPid : typeof rawPid === "number" ? String(rawPid) : null;
    let rowId = personId ? personIdToRowId.get(personId) : undefined;
    if (!rowId && typeof attrs.email === "string") {
      const normalizedEmail = attrs.email.trim().toLowerCase();
      const byEmail = contacts.find((row) => row.rawEmail.trim().toLowerCase() === normalizedEmail);
      rowId = byEmail?.id;
    }
    if (!rowId) continue;
    const contact = contacts.find((row) => row.id === rowId);
    if (!contact) continue;

    const linkedinUrl = Array.isArray(attrs.externalUrls)
      ? (attrs.externalUrls.find(
          (u: unknown): u is { url: string } => isUrlObject(u) && u.url.includes("linkedin.com"),
        )?.url ?? null)
      : null;
    const ziAttrStr = (v: unknown): string | null => {
      if (typeof v === "string") return v.trim() || null;
      if (typeof v === "number" && !Number.isNaN(v)) return String(v);
      if (isRecord(v) && typeof v.name === "string") return v.name.trim() || null;
      return null;
    };
    const result: Partial<EnrichedContact> = {};

    // When the original email was personal or missing, capture ZoomInfo's work email as resolvedEmail.
    const ziEmail = typeof attrs.email === "string" ? attrs.email.trim() : null;
    const originalEmailWasPersonalOrMissing = contact.isPersonalEmail || !contact.rawEmail?.trim();
    if (ziEmail && !isPersonalEmail(ziEmail) && originalEmailWasPersonalOrMissing) {
      result.resolvedEmail = ziEmail;
      result.emailSource = "zoominfo";
      if (contact.rawEmail?.trim()) {
        result.personalEmail = contact.rawEmail.trim();
      }
    }

    // ZoomInfo contact accuracy score — stored for confidence bucket logic (Section 7/9)
    const accuracyScore =
      typeof attrs.contactAccuracyScore === "number" ? attrs.contactAccuracyScore : null;
    if (accuracyScore != null) result.ziContactAccuracyScore = accuracyScore;

    if (typeof attrs.jobTitle === "string" && attrs.jobTitle.trim()) result.title = attrs.jobTitle.trim();
    if (typeof linkedinUrl === "string" && linkedinUrl.trim()) {
      result.linkedinUrl = linkedinUrl.trim();
      result.linkedinSource = "zoominfo" as LinkedInSource;
    }
    if (typeof attrs.companyName === "string" && attrs.companyName.trim()) {
      result.resolvedCompany = attrs.companyName.trim();
    }
    const city = typeof attrs.city === "string" ? attrs.city.trim() : "";
    const state = typeof attrs.state === "string" ? attrs.state.trim() : "";
    const loc = [city, state].filter(Boolean).join(", ");
    if (loc) result.location = loc;
    const phone = typeof attrs.phone === "string" ? attrs.phone.trim() : "";
    const mobile = typeof attrs.mobilePhone === "string" ? attrs.mobilePhone.trim() : "";
    if (phone || mobile) result.phone = phone || mobile;
    const ml = ziAttrStr(attrs.managementLevel);
    if (ml) result.ziManagementLevel = ml;
    const jf = ziAttrStr(attrs.jobFunction);
    if (jf) result.ziJobFunction = jf;
    const emp = ziAttrStr(attrs.companyEmployeeCount);
    if (emp) result.ziCompanyEmployeeCount = emp;
    const ind = ziAttrStr(attrs.companyPrimaryIndustry);
    if (ind) result.ziCompanyPrimaryIndustry = ind;
    const web = ziAttrStr(attrs.companyWebsite);
    if (web) result.ziCompanyWebsite = web;
    result.enrichedByZoomInfo = true;

    const mergedFull: EnrichedContact = {
      ...contact,
      ...result,
      confidenceScore: "high",
      enrichedByZoomInfo: true,
    };
    const cacheEmail = contact.rawEmail?.trim();
    if (cacheEmail) await setCachedContact(cacheEmail, mergedFull);
    out.set(contact.id, ziMetaFor(contact, result));
  }

  for (const contact of contacts) if (!out.has(contact.id)) out.set(contact.id, ziMetaFor(contact, {}));
  return out;
}

export { sleep as delayBetweenZoomInfoCalls };
