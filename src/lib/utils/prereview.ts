import { isPersonalEmail } from "@/lib/utils/contacts";
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
  // Higher education — substring matches; may theoretically hit company names containing these
  // phrases, but frequency is low and manual override is available.
  "university of ",
  "community college",
  "state college",
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

/** Normalize a company name for conflict detection — strips punctuation, legal suffixes, extra whitespace. */
function normalizeNameForConflict(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\b(inc|llc|corp|ltd|co|company|incorporated|limited|the)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Returns true when two company names represent meaningfully different entities after
 * stripping legal suffixes and punctuation. False if either name is empty.
 */
function namesConflict(a: string, b: string): boolean {
  if (!a || !b) return false;
  const na = normalizeNameForConflict(a);
  const nb = normalizeNameForConflict(b);
  if (!na || !nb) return false;
  return na !== nb;
}

function normalizeD(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0] ?? "";
}

export function computeReviewBucket(
  row: EnrichedCompany | EnrichedContact,
  listType: "companies" | "contacts",
  _options?: ComputeReviewBucketOptions,
): { bucket: ReviewBucket; exclusionReason?: ExclusionReason } {
  if (listType === "companies") {
    const company = row as EnrichedCompany;
    const ic = company.identityConfidence ?? company.confidenceScore;
    const ex = company.existingData as Record<string, string> | undefined;

    // Manual override from Excluded(international) -> Needs Review.
    if (company.manuallyIncluded === true) {
      return { bucket: "needs_review" };
    }

    // --- 7a: Excluded ---
    // Rule 1: International AND ZoomInfo returned no US state
    if (isInternationalCompany(company) && !company.state?.trim()) {
      return { bucket: "excluded", exclusionReason: "international" };
    }
    // Rule 2: Government
    if (isGovernmentCompany(company)) {
      return { bucket: "excluded", exclusionReason: "government" };
    }
    // Rule 3: Total non-resolution — no name AND no domain after all enrichment
    if (!company.resolvedName?.trim() && !company.domain?.trim()) {
      return { bucket: "excluded", exclusionReason: "unresolved" };
    }
    // Rule 4: No ZoomInfo enrichment AND AI confidence is low or unresolved
    if (!company.enrichedByZoomInfo && (ic === "low" || ic === "unresolved")) {
      return { bucket: "excluded", exclusionReason: ic === "low" ? "low_confidence" : "unresolved" };
    }

    // Compute conflict flags used by both Trusted checks and Needs Review fallback
    const ziDomain = company.domainSource === "zoominfo_verified" ? normalizeD(company.domain) : null;
    const hsDomain = ex?.domain ? normalizeD(ex.domain) : null;
    const domainConflict = Boolean(ziDomain && hsDomain && ziDomain !== hsDomain);

    const hsName = ex?.name?.trim();
    const nameConflict = Boolean(
      hsName && company.resolvedName?.trim() && namesConflict(company.resolvedName, hsName),
    );

    // --- 7e: Trusted Path A (ZoomInfo verified) ---
    if (
      company.enrichedByZoomInfo &&
      !domainConflict &&
      !nameConflict &&
      company.domain?.trim() &&
      company.state?.trim() &&
      company.numberOfEmployees != null &&
      ic !== "low"
    ) {
      return { bucket: "trusted" };
    }

    // --- 7e: Trusted Path B (HubSpot verified) ---
    if (
      company.hubspotId &&
      ex?.domain?.trim() &&
      ex?.state?.trim() &&
      ex?.numberofemployees?.trim() &&
      !domainConflict
    ) {
      return { bucket: "trusted" };
    }

    // --- 7c: Needs Review (everything that passed Excluded but missed Trusted) ---
    return { bucket: "needs_review" };
  }

  if (listType === "contacts") {
    const contact = row as EnrichedContact;
    const resolvedEmail = contact.resolvedEmail?.trim() ?? "";
    const ic = contact.identityConfidence ?? contact.confidenceScore;
    const ex = contact.existingData as Record<string, string> | undefined;

    // --- 7b: Excluded ---
    // Rule 1: Personal email AND ZoomInfo didn't find a work email
    if (resolvedEmail && isPersonalEmail(resolvedEmail) && contact.emailSource !== "zoominfo") {
      return { bucket: "excluded", exclusionReason: "personal_email" };
    }
    // Rule 2: No name at all
    if (!contact.firstName?.trim() && !contact.lastName?.trim()) {
      return { bucket: "excluded", exclusionReason: "missing_required_fields" };
    }
    // Rule 3: Total non-resolution AND ZoomInfo found nothing
    if (ic === "unresolved" && !contact.enrichedByZoomInfo) {
      return { bucket: "excluded", exclusionReason: "unresolved" };
    }

    // Rule 4: Very low ZoomInfo accuracy always requires manual review
    if (typeof contact.ziContactAccuracyScore === "number" && contact.ziContactAccuracyScore < 25) {
      return { bucket: "needs_review" };
    }

    const workEmail = Boolean(resolvedEmail) && !isPersonalEmail(resolvedEmail);
    const hasEmailConflict = Boolean(
      contact.rawEmail?.trim() &&
        ex?.email?.trim() &&
        contact.rawEmail.trim().toLowerCase() !== ex.email.trim().toLowerCase(),
    );

    // --- 7f: Trusted Path A (ZoomInfo verified) ---
    if (
      workEmail &&
      !hasEmailConflict &&
      contact.resolvedCompany?.trim() &&
      contact.companyDomain?.trim() &&
      contact.enrichedByZoomInfo &&
      (contact.ziContactAccuracyScore == null || contact.ziContactAccuracyScore >= 50) &&
      contact.title?.trim() &&
      contact.linkedinUrl?.trim()
    ) {
      return { bucket: "trusted" };
    }

    // --- 7f: Trusted Path B (HubSpot or Common Room verified) ---
    const hsComplete = Boolean(
      contact.hubspotId &&
        ex?.email?.trim() &&
        ex?.jobtitle?.trim() &&
        ex?.company?.trim(),
    );
    if (
      workEmail &&
      !hasEmailConflict &&
      (contact.ziContactAccuracyScore == null || contact.ziContactAccuracyScore >= 50) &&
      (hsComplete || contact.enrichedByCommonRoom) &&
      contact.resolvedCompany?.trim() &&
      contact.companyDomain?.trim() &&
      contact.linkedinUrl?.trim()
    ) {
      return { bucket: "trusted" };
    }

    // --- 7d: Needs Review ---
    return { bucket: "needs_review" };
  }

  return { bucket: "needs_review" };
}

