import type { EnrichedCompany, EnrichedContact } from "@/lib/utils/types";

const BASE = "https://api.commonroom.io/community/v1";

function getApiKey(): string | null {
  return process.env.COMMON_ROOM_API_KEY?.trim() ?? null;
}

/** `in/username` or full URL → handle segment for query param */
function linkedinQueryValue(linkedinUrl: string): string | null {
  const u = linkedinUrl.trim();
  if (!u) return null;
  if (u.includes("linkedin.com")) {
    const path = u.split("linkedin.com")[1] ?? "";
    const trimmed = path.replace(/^\//, "").replace(/\/$/, "");
    return trimmed || null;
  }
  return u.replace(/^in\//, "");
}

type MemberRecord = {
  linkedin?: string;
  email?: string;
  title?: string;
  organization?: string;
};

function firstMember(json: unknown): MemberRecord | null {
  if (!Array.isArray(json) || json.length === 0) return null;
  const m = json[0];
  if (typeof m !== "object" || m === null) return null;
  const o = m as Record<string, unknown>;
  return {
    linkedin: typeof o.linkedin === "string" ? o.linkedin : undefined,
    email: typeof o.email === "string" ? o.email : undefined,
    title: typeof o.title === "string" ? o.title : undefined,
    organization: typeof o.organization === "string" ? o.organization : undefined,
  };
}

async function fetchMembers(
  params: URLSearchParams,
): Promise<MemberRecord | null> {
  const key = getApiKey();
  if (!key) {
    return null;
  }
  const url = `${BASE}/members?${params.toString()}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    return null;
  }
  const json: unknown = await res.json();
  return firstMember(json);
}

/**
 * Best-effort LinkedIn lookup using Common Room members API (email or LinkedIn handle).
 */
export async function enrichCompanyWithCommonRoom(
  company: EnrichedCompany,
): Promise<Partial<EnrichedCompany>> {
  const key = getApiKey();
  if (!key) return {};

  const li = company.linkedinUrl?.trim();
  if (li) {
    const q = linkedinQueryValue(li);
    if (q) {
      const p = new URLSearchParams();
      p.set("linkedin", q);
      const m = await fetchMembers(p);
      if (m?.linkedin) {
        const url = m.linkedin.startsWith("http")
          ? m.linkedin
          : `https://www.linkedin.com/${m.linkedin.replace(/^\//, "")}`;
        return {
          linkedinUrl: url,
          enrichedByCommonRoom: true,
        };
      }
    }
  }

  return {};
}

export async function enrichContactWithCommonRoom(
  contact: EnrichedContact,
): Promise<Partial<EnrichedContact>> {
  const key = getApiKey();
  if (!key) return {};

  const email = contact.resolvedEmail?.trim() || contact.rawEmail?.trim();
  if (email) {
    const p = new URLSearchParams();
    p.set("email", email);
    const m = await fetchMembers(p);
    if (m) {
      const out: Partial<EnrichedContact> = { enrichedByCommonRoom: true };
      if (m.linkedin) {
        out.linkedinUrl = m.linkedin.startsWith("http")
          ? m.linkedin
          : `https://www.linkedin.com/${m.linkedin.replace(/^\//, "")}`;
      }
      if (m.email) {
        out.resolvedEmail = m.email;
      }
      return out;
    }
  }

  const li = contact.linkedinUrl?.trim();
  if (li) {
    const q = linkedinQueryValue(li);
    if (q) {
      const p = new URLSearchParams();
      p.set("linkedin", q);
      const m = await fetchMembers(p);
      if (m) {
        const out: Partial<EnrichedContact> = { enrichedByCommonRoom: true };
        if (m.linkedin) {
          out.linkedinUrl = m.linkedin.startsWith("http")
            ? m.linkedin
            : `https://www.linkedin.com/${m.linkedin.replace(/^\//, "")}`;
        }
        if (m.email) {
          out.resolvedEmail = m.email;
        }
        return out;
      }
    }
  }

  return {};
}
