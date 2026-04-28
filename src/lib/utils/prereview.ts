import { isFullContact, isPersonalEmail } from "@/lib/utils/contacts";
import { sanitizeCompanyName } from "@/lib/utils/sanitize";
import type {
  EnrichedCompany,
  EnrichedContact,
  ExclusionReason,
  IdentityConfidence,
  ReviewBucket,
} from "@/lib/utils/types";

export const PREREVIEW_INTL_GOV_THRESHOLD = 3;
export const PREREVIEW_DUPLICATE_THRESHOLD = 2;

const INTL_STATE_SUBSTRINGS = [
  "foreign",
  "canada",
  "quebec",
  "ontario",
  "netherlands",
  "korea",
  "japan",
  "germany",
  "france",
  "australia",
  "india",
  "china",
  "brazil",
  "mexico",
  "israel",
  "singapore",
  "taiwan",
  "uk",
  "england",
  "switzerland",
  "italy",
  "spain",
  "sweden",
  "norway",
  "denmark",
  "finland",
  "poland",
  "belgium",
  "austria",
  "ireland",
  "new zealand",
  "united arab emirates",
  "saudi arabia",
  "south africa",
  "argentina",
  "colombia",
  "chile",
  "philippines",
  "indonesia",
  "malaysia",
  "thailand",
  "vietnam",
] as const;

const INTL_TLDS = [
  ".tw",
  ".uk",
  ".de",
  ".ca",
  ".quebec",
  ".fr",
  ".au",
  ".jp",
  ".kr",
  ".nl",
  ".il",
  ".sg",
  ".ch",
  ".br",
  ".mx",
  ".za",
  ".in",
  ".cn",
  ".eu",
  ".it",
  ".es",
  ".se",
  ".no",
  ".dk",
  ".fi",
  ".pl",
  ".be",
  ".at",
  ".ie",
  ".nz",
  ".ae",
  ".sa",
  ".ar",
  ".ph",
  ".my",
  ".th",
  ".vn",
  ".co",
] as const;

const GOV_NAME_PATTERNS = [
  // Military
  "u.s. army", "u.s. navy", "u.s. air force", "u.s. marine", "u.s. coast guard",
  "united states army", "united states navy", "united states air force",
  "national guard",
  // Federal agencies/entities
  "federal bureau", "federal reserve", "federal home loan",
  "department of ", "dept. of ", "dept of ",
  "office of ", "bureau of ", "agency of ",
  // State/local government
  "state of ", "city of ", "county of ", "town of ", "village of ",
  "municipality of ", "commonwealth of ",
  // Other public entities
  "school district", "unified school", "public school",
  "port authority", "transit authority", "housing authority",
  "united states courts", "judicial circuit",
] as const;

function normalizeHost(domain: string): string {
  let d = domain.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, "");
  d = d.split("/")[0] ?? "";
  d = d.split(":")[0] ?? "";
  d = d.replace(/^www\./, "");
  return d;
}

export function normalizeCompanyDomainKey(domain: string): string {
  return normalizeHost(domain);
}

function hasInternationalTld(host: string): boolean {
  if (!host) return false;
  for (const t of INTL_TLDS) {
    if (host.endsWith(t) || host === t.slice(1)) return true;
  }
  return false;
}

