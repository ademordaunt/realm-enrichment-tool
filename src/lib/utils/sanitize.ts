import type { EnrichedCompany, EnrichedContact } from "@/lib/utils/types";

/** Returns empty string if value is null, undefined, empty, or case-insensitive "unknown" */
export function sanitizeUnknown(val: string | null | undefined): string {
  if (!val?.trim() || val.trim().toLowerCase() === "unknown") return "";
  return val.trim();
}

/** Same rules as {@link sanitizeUnknown}; used for state/region columns in the review UI. */
export function sanitizeState(val: string | null | undefined): string {
  return sanitizeUnknown(val);
}

/** Returns empty string if value matches {@link sanitizeUnknown} OR is case-insensitive "self" */
export function sanitizeCompanyName(val: string | null | undefined): string {
  const base = sanitizeUnknown(val);
  if (base.toLowerCase() === "self") return "";
  return base;
}

/** Ingestion-time cleanup for contact rows (before status / getDisplayConfidence). */
export function sanitizeContact(row: EnrichedContact): EnrichedContact {
  const selfPattern = /^self$/i;
  const unknownPattern = /^unknown$/i;
  const rc = row.resolvedCompany?.trim() ?? "";
  const resolvedCompany =
    !rc || selfPattern.test(rc) || unknownPattern.test(rc) ? "" : row.resolvedCompany;
  const loc = row.location?.trim() ?? "";
  const location = unknownPattern.test(loc) ? "" : row.location;
  return {
    ...row,
    resolvedCompany,
    location,
  };
}

/** Sanitizes a full EnrichedCompany before status assignment (state column only). */
export function sanitizeCompany(row: EnrichedCompany): EnrichedCompany {
  return {
    ...row,
    state: sanitizeUnknown(row.state),
  };
}
