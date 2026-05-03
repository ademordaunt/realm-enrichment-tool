import type { EnrichedCompany, EnrichedContact } from "@/lib/utils/types";

export const ENRICHMENT_BATCH_SIZE = 3;

export function needsLinkedInLookup(contact: EnrichedContact): boolean {
  return !String(contact.linkedinUrl ?? "").trim();
}

export function needsCompanyLinkedInLookup(company: EnrichedCompany): boolean {
  return !String(company.linkedinUrl ?? "").trim();
}