export function isInternationalCompany(row: EnrichedCompany): boolean {
  const st = (row.state ?? "").toLowerCase();
  if (
    st.includes("foreign") &&
    !st.includes("us hq") &&
    !st.includes("u.s. hq") &&
    !st.includes("united states hq")
  ) return true;
  for (const s of INTL_STATE_SUBSTRINGS) {
    if (s.length <= 3) {
      if (st === s || st.startsWith(`${s} `) || st.endsWith(` ${s}`) || st.includes(` ${s} `)) {
        return true;
      }
    } else if (st.includes(s)) {
      return true;
    }
  }
  const host = normalizeHost(row.domain);
  if (host && hasInternationalTld(host)) return true;
  const INTL_NAME_SUFFIXES = [
    " gmbh", " ag ", " ag", " b.v.", " bv ", " s.a.", " s.a.s",
    " pty ltd", " pty. ltd", " plc", " ltd.", " s.p.a", " s.r.l",
    " ab ", " oy ", " as ", " a/s",
  ] as const;
  const nameLower = (row.resolvedName ?? "").toLowerCase();
  for (const suffix of INTL_NAME_SUFFIXES) {
    if (nameLower.endsWith(suffix.trim()) || nameLower.includes(suffix)) return true;
  }
  const rawInputLower = (row.rawInput ?? "").toLowerCase();
  const rawWordIndicators = [
    " canada",
    " uk",
    " india",
    " germany",
    " france",
    " australia",
    " korea",
    " israel",
    " singapore",
    " mexico",
    " portugal",
    " dubai",
    " brazil",
    " japan",
    " china",
    " taiwan",
  ] as const;
  for (const indicator of rawWordIndicators) {
    if (` ${rawInputLower}`.includes(indicator)) return true;
  }
  const rawDashIndicators = [
    "- canada",
    "- uk",
    "- india",
    "- germany",
    "- france",
    "- australia",
    "- korea",
    "- israel",
    "- singapore",
    "- mexico",
    "- portugal",
    "- dubai",
    "- brazil",
    "- japan",
    "- china",
    "- taiwan",
    "-kr",
    "-sg",
    "-pt",
    "-ht",
    "-mx",
  ] as const;
  for (const indicator of rawDashIndicators) {
    if (rawInputLower.includes(indicator)) return true;
  }
  return false;
}

export function isGovernmentCompany(row: EnrichedCompany): boolean {
  const host = normalizeHost(row.domain);
  if (host.endsWith(".gov") || host.endsWith(".mil")) return true;
  const name = (row.resolvedName ?? "").toLowerCase();
  for (const p of GOV_NAME_PATTERNS) {
    if (name.includes(p)) return true;
  }
  return false;
}

export function detectFlaggedCompanies(rows: EnrichedCompany[]): {
  international: EnrichedCompany[];
  government: EnrichedCompany[];
} {
  const international: EnrichedCompany[] = [];
  const government: EnrichedCompany[] = [];
  const seenI = new Set<string>();
  const seenG = new Set<string>();

  for (const r of rows) {
    if (isInternationalCompany(r) && !seenI.has(r.id)) {
      seenI.add(r.id);
      international.push(r);
    }
    if (isGovernmentCompany(r) && !seenG.has(r.id)) {
      seenG.add(r.id);
      government.push(r);
    }
  }
  return { international, government };
}

function uniqueFlaggedCount(intl: EnrichedCompany[], gov: EnrichedCompany[]): number {
  const ids = new Set<string>();
  for (const r of intl) ids.add(r.id);
  for (const r of gov) ids.add(r.id);
  return ids.size;
}

export function countUniqueFlaggedCompanies(intl: EnrichedCompany[], gov: EnrichedCompany[]): number {
  return uniqueFlaggedCount(intl, gov);
}

export function detectDuplicateGroups(rows: EnrichedCompany[]): Map<string, EnrichedCompany[]> {
  const byKey = new Map<string, EnrichedCompany[]>();
  for (const r of rows) {
    const k = normalizeCompanyDomainKey(r.domain);
    if (!k) continue;
    const list = byKey.get(k) ?? [];
    list.push(r);
    byKey.set(k, list);
  }
  const out = new Map<string, EnrichedCompany[]>();
  for (const [k, list] of byKey) {
    if (list.length >= 2) out.set(k, list);
  }
  return out;
}

function normalizeEmailKey(email: string): string {
  return email.trim().toLowerCase();
}

export function detectDuplicateContactGroups(rows: EnrichedContact[]): Map<string, EnrichedContact[]> {
  const byKey = new Map<string, EnrichedContact[]>();
  for (const r of rows) {
    const k = normalizeEmailKey(r.resolvedEmail);
    if (!k) continue;
    const list = byKey.get(k) ?? [];
    list.push(r);
    byKey.set(k, list);
  }
  const out = new Map<string, EnrichedContact[]>();
  for (const [k, list] of byKey) {
    if (list.length >= 2) out.set(k, list);
  }
  return out;
}

/** True if the pre-review screen should be shown (vs. skipping straight to Review & Edit). */
export function applyConfidenceFilter<T extends EnrichedCompany | EnrichedContact>(
  rows: T[],
): T[] {
  return rows.map((row) => {
    if (row.identityConfidence === "low" || row.identityConfidence === "unresolved") {
      return { ...row, linkedinUrl: "", linkedinSource: "" as const };
    }
    return row;
  });
}

