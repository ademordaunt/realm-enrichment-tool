import type { EnrichedCompany, EnrichedContact } from "@/lib/utils/types";
import { isPersonalEmail } from "@/lib/utils/contacts";

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

function linkedinSourceForCompanyUrl(
  mergedUrl: string,
  ai: EnrichedCompany,
  zi: Partial<EnrichedCompany>,
  commonroom: Partial<EnrichedCompany>,
  isHighConfidence: boolean,
): EnrichedCompany["linkedinSource"] {
  const u = mergedUrl.trim();
  if (!u) return "";
  const inferAi = (): EnrichedCompany["linkedinSource"] =>
    ai.linkedinSource?.trim()
      ? ai.linkedinSource
      : ai.enrichedByAI
        ? "ai_search"
        : "";

  if (isHighConfidence) {
    if (ai.linkedinUrl?.trim() === u) return inferAi();
    if (zi.linkedinUrl?.trim() === u) return "zoominfo";
    if (commonroom.linkedinUrl?.trim() === u) return "commonroom";
    return "";
  }
  if (zi.linkedinUrl?.trim() === u) return "zoominfo";
  if (ai.linkedinUrl?.trim() === u) return inferAi();
  if (commonroom.linkedinUrl?.trim() === u) return "commonroom";
  return "";
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
    // ZoomInfo wins on fast-aging fields; CSV fills when ZoomInfo returns nothing
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

  // Section 2b: Apply CSV fallbacks for fields ZoomInfo didn't provide.
  // CSV is lower trust than ZoomInfo — only fills when ZoomInfo returned nothing.
  if (!merged.domain?.trim() && !ai.domain?.trim() && ai.csvDomain?.trim()) {
    merged.domain = ai.csvDomain.trim();
    if (!merged.domainSource) merged.domainSource = "csv";
  }
  if (!merged.state?.trim() && ai.csvState?.trim()) {
    merged.state = ai.csvState.trim();
  }
  if (merged.numberOfEmployees == null && ai.csvEmployees?.trim()) {
    const n = Number(ai.csvEmployees.trim());
    if (Number.isFinite(n)) merged.numberOfEmployees = n;
  }
  if (!merged.industry?.trim() && ai.csvIndustry?.trim()) {
    merged.industry = ai.csvIndustry.trim();
  }

  // Carry csv fields forward on the merged row
  merged.csvDomain = ai.csvDomain;
  merged.csvState = ai.csvState;
  merged.csvEmployees = ai.csvEmployees;
  merged.csvIndustry = ai.csvIndustry;

  merged.website = websiteFromDomain(merged.domain);
  merged.enrichedByZoomInfo = ai.enrichedByZoomInfo || Boolean(zi.enrichedByZoomInfo);
  merged.enrichedByCommonRoom =
    ai.enrichedByCommonRoom || Boolean(commonroom.enrichedByCommonRoom);
  merged.needsReview = merged.confidenceScore === "high" ? false : ai.needsReview;

  merged.industry = merged.industry?.trim() || undefined;
  merged.city = merged.city?.trim() || undefined;
  merged.description = merged.description?.trim() || undefined;

  if (
    zi.domain?.trim() &&
    merged.domain.trim().toLowerCase() === zi.domain.trim().toLowerCase()
  ) {
    merged.domainSource = "zoominfo_verified";
  }

  merged.linkedinSource = linkedinSourceForCompanyUrl(
    merged.linkedinUrl,
    ai,
    zi,
    commonroom,
    isHighConfidence,
  );

  merged.identityConfidence = merged.confidenceScore;

  if (zi.enrichedByZoomInfo && zi.resolvedName?.trim() && ai.resolvedName?.trim()) {
    const aiName = ai.resolvedName.toLowerCase().trim();
    const ziName = zi.resolvedName.toLowerCase().trim();
    const aiWords = aiName.split(/\s+/).filter((w) => w.length > 4);
    const ziWords = ziName.split(/\s+/).filter((w) => w.length > 4);
    const hasOverlap = aiWords.some((w) =>
      ziWords.some((z) => z.includes(w) || w.includes(z)),
    );
    if (!hasOverlap && aiWords.length > 0 && ziWords.length > 0) {
      merged.identityConfidence = "medium";
      merged.confidenceScore = "medium";
      merged.aiReasoning = `${merged.aiReasoning} Note: ZoomInfo returned "${zi.resolvedName}" — please verify.`;
    }
  }

  return merged;
}

function linkedinSourceForContactUrl(
  mergedUrl: string,
  ai: EnrichedContact,
  zoominfo: Partial<EnrichedContact>,
  commonroom: Partial<EnrichedContact>,
  prospector?: Partial<EnrichedContact>,
): EnrichedContact["linkedinSource"] {
  const u = mergedUrl.trim();
  if (!u) return "";
  const inferAi = (): EnrichedContact["linkedinSource"] =>
    ai.linkedinSource?.trim()
      ? ai.linkedinSource
      : ai.enrichedByAI
        ? "ai_search"
        : "";

  if (commonroom.linkedinUrl?.trim() === u) return "commonroom";
  if (prospector?.linkedinUrl?.trim() === u) return "zoominfo";
  if (ai.linkedinUrl?.trim() === u) return inferAi();
  if (zoominfo.linkedinUrl?.trim() === u) return "zoominfo";
  return "";
}

