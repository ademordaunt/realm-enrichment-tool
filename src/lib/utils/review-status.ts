import type { EnrichedCompany, EnrichedContact } from "@/lib/utils/types";
import {
  sanitizeCompany,
  sanitizeCompanyName,
  sanitizeContact,
  sanitizeUnknown,
} from "@/lib/utils/sanitize";
import { expandStateAbbreviation } from "@/lib/utils/states";

function initialCompanyReviewStatus(company: EnrichedCompany): EnrichedCompany["status"] {
  if (company.reviewBucket === "trusted") return "approved";
  if (company.reviewBucket === "needs_review") return "pending";
  return "skipped";
}

function initialContactReviewStatus(contact: EnrichedContact): EnrichedContact["status"] {
  if (contact.reviewBucket === "trusted") return "approved";
  if (contact.reviewBucket === "needs_review") return "pending";
  return "skipped";
}

export function applyInitialReviewStatus(
  rows: EnrichedCompany[] | EnrichedContact[],
): EnrichedCompany[] | EnrichedContact[] {
  return rows.map((r) => {
    if ("rawInput" in r) {
      const c = r as EnrichedCompany;
      const base = sanitizeCompany(c);
      return {
        ...base,
        status: initialCompanyReviewStatus(base),
        state: expandStateAbbreviation(base.state),
      };
    }
    const c = r as EnrichedContact;
    const ingested = sanitizeContact(c);
    const rawEmail = sanitizeUnknown(ingested.rawEmail);
    const resolvedEmail = sanitizeUnknown(ingested.resolvedEmail) || rawEmail;
    const merged: EnrichedContact = {
      ...ingested,
      firstName: sanitizeUnknown(ingested.firstName),
      lastName: sanitizeUnknown(ingested.lastName),
      rawEmail,
      resolvedEmail,
      resolvedCompany: sanitizeCompanyName(ingested.resolvedCompany),
      title: sanitizeUnknown(ingested.title),
      linkedinUrl: sanitizeUnknown(ingested.linkedinUrl),
      location: expandStateAbbreviation(sanitizeUnknown(ingested.location)),
    };
    return {
      ...merged,
      status: initialContactReviewStatus(merged),
    };
  }) as EnrichedCompany[] | EnrichedContact[];
}
