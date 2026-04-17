import type { EnrichedCompany, EnrichedContact } from "@/lib/utils/types";
import { getZoomInfoToken, invalidateZoomInfoToken } from "@/lib/zoominfo/auth";

const SEARCH_COMPANY_URL = "https://api.zoominfo.com/search/company";
const ENRICH_COMPANY_URL = "https://api.zoominfo.com/enrich/company";
const SEARCH_CONTACT_URL = "https://api.zoominfo.com/search/contact";
const ENRICH_CONTACT_URL = "https://api.zoominfo.com/enrich/contact";

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

function firstContactSearchHit(json: unknown): {
  email?: string;
  linkedInUrl?: string;
} | null {
  if (!isRecord(json)) return null;
  const data = json.data;
  if (Array.isArray(data) && data.length > 0) {
    const first = data[0];
    if (isRecord(first)) {
      const attrs = first.attributes;
      if (isRecord(attrs)) {
        return {
          email: typeof attrs.email === "string" ? attrs.email : undefined,
          linkedInUrl:
            typeof attrs.linkedInUrl === "string"
              ? attrs.linkedInUrl
              : typeof attrs.linkedinUrl === "string"
                ? attrs.linkedinUrl
                : undefined,
        };
      }
    }
  }
  const results = json.results ?? json.searchResults;
  if (Array.isArray(results) && results[0] && isRecord(results[0])) {
    const r = results[0] as Record<string, unknown>;
    return {
      email: typeof r.email === "string" ? r.email : undefined,
      linkedInUrl:
        typeof r.linkedInUrl === "string"
          ? r.linkedInUrl
          : typeof r.linkedinUrl === "string"
            ? r.linkedinUrl
            : undefined,
    };
  }
  return null;
}

function enrichCompanyAttributes(
  json: unknown,
): Partial<EnrichedCompany> & { _matched?: boolean } {
  if (!isRecord(json)) return {};
  const data = json.data;
  let attrs: Record<string, unknown> | undefined;
  if (Array.isArray(data) && data[0] && isRecord(data[0])) {
    const a = data[0].attributes;
    if (isRecord(a)) attrs = a;
  }
  if (!attrs && isRecord(json) && isRecord(json.attributes)) {
    attrs = json.attributes;
  }
  if (!attrs) return {};

  const out: Partial<EnrichedCompany> & { _matched?: boolean } = {
    _matched: true,
  };
  if (typeof attrs.name === "string" && attrs.name.trim()) {
    out.resolvedName = attrs.name.trim();
  }
  if (typeof attrs.website === "string" && attrs.website.trim()) {
    out.domain = normalizeDomain(attrs.website);
  }
  if (typeof attrs.hqState === "string" && attrs.hqState.trim()) {
    out.state = attrs.hqState.trim();
  }
  if (attrs.employeeCount != null) {
    const n = Number(attrs.employeeCount);
    if (!Number.isNaN(n)) out.numberOfEmployees = n;
  }
  if (typeof attrs.linkedInUrl === "string" && attrs.linkedInUrl.trim()) {
    out.linkedinUrl = attrs.linkedInUrl.trim();
  } else if (typeof attrs.linkedinUrl === "string" && attrs.linkedinUrl.trim()) {
    out.linkedinUrl = attrs.linkedinUrl.trim();
  }
  return out;
}

function enrichContactAttributes(
  json: unknown,
): Partial<EnrichedContact> & { _matched?: boolean } {
  if (!isRecord(json)) return {};
  const data = json.data;
  let attrs: Record<string, unknown> | undefined;
  if (Array.isArray(data) && data[0] && isRecord(data[0])) {
    const a = data[0].attributes;
    if (isRecord(a)) attrs = a;
  }
  if (!attrs && isRecord(json.attributes)) attrs = json.attributes;
  if (!attrs) return {};

  const out: Partial<EnrichedContact> & { _matched?: boolean } = {
    _matched: true,
  };
  if (typeof attrs.email === "string" && attrs.email.trim()) {
    out.resolvedEmail = attrs.email.trim();
  }
  if (typeof attrs.linkedInUrl === "string" && attrs.linkedInUrl.trim()) {
    out.linkedinUrl = attrs.linkedInUrl.trim();
  } else if (typeof attrs.linkedinUrl === "string" && attrs.linkedinUrl.trim()) {
    out.linkedinUrl = attrs.linkedinUrl.trim();
  }
  if (typeof attrs.companyName === "string" && attrs.companyName.trim()) {
    out.resolvedCompany = attrs.companyName.trim();
  }
  return out;
}

