import type { EnrichedContact } from "@/lib/utils/types";

interface MemberRecord {
  fullName?: string;
  organization?: string;
  organization_domain?: string;
  title?: string;
  linkedin?: string[] | string;
  email?: Array<{ email: string; sources: string[] }> | string;
  location?: { raw?: string; city?: string; region?: string; country?: string };
  [key: string]: unknown;
}

function parseMembersJson(data: unknown): MemberRecord[] {
  if (!Array.isArray(data)) return [];
  return data.filter(
    (m): m is MemberRecord => typeof m === "object" && m !== null,
  ) as MemberRecord[];
}

/**
 * Common Room contact enrichment — GET /community/v1/members (email, then LinkedIn).
 * Returns {} on any error, empty response, or non-OK status — never throws.
 */
export async function enrichContactWithCommonRoom(
  contact: EnrichedContact,
): Promise<Partial<EnrichedContact>> {
  const apiKey = process.env.COMMON_ROOM_API_KEY;
  if (!apiKey) return {};

  const emailToTry = !contact.isPersonalEmail ? contact.rawEmail?.trim() : null;

  let members: MemberRecord[] = [];

  if (emailToTry) {
    try {
      const res = await fetch(
        `https://api.commonroom.io/community/v1/members?email=${encodeURIComponent(emailToTry)}`,
        { headers: { Authorization: `Bearer ${apiKey}` } },
      );
      if (res.ok) {
        const json: unknown = await res.json().catch(() => null);
        members = parseMembersJson(json);
      }
    } catch {
      return {};
    }
  }

  if (members.length === 0 && contact.linkedinUrl?.trim()) {
    try {
      const handle = contact.linkedinUrl.replace(/^https?:\/\/(www\.)?linkedin\.com\//i, "");
      const res = await fetch(
        `https://api.commonroom.io/community/v1/members?linkedin=${encodeURIComponent(handle)}`,
        { headers: { Authorization: `Bearer ${apiKey}` } },
      );
      if (res.ok) {
        const json: unknown = await res.json().catch(() => null);
        members = parseMembersJson(json);
      }
    } catch {
      return {};
    }
  }

  if (!members.length) return {};

  const member = members[0]!;
  const result: Partial<EnrichedContact> = { enrichedByCommonRoom: true };

  const linkedinRaw =
    Array.isArray(member.linkedin) && member.linkedin.length > 0
      ? member.linkedin[0]
      : typeof member.linkedin === "string"
        ? member.linkedin
        : null;

  if (linkedinRaw && typeof linkedinRaw === "string" && linkedinRaw.trim()) {
    const li = linkedinRaw.trim();
    result.linkedinUrl = li.startsWith("http")
      ? li
      : `https://www.linkedin.com/${li.replace(/^\//, "")}`;
  }

  const emailEntry =
    Array.isArray(member.email) && member.email.length > 0
      ? member.email[0]
      : null;
  const emailValue =
    emailEntry?.email ??
    (typeof member.email === "string" ? member.email : null);
  if (emailValue && typeof emailValue === "string" && contact.isPersonalEmail) {
    result.resolvedEmail = emailValue;
  }

  if (member.organization && typeof member.organization === "string") {
    result.resolvedCompany = member.organization;
  }

  if (member.title && typeof member.title === "string") {
    result.title = member.title;
  }

  if (member.location?.region && typeof member.location.region === "string") {
    result.location = member.location.region;
  }

  return result;
}
