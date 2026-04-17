import type { EnrichedCompany, EnrichedContact } from "@/lib/utils/types";

function websiteFromDomain(domain: string): string {
  const d = domain.trim().toLowerCase();
  if (!d) return "";
  const bare = d.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  return bare ? `https://www.${bare}` : "";
}

function firstNonEmptyString(
  ...vals: (string | undefined | null | boolean)[]
): string {
  for (const v of vals) {
    if (typeof v === "string" && v.trim() !== "") return v.trim();
  }
  return "";
}

function domainFromEmail(email: string): string {
  const at = email.indexOf("@");
  if (at < 0) return "";
  return email.slice(at + 1).toLowerCase().trim();
}

export function mergeEnrichedCompany(
  ai: EnrichedCompany,
  zoominfo: Partial<EnrichedCompany>,
  commonroom: Partial<EnrichedCompany>,
): EnrichedCompany {
  const domain = firstNonEmptyString(zoominfo.domain, ai.domain, commonroom.domain);
  const website = websiteFromDomain(domain);

  const linkedinUrl = firstNonEmptyString(
    zoominfo.linkedinUrl,
    ai.linkedinUrl,
    commonroom.linkedinUrl,
  );

  const state = firstNonEmptyString(zoominfo.state, ai.state);
  const numberOfEmployees =
    zoominfo.numberOfEmployees != null &&
    !Number.isNaN(Number(zoominfo.numberOfEmployees))
      ? Number(zoominfo.numberOfEmployees)
      : ai.numberOfEmployees;

  const resolvedName = firstNonEmptyString(zoominfo.resolvedName, ai.resolvedName);

  let confidenceScore = ai.confidenceScore;
  if (zoominfo.enrichedByZoomInfo) {
    confidenceScore = "high";
  }

  return {
    ...ai,
    resolvedName,
    domain,
    website,
    state,
    numberOfEmployees,
    linkedinUrl,
    enrichedByZoomInfo: ai.enrichedByZoomInfo || Boolean(zoominfo.enrichedByZoomInfo),
    enrichedByCommonRoom: ai.enrichedByCommonRoom || Boolean(commonroom.enrichedByCommonRoom),
    confidenceScore,
    needsReview: confidenceScore === "high" ? false : ai.needsReview,
  };
}

export function mergeEnrichedContact(
  ai: EnrichedContact,
  zoominfo: Partial<EnrichedContact>,
  commonroom: Partial<EnrichedContact>,
): EnrichedContact {
  const resolvedEmail = firstNonEmptyString(
    zoominfo.resolvedEmail,
    ai.resolvedEmail,
  );

  const linkedinUrl = firstNonEmptyString(
    commonroom.linkedinUrl,
    ai.linkedinUrl,
    zoominfo.linkedinUrl,
  );

  const resolvedCompany = firstNonEmptyString(
    zoominfo.resolvedCompany,
    ai.resolvedCompany,
  );

  let companyDomain = firstNonEmptyString(ai.companyDomain);
  if (!companyDomain && resolvedEmail) {
    companyDomain = domainFromEmail(resolvedEmail);
  }

  let confidenceScore = ai.confidenceScore;
  if (zoominfo.enrichedByZoomInfo) {
    confidenceScore = "high";
  }

  return {
    ...ai,
    resolvedEmail,
    linkedinUrl,
    resolvedCompany,
    companyDomain,
    enrichedByZoomInfo: ai.enrichedByZoomInfo || Boolean(zoominfo.enrichedByZoomInfo),
    enrichedByCommonRoom: ai.enrichedByCommonRoom || Boolean(commonroom.enrichedByCommonRoom),
    confidenceScore,
    needsReview: confidenceScore === "high" ? false : ai.needsReview,
  };
}