async function zoomInfoFetch(
  url: string,
  init: RequestInit,
  allowRetry: boolean,
): Promise<Response> {
  let token = await getZoomInfoToken();
  let res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
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
        "Content-Type": "application/json",
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

/**
 * Search then enrich company. Returns partial fields only when ZoomInfo returns data;
 * does not overwrite AI when no match.
 */
export async function enrichCompanyWithZoomInfo(
  company: EnrichedCompany,
): Promise<Partial<EnrichedCompany>> {
  const searchBody = {
    outputFields: [
      "id",
      "name",
      "website",
      "employeeCount",
      "hqState",
      "linkedInUrl",
    ],
    searchInput: [{ companyName: company.resolvedName || company.rawInput }],
  };

  let res = await zoomInfoFetch(
    SEARCH_COMPANY_URL,
    { method: "POST", body: JSON.stringify(searchBody) },
    true,
  );
  if (!res.ok) {
    return {};
  }
  const searchJson: unknown = await res.json();
  const hit = firstCompanySearchHit(searchJson);
  if (!hasCompanySearchMatch(searchJson, hit)) {
    return {};
  }

  const domain = hit?.website?.trim()
    ? normalizeDomain(hit.website)
    : company.domain?.trim()
      ? normalizeDomain(company.domain)
      : "";
  if (!domain) {
    return {};
  }

  const enrichBody = {
    outputFields: [
      "name",
      "website",
      "employeeCount",
      "hqState",
      "linkedInUrl",
      "companyHQPhone",
    ],
    matchInput: [{ companyWebsite: domain }],
  };

  res = await zoomInfoFetch(
    ENRICH_COMPANY_URL,
    { method: "POST", body: JSON.stringify(enrichBody) },
    true,
  );
  if (!res.ok) {
    return {};
  }
  const enrichJson: unknown = await res.json();
  const parsed = enrichCompanyAttributes(enrichJson);
  const matched = parsed._matched;
  delete (parsed as { _matched?: boolean })._matched;
  if (!matched) {
    return {};
  }

  const out: Partial<EnrichedCompany> = {};
  if (parsed.resolvedName) out.resolvedName = parsed.resolvedName;
  if (parsed.domain) out.domain = parsed.domain;
  if (parsed.state) out.state = parsed.state;
  if (parsed.numberOfEmployees != null) out.numberOfEmployees = parsed.numberOfEmployees;
  if (parsed.linkedinUrl) out.linkedinUrl = parsed.linkedinUrl;
  out.enrichedByZoomInfo = true;
  return out;
}

export async function enrichContactWithZoomInfo(
  contact: EnrichedContact,
): Promise<Partial<EnrichedContact>> {
  const searchBody = {
    outputFields: [
      "id",
      "firstName",
      "lastName",
      "email",
      "jobTitle",
      "companyName",
      "linkedInUrl",
    ],
    searchInput: [
      {
        firstName: contact.firstName,
        lastName: contact.lastName,
        companyName: contact.resolvedCompany || contact.rawCompany,
      },
    ],
  };

  let res = await zoomInfoFetch(
    SEARCH_CONTACT_URL,
    { method: "POST", body: JSON.stringify(searchBody) },
    true,
  );
  if (!res.ok) {
    return {};
  }
  const searchJson: unknown = await res.json();
  const hit = firstContactSearchHit(searchJson);
  const email =
    hit?.email?.trim() ||
    contact.resolvedEmail?.trim() ||
    contact.rawEmail?.trim();
  if (!email) {
    return {};
  }

  const enrichBody = {
    matchInput: [{ email }],
  };

  res = await zoomInfoFetch(
    ENRICH_CONTACT_URL,
    { method: "POST", body: JSON.stringify(enrichBody) },
    true,
  );
  if (!res.ok) {
    return {};
  }
  const enrichJson: unknown = await res.json();
  const parsed = enrichContactAttributes(enrichJson);
  const matched = parsed._matched;
  delete (parsed as { _matched?: boolean })._matched;
  if (!matched) {
    return {};
  }

  const out: Partial<EnrichedContact> = {};
  if (parsed.resolvedEmail) out.resolvedEmail = parsed.resolvedEmail;
  if (parsed.linkedinUrl) out.linkedinUrl = parsed.linkedinUrl;
  if (parsed.resolvedCompany) out.resolvedCompany = parsed.resolvedCompany;
  out.enrichedByZoomInfo = true;
  return out;
}

export { sleep as delayBetweenZoomInfoCalls };