export type ComputeReviewBucketOptions = { importMode?: "event" | "bulk" };

export function computeReviewBucket(
  row: EnrichedCompany | EnrichedContact,
  listType: "companies" | "contacts",
  options?: ComputeReviewBucketOptions,
): { bucket: ReviewBucket; exclusionReason?: ExclusionReason } {
  if (listType === "companies") {
    const company = row as EnrichedCompany;
    if (isInternationalCompany(company)) {
      return { bucket: "excluded", exclusionReason: "international" };
    }
    if (isGovernmentCompany(company)) {
      return { bucket: "excluded", exclusionReason: "government" };
    }
  }

  if (listType === "contacts") {
    const contact = row as EnrichedContact;
    if (!isFullContact(contact)) {
      const reason = isPersonalEmail(contact.resolvedEmail ?? "")
        ? ("personal_email" as const)
        : ("missing_required_fields" as const);
      return { bucket: "excluded", exclusionReason: reason };
    }
  }

  if (row.identityConfidence === "low" || row.identityConfidence === "unresolved") {
    return {
      bucket: "excluded",
      exclusionReason:
        row.identityConfidence === "low" ? "low_confidence" : "unresolved",
    };
  }

  if (row.enrichedByAI === false) {
    return { bucket: "trusted" };
  }

  if (listType === "contacts") {
    const contact = row as EnrichedContact;
    if (!sanitizeCompanyName(contact.resolvedCompany)) {
      return { bucket: "needs_review" };
    }
    if (options?.importMode === "event") {
      if (!contact.title?.trim() || !contact.linkedinUrl?.trim()) {
        return { bucket: "needs_review" };
      }
    }
  } else {
    const companyNeedsDomain = row as EnrichedCompany;
    if (!companyNeedsDomain.domain?.trim()) {
      return { bucket: "needs_review" };
    }
  }

  const company = row as EnrichedCompany;
  const verifiedByTrustedSource =
    row.hubspotId != null ||
    row.enrichedByZoomInfo === true ||
    row.enrichedByCommonRoom === true ||
    (listType === "companies" &&
      (company.domainSource === "zoominfo_verified" ||
        company.domainSource === "hubspot_verified"));

  if (
    (row.identityConfidence === "high" || row.identityConfidence === "medium") &&
    verifiedByTrustedSource
  ) {
    return { bucket: "trusted" };
  }

  if (
    listType === "companies" &&
    row.identityConfidence === "high" &&
    company.domainSource === "ai_guess" &&
    company.domain?.trim()
  ) {
    return { bucket: "trusted" };
  }

  return { bucket: "needs_review" };
}

export function finalizeRowsForReview<T extends EnrichedCompany | EnrichedContact>(
  rows: T[],
  listType: "companies" | "contacts",
  options?: ComputeReviewBucketOptions,
): T[] {
  const filtered = applyConfidenceFilter(rows);
  return filtered.map((row) => {
    const idConf = row.identityConfidence as
      | IdentityConfidence
      | null
      | undefined
      | "";
    const patched: T =
      (idConf === undefined || idConf === null || idConf === "") &&
      typeof row.confidenceScore === "string" &&
      row.confidenceScore.trim() !== ""
        ? ({ ...row, identityConfidence: row.confidenceScore as IdentityConfidence } as T)
        : row;
    const { bucket, exclusionReason } = computeReviewBucket(patched, listType, options);
    return {
      ...patched,
      reviewBucket: bucket,
      exclusionReason,
    };
  }) as T[];
}

export function shouldOpenPreReviewGate(
  listType: "companies" | "contacts",
  rows: EnrichedCompany[] | EnrichedContact[],
): boolean {
  if (listType === "companies") {
    const companies = rows as EnrichedCompany[];
    const intlGov = companies.filter(
      (r) =>
        r.reviewBucket === "excluded" &&
        (r.exclusionReason === "international" || r.exclusionReason === "government"),
    ).length;
    const groups = detectDuplicateGroups(companies).size;
    return intlGov >= PREREVIEW_INTL_GOV_THRESHOLD || groups >= PREREVIEW_DUPLICATE_THRESHOLD;
  }
  return detectDuplicateContactGroups(rows as EnrichedContact[]).size >= PREREVIEW_DUPLICATE_THRESHOLD;
}
