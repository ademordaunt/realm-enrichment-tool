import type { EnrichedContact } from "@/lib/utils/types";

/** Consumer webmail domains (non-ISP personal addresses). */
const PERSONAL_CONSUMER_EMAIL_DOMAINS = [
  "gmail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "icloud.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "live.com",
  "msn.com",
  "me.com",
];

/** ISP / legacy consumer domains (still treated as non-work for `isPersonalEmail`). */
const ISP_EMAIL_DOMAINS = [
  "comcast.net",
  "verizon.net",
  "att.net",
  "sbcglobal.net",
  "bellsouth.net",
  "cox.net",
  "charter.net",
  "earthlink.net",
  "mac.com",
  "ymail.com",
  "googlemail.com",
  "roadrunner.com",
  "optonline.net",
  "optimum.net",
];

export const PERSONAL_EMAIL_DOMAINS = [
  ...PERSONAL_CONSUMER_EMAIL_DOMAINS,
  ...ISP_EMAIL_DOMAINS,
];

export type ContactEmailDomainKind = "Work" | "Personal" | "ISP" | "Invalid";

/** Classify the domain from an email for UI copy (ISP vs consumer vs work). */
export function classifyContactEmailDomain(email: string): ContactEmailDomainKind {
  if (!email.includes("@")) return "Invalid";
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  if (!domain) return "Invalid";
  if (ISP_EMAIL_DOMAINS.includes(domain)) return "ISP";
  if (PERSONAL_CONSUMER_EMAIL_DOMAINS.includes(domain)) return "Personal";
  return "Work";
}

export function isPersonalEmail(email: string): boolean {
  if (!email.includes("@")) return true;
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  return PERSONAL_EMAIL_DOMAINS.includes(domain);
}

export function isFullContact(contact: EnrichedContact): boolean {
  return (
    !!contact.firstName?.trim() &&
    !!contact.lastName?.trim() &&
    !!contact.resolvedEmail?.trim() &&
    !isPersonalEmail(contact.resolvedEmail) &&
    !!contact.resolvedCompany?.trim()
  );
}
