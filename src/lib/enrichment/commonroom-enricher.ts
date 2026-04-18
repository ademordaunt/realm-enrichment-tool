import type { EnrichedContact } from "@/lib/utils/types";

type MemberRecord = {
  linkedin?: string;
  organization?: string;
  title?: string;
};

function parseMembersJson(data: unknown): MemberRecord[] {
  if (!Array.isArray(data)) return [];
  return data.filter((m): m is MemberRecord => typeof m === "object" && m !== null) as MemberRecord[];
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

  if (member.linkedin) {
    result.linkedinUrl = member.linkedin.startsWith("http")
      ? member.linkedin
      : `https://www.linkedin.com/${member.linkedin.replace(/^\//, "")}`;
  }
  if (member.organization && contact.confidenceScore !== "high") {
    result.resolvedCompany = member.organization;
  }
  if (member.title && !contact.title) {
    result.title = member.title;
  }

  return result;
}
