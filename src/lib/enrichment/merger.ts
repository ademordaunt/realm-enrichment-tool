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

type CompanyZoomInfoInput = Partial<EnrichedCompany> & {
  originalConfidence?: EnrichedCompany["confidenceScore"];
};

export function mergeEnrichedCompany(
  ai: EnrichedCompany,
  zoominfo: CompanyZoomInfoInput,
  commonroom: Partial<EnrichedCompany>,
): EnrichedCompany {
  const { originalConfidence, ...zi } = zoominfo;
  const modeIn = originalConfidence ?? ai.confidenceScore;
  const isHighConfidence = modeIn === "high";

  console.log(
    "[Merger] ZoomInfo merge mode:",
    isHighConfidence ? "fill-gaps" : "ZI-wins",
    "for",
    ai.resolvedName,
  );

  const merged: EnrichedCompany = { ...ai };

  if (isHighConfidence) {
    merged.linkedinUrl =
      ai.linkedinUrl?.trim() ||
      zi.linkedinUrl?.trim() ||
      commonroom.linkedinUrl?.trim() ||
      "";
    merged.numberOfEmployees = (ai.numberOfEmployees || zi.numberOfEmployees) ?? null;
    merged.state = ai.state?.trim() || zi.state?.trim() || "";
    merged.domain =
      ai.domain?.trim() || zi.domain?.trim() || commonroom.domain?.trim() || "";
    merged.resolvedName = ai.resolvedName?.trim() || zi.resolvedName?.trim() || "";
    merged.revenue = ai.revenue || zi.revenue;
    merged.industry = ai.industry?.trim() || zi.industry || "";
    merged.city = ai.city?.trim() || zi.city || "";
    merged.description = ai.description?.trim() || zi.description || "";
    merged.confidenceScore = "high";
  } else {
    merged.linkedinUrl =
      zi.linkedinUrl?.trim() ||
      ai.linkedinUrl?.trim() ||
      commonroom.linkedinUrl?.trim() ||
      "";
    merged.numberOfEmployees = (zi.numberOfEmployees || ai.numberOfEmployees) ?? null;
    merged.state = zi.state?.trim() || ai.state?.trim() || "";
    merged.domain =
      zi.domain?.trim() || ai.domain?.trim() || commonroom.domain?.trim() || "";
    merged.resolvedName = zi.resolvedName?.trim() || ai.resolvedName?.trim() || "";
    merged.revenue = zi.revenue || ai.revenue;
    merged.industry = zi.industry || ai.industry || "";
    merged.city = zi.city || ai.city || "";
    merged.description = zi.description || ai.description || "";
    merged.confidenceScore = zi.enrichedByZoomInfo ? "high" : ai.confidenceScore;
  }

  merged.website = websiteFromDomain(merged.domain);
  merged.enrichedByZoomInfo = ai.enrichedByZoomInfo || Boolean(zi.enrichedByZoomInfo);
  merged.enrichedByCommonRoom =
    ai.enrichedByCommonRoom || Boolean(commonroom.enrichedByCommonRoom);
  merged.needsReview = merged.confidenceScore === "high" ? false : ai.needsReview;

  merged.industry = merged.industry?.trim() || undefined;
  merged.city = merged.city?.trim() || undefined;
  merged.description = merged.description?.trim() || undefined;

  return merged;
}

export function mergeEnrichedContact(
  ai: EnrichedContact,
  zoominfo: Partial<EnrichedContact>,
  commonroom: Partial<EnrichedContact>,
  prospector?: Partial<EnrichedContact>,
): EnrichedContact {
  /** CSV email is canonical; never use AI/ZoomInfo/Common Room suggestions for the stored email. */
  const resolvedEmail = ai.rawEmail?.trim() ?? "";

  const linkedinUrl = firstNonEmptyString(
    commonroom.linkedinUrl,
    prospector?.linkedinUrl,
    ai.linkedinUrl,
    zoominfo.linkedinUrl,
  );

  const resolvedCompany = firstNonEmptyString(
    commonroom.resolvedCompany,
    zoominfo.resolvedCompany,
    ai.resolvedCompany,
  );

  const title = firstNonEmptyString(
    commonroom.title,
    prospector?.title,
    zoominfo.title,
    ai.title,
  );

  const location = firstNonEmptyString(
    commonroom.location,
    prospector?.location,
    zoominfo.location,
    ai.location,
  );

  let companyDomain = firstNonEmptyString(ai.companyDomain);
  if (!companyDomain && resolvedEmail) {
    companyDomain = domainFromEmail(resolvedEmail);
  }

  let confidenceScore = ai.confidenceScore;
  if (zoominfo.enrichedByZoomInfo) {
    confidenceScore = "high";
  } else if (
    commonroom.enrichedByCommonRoom &&
    (Boolean(commonroom.linkedinUrl?.trim()) ||
      Boolean(commonroom.resolvedCompany?.trim()) ||
      Boolean(commonroom.title?.trim()))
  ) {
    confidenceScore = "high";
  } else if (
    prospector &&
    (Boolean(prospector.linkedinUrl?.trim()) ||
      Boolean(prospector.title?.trim()) ||
      Boolean(prospector.location?.trim()))
  ) {
    confidenceScore = "high";
  }

  return {
    ...ai,
    resolvedEmail,
    linkedinUrl,
    resolvedCompany,
    title: title || ai.title,
    location: location || ai.location,
    companyDomain,
    enrichedByZoomInfo: ai.enrichedByZoomInfo || Boolean(zoominfo.enrichedByZoomInfo),
    enrichedByCommonRoom: ai.enrichedByCommonRoom || Boolean(commonroom.enrichedByCommonRoom),
    confidenceScore,
    needsReview: confidenceScore === "high" ? false : ai.needsReview,
  };
}
