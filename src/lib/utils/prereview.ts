import type { EnrichedCompany, EnrichedContact } from "@/lib/utils/types";

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
] as const;

const INTL_TLDS = [
  ".tw",
  ".uk",
  ".de",
  ".ca",
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
] as const;

const GOV_NAME_PATTERNS = [
  "u.s. army",
  "u.s. navy",
  "u.s. air force",
  "united states army",
  "united states navy",
  "united states air force",
  "department of",
  "dept of",
  "federal bureau",
  "united states courts",
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

function isInternationalCompany(row: EnrichedCompany): boolean {
  const st = (row.state ?? "").toLowerCase();
  if (st.includes("foreign")) return true;
  for (const s of INTL_STATE_SUBSTRINGS) {
    if (st.includes(s)) return true;
  }
  const host = normalizeHost(row.domain);
  if (host && hasInternationalTld(host)) return true;
  return false;
}

function isGovernmentCompany(row: EnrichedCompany): boolean {
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
export function shouldOpenPreReviewGate(
  listType: "companies" | "contacts",
  rows: EnrichedCompany[] | EnrichedContact[],
): boolean {
  if (listType === "companies") {
    const companies = rows as EnrichedCompany[];
    const { international, government } = detectFlaggedCompanies(companies);
    const intlGov = countUniqueFlaggedCompanies(international, government);
    const groups = detectDuplicateGroups(companies).size;
    return intlGov >= PREREVIEW_INTL_GOV_THRESHOLD || groups >= PREREVIEW_DUPLICATE_THRESHOLD;
  }
  return detectDuplicateContactGroups(rows as EnrichedContact[]).size >= PREREVIEW_DUPLICATE_THRESHOLD;
}
