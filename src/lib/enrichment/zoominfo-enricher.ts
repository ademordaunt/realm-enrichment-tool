import { getCachedCompany, setCachedCompany } from "@/lib/cache/enrichment-cache";
import type { EnrichedCompany, EnrichedContact } from "@/lib/utils/types";
import { getZoomInfoToken, invalidateZoomInfoToken } from "@/lib/zoominfo/auth";

/** ZoomInfo partial plus pre-merge confidence (never persisted on EnrichedCompany). */
export type ZoomInfoCompanyEnrichmentResult = Partial<EnrichedCompany> & {
  originalConfidence: EnrichedCompany["confidenceScore"];
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
    console.log("[ZoomInfo] request body:", JSON.stringify(JSON.parse(init.body), null, 2));
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
    if (isRecord(s) && typeof s.url === "string" && s.url.includes("linkedin.com")) {
      return s.url.trim();
    }
  }
  return null;
}

/**
 * Search then enrich company. Returns partial ZoomInfo fields plus `originalConfidence`
 * for merge mode; merger applies gap-fill vs ZoomInfo-wins.
 */
export async function enrichCompanyWithZoomInfo(
  company: EnrichedCompany,
): Promise<ZoomInfoCompanyEnrichmentResult> {
  const ziMeta = (fields: Partial<EnrichedCompany>): ZoomInfoCompanyEnrichmentResult => ({
    ...fields,
    originalConfidence: company.confidenceScore,
  });

  const cacheKeyName = company.rawInput;
  const cached = await getCachedCompany(cacheKeyName);
  // Same KV key as AI cache — only skip ZoomInfo when this row was ZoomInfo-merged before.
  if (cached?.enrichedByZoomInfo) {
    // Field names must match EnrichedCompany type exactly — only fill gaps vs current AI row.
    const out: Partial<EnrichedCompany> = {};
    if (!company.linkedinUrl?.trim() && cached.linkedinUrl?.trim()) {
      out.linkedinUrl = cached.linkedinUrl.trim();
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
    return ziMeta(out);
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
    console.log("[ZoomInfo] 400 error body:", errorBody);
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
  const matchedAttrs =
    firstResource && isRecord(firstResource.attributes) ? firstResource.attributes : {};
  const matchedName =
    typeof matchedAttrs.name === "string" ? matchedAttrs.name : null;
  console.log("[ZoomInfo Search] matched:", matchedName, "id:", companyId);

  const firstSearchResult =
    firstResource && isRecord(firstResource.attributes) ? firstResource.attributes : {};
  console.log(
    "[ZoomInfo] match found:",
    searchResults.length > 0
      ? `YES - ${String((firstSearchResult as { name?: unknown }).name ?? "")}`
      : "NO",
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
    console.log("[ZoomInfo] 400 error body:", errorBody);
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

  console.log("[ZoomInfo Enrich] result for", company.rawInput, "→", {
    found: Boolean(attrs.id ?? firstEnrich?.id),
    linkedIn: linkedInUrl,
    employees: employeeCount,
    state,
    revenue,
    industry,
    description,
    city,
  });

  if (!attrs.id && !firstEnrich?.id) {
    return ziMeta({});
  }

  // Field names must match EnrichedCompany type exactly
  const out: Partial<EnrichedCompany> = {};
  if (linkedInUrl) {
    out.linkedinUrl = linkedInUrl;
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
  let matchedName: string | null = null;

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

    let res = await zoomInfoFetch(
      SEARCH_CONTACT_URL,
      { method: "POST", body: JSON.stringify(searchBody) },
      true,
    );
    console.log("[ZoomInfo] contact search response status:", res.status);
    if (res.status === 400) {
      const errorBody = await res.text();
      console.log("[ZoomInfo] 400 error body:", errorBody);
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
    const sa =
      firstResource && isRecord(firstResource.attributes) ? firstResource.attributes : {};
    const fn = typeof sa.firstName === "string" ? sa.firstName.trim() : "";
    const ln = typeof sa.lastName === "string" ? sa.lastName.trim() : "";
    matchedName = [fn, ln].filter(Boolean).join(" ") || null;
    console.log("[ZoomInfo Contact Search] matched:", matchedName, "id:", personId);

    if (!personId) {
      return ziMeta({});
    }
  } else {
    console.log(
      "[ZoomInfo Contact Search] skipped search (work email); enrich by email, id:",
      "—",
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
    console.log("[ZoomInfo] 400 error body:", errorBody);
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
    ? attrs.externalUrls.find((u: any) => u.url?.includes("linkedin.com"))?.url ?? null
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

  console.log("[ZoomInfo Contact Enrich] result for", contact.firstName, contact.lastName, "→", {
    found: !!attrs.id,
    title: result.title,
    linkedIn: result.linkedinUrl,
    company: result.resolvedCompany,
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
  const t = pickStr(ziTitle, contact.title);
  if (t) out.title = t;
  const li = pickStr(ziLinkedin, contact.linkedinUrl);
  if (li) out.linkedinUrl = li;
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

  return ziMeta(out);
}

export { sleep as delayBetweenZoomInfoCalls };