export function finalizeRowsForReview<T extends EnrichedCompany[] | EnrichedContact[]>(
  rows: T,
  listType: "companies" | "contacts",
  options?: ComputeReviewBucketOptions & {
    manualEdits?: Map<string, Record<string, unknown>>;
  },
): T {
  const filtered = applyConfidenceFilter(
    rows as Array<EnrichedCompany | EnrichedContact>,
  );
  return filtered.map((row) => {
    const stableKey =
      listType === "contacts"
        ? ((row as EnrichedContact).resolvedEmail ?? "").trim().toLowerCase()
        : ((row as EnrichedCompany).domain ?? "").trim().toLowerCase();
    const manualDiff = stableKey ? options?.manualEdits?.get(stableKey) : undefined;
    const withManualEdits = manualDiff
      ? ({ ...row, ...manualDiff } as EnrichedCompany | EnrichedContact)
      : row;
    const idConfSource = withManualEdits.identityConfidence;
    const patched =
      (idConfSource === undefined || idConfSource === null) &&
      typeof withManualEdits.confidenceScore === "string" &&
      withManualEdits.confidenceScore.trim() !== ""
        ? ({
            ...withManualEdits,
            identityConfidence: withManualEdits.confidenceScore as IdentityConfidence,
          } as EnrichedCompany | EnrichedContact)
        : withManualEdits;
    const { bucket, exclusionReason } = computeReviewBucket(patched, listType, options);
    const linkedinAmberFlag =
      bucket === "trusted" && patched.linkedinSource === "ai_search" ? true : undefined;
    const trustedSortTier =
      bucket === "trusted" ? (linkedinAmberFlag ? 1 : 2) : undefined;
    return {
      ...patched,
      reviewBucket: bucket,
      exclusionReason,
      ...(linkedinAmberFlag !== undefined ? { linkedinAmberFlag } : {}),
      ...(trustedSortTier !== undefined ? { trustedSortTier } : {}),
    };
  }) as T;
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
