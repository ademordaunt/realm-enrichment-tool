import type { EnrichedContact } from "@/lib/utils/types";

const PERSONAL_EMAIL_DOMAINS = [
  "gmail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "icloud.com",
  "aol.com",
  "protonmail.com",
  "live.com",
  "msn.com",
  "me.com",
];

export function isPersonalEmail(email: string): boolean {
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