export function mergeEnrichedContact(
  ai: EnrichedContact,
  zoominfo: Partial<EnrichedContact>,
  commonroom: Partial<EnrichedContact>,
  prospector?: Partial<EnrichedContact>,
): EnrichedContact {
  // Section 9c: If ZoomInfo accuracy score < 25, discard all ZoomInfo field values.
  // The score is preserved on the output row but no ZI fields are applied.
  const ziScore = zoominfo.ziContactAccuracyScore;
  const ziDiscarded = typeof ziScore === "number" && ziScore < 25;
  const zi: Partial<EnrichedContact> = ziDiscarded ? {} : zoominfo;

  /**
   * Primary email: CSV raw remains canonical unless ZoomInfo / Common Room returns an upgraded
   * contact-level resolvedEmail (work email when input was personal or missing).
   */
  const enricherResolvedEmail = firstNonEmptyString(
    zi.resolvedEmail,
    commonroom.resolvedEmail,
  );
  const resolvedEmail =
    enricherResolvedEmail || (ai.rawEmail?.trim() ?? "");

  let personalEmail = firstNonEmptyString(
    zi.personalEmail,
    commonroom.personalEmail,
    ai.personalEmail,
  );
  const csvRaw = ai.rawEmail?.trim() ?? "";
  if (
    !personalEmail &&
    csvRaw &&
    resolvedEmail &&
    csvRaw.toLowerCase() !== resolvedEmail.toLowerCase() &&
    isPersonalEmail(csvRaw) &&
    !isPersonalEmail(resolvedEmail)
  ) {
    personalEmail = csvRaw;
  }
  if (
    personalEmail &&
    resolvedEmail &&
    personalEmail.trim().toLowerCase() === resolvedEmail.trim().toLowerCase()
  ) {
    personalEmail = "";
  }

  const linkedinUrl = firstNonEmptyString(
    commonroom.linkedinUrl,
    prospector?.linkedinUrl,
    ai.linkedinUrl,
    zi.linkedinUrl,
  );

  const resolvedCompany = firstNonEmptyString(
    commonroom.resolvedCompany,
    zi.resolvedCompany,
    ai.resolvedCompany,
  );

  // Section 2b: CSV title is highest trust — never overwrite with ZoomInfo
  const title = firstNonEmptyString(
    ai.csvTitle,           // CSV title is highest trust for contacts
    commonroom.title,
    prospector?.title,
    zi.title,
    ai.title,
  );

  const location = firstNonEmptyString(
    commonroom.location,
    prospector?.location,
    zi.location,
    ai.location,
  );

  // Company domain: ZoomInfo wins on conflict, CSV used as fallback
  let companyDomain = firstNonEmptyString(
    zi.ziCompanyWebsite,
    ai.companyDomain,
    ai.csvDomain,
  );
  if (!companyDomain && resolvedEmail) {
    companyDomain = domainFromEmail(resolvedEmail);
  }

  let confidenceScore = ai.confidenceScore;
  if (zi.enrichedByZoomInfo) {
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

  const linkedinSource = linkedinSourceForContactUrl(
    linkedinUrl,
    ai,
    zi,
    commonroom,
    prospector,
  );

  // Section 2b: CSV fallback fields — only used when ZoomInfo returned nothing
  const mergedLocation = location || (ai.csvState?.trim() ? ai.csvState : undefined) || ai.location;

  const ziEmployeeCount = zi.ziCompanyEmployeeCount?.trim();
  const mergedEmployeeCount = ziEmployeeCount || ai.csvEmployees;

  const ziIndustry = zi.ziCompanyPrimaryIndustry?.trim();
  const mergedIndustry = ziIndustry || ai.csvIndustry;

  return {
    ...ai,
    resolvedEmail,
    ...(personalEmail.trim()
      ? { personalEmail: personalEmail.trim() }
      : { personalEmail: undefined }),
    linkedinUrl,
    linkedinSource,
    resolvedCompany,
    title: title || ai.title,
    location: mergedLocation || ai.location,
    companyDomain,
    // Carry csv fields forward
    csvTitle: ai.csvTitle,
    csvDomain: ai.csvDomain,
    csvState: ai.csvState,
    csvEmployees: ai.csvEmployees,
    csvIndustry: ai.csvIndustry,
    ziManagementLevel:
      firstNonEmptyString(ai.ziManagementLevel, zi.ziManagementLevel) || undefined,
    ziJobFunction:
      firstNonEmptyString(ai.ziJobFunction, zi.ziJobFunction) || undefined,
    ziCompanyEmployeeCount: mergedEmployeeCount || undefined,
    ziCompanyPrimaryIndustry: mergedIndustry || undefined,
    ziCompanyWebsite:
      firstNonEmptyString(ai.ziCompanyWebsite, zi.ziCompanyWebsite) || undefined,
    enrichedByZoomInfo: ai.enrichedByZoomInfo || Boolean(zi.enrichedByZoomInfo),
    enrichedByCommonRoom: ai.enrichedByCommonRoom || Boolean(commonroom.enrichedByCommonRoom),
    confidenceScore,
    identityConfidence: confidenceScore,
    needsReview: confidenceScore === "high" ? false : ai.needsReview,
    // Always preserve the raw score, even when discarded
    ziContactAccuracyScore: ziScore ?? ai.ziContactAccuracyScore,
    ziMatchDiscarded: ziDiscarded || ai.ziMatchDiscarded || false,
  };
}
