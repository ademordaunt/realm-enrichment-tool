import { Redis } from "@upstash/redis";
import { isRecord } from "@/lib/utils/guards";

const kv = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

export const maxDuration = 9;

type LinkedInSearchContact = {
  firstName?: string;
  lastName?: string;
  title?: string;
  company?: string;
  resolvedCompany?: string;
  rawCompany?: string;
  rawEmail?: string;
  resolvedEmail?: string;
  email?: string;
  linkedinUrl?: string;
};

type LinkedInSearchCompany = {
  rawInput?: string;
  resolvedName?: string;
  domain?: string;
  linkedinUrl?: string;
};

function normalizeEmailKey(contact: LinkedInSearchContact): string {
  const email =
    contact.email?.trim() ||
    contact.rawEmail?.trim() ||
    contact.resolvedEmail?.trim() ||
    "";
  return email.toLowerCase();
}

function getCachedKey(email: string): string {
  return `linkedin:contact:${email}`;
}

function getCompanyCacheKey(company: LinkedInSearchCompany): string {
  const name = String(company.resolvedName ?? company.rawInput ?? "")
    .trim()
    .toLowerCase();
  const domain = String(company.domain ?? "")
    .trim()
    .toLowerCase();
  return `linkedin:company:${name}|${domain}`;
}

function parseLinkedInUrl(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as { linkedInUrl?: unknown; linkedinUrl?: unknown };
    const raw = parsed.linkedInUrl ?? parsed.linkedinUrl;
    const value = raw == null ? "" : String(raw).trim();
    return value || null;
  } catch {
    const match = text.match(/https?:\/\/www\.linkedin\.com\/in\/[^\s"'}]+/i);
    return match?.[0]?.trim() || null;
  }
}

/** Prefer `linkedin.com/company/` URLs from model output or raw text. */
function parseLinkedInCompanyUrl(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as { linkedInUrl?: unknown; linkedinUrl?: unknown };
    const raw = parsed.linkedInUrl ?? parsed.linkedinUrl;
    const value = raw == null ? "" : String(raw).trim();
    if (!value) return null;
    return /linkedin\.com\/company\//i.test(value) ? value : null;
  } catch {
    const match = text.match(/https?:\/\/(?:www\.)?linkedin\.com\/company\/[^\s"'}]+/i);
    return match?.[0]?.trim() || null;
  }
}

async function handleCompanyLinkedInSearch(
  company: LinkedInSearchCompany,
): Promise<Response> {
  const existing = String(company.linkedinUrl ?? "").trim();
  if (existing) {
    return Response.json({ linkedInUrl: existing, linkedinSource: "ai_search" as const });
  }

  const cacheKey = getCompanyCacheKey(company);
  if (cacheKey !== "linkedin:company:|") {
    try {
      const cached = await kv.get<string>(cacheKey);
      if (cached?.trim()) {
        return Response.json({ linkedInUrl: cached.trim(), linkedinSource: "ai_search" as const });
      }
    } catch {
      // Best effort cache read.
    }
  }

  const name = String(company.resolvedName ?? company.rawInput ?? "").trim();
  const domain = String(company.domain ?? "").trim();
  const query = `${name}${domain ? ` ${domain}` : ""} LinkedIn company page`.trim();

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    return Response.json({ linkedInUrl: null });
  }

  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 512,
      system:
        'You are a LinkedIn company page URL finder. Use web_search to find the official LinkedIn company page URL. Return ONLY valid JSON: {"linkedInUrl": "https://www.linkedin.com/company/..." } or {"linkedInUrl": null} if not found. No other text.',
      messages: [
        {
          role: "user",
          content: query,
        },
      ],
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
          max_uses: 2,
        },
      ],
    }),
  });

  if (!anthropicRes.ok) {
    const errText = await anthropicRes.text().catch(() => "");
    const lowered = errText.toLowerCase();
    if (
      lowered.includes("web_search") ||
      lowered.includes("tool") ||
      anthropicRes.status === 400
    ) {
      return Response.json({ linkedInUrl: null });
    }
    return Response.json({ linkedInUrl: null });
  }

  const json = (await anthropicRes.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  const text = (json.content ?? [])
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text ?? "")
    .join("\n")
    .trim();
  const linkedInUrl = text ? parseLinkedInCompanyUrl(text) : null;

  if (linkedInUrl) {
    if (cacheKey !== "linkedin:company:|") {
      try {
        await kv.set(cacheKey, linkedInUrl, { ex: 60 * 60 * 24 * 30 });
      } catch {
        // Best effort cache write.
      }
    }
  }

  return Response.json({ linkedInUrl, linkedinSource: "ai_search" as const });
}

export async function POST(request: Request): Promise<Response> {
  try {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ linkedInUrl: null });
  }
  if (!isRecord(body)) {
    return Response.json({ linkedInUrl: null });
  }

  if (isRecord(body.company)) {
    return handleCompanyLinkedInSearch(body.company as LinkedInSearchCompany);
  }

  if (!isRecord(body.contact)) {
    return Response.json({ linkedInUrl: null });
  }

  const contact = body.contact as LinkedInSearchContact;
  const existing = String(contact.linkedinUrl ?? "").trim();
  if (existing) {
    return Response.json({ linkedInUrl: existing, linkedinSource: "ai_search" as const });
  }

  const emailKey = normalizeEmailKey(contact);
  if (emailKey) {
    try {
      const cached = await kv.get<string>(getCachedKey(emailKey));
      if (cached?.trim()) {
        return Response.json({ linkedInUrl: cached.trim(), linkedinSource: "ai_search" as const });
      }
    } catch {
      // Best effort cache read.
    }
  }

  const firstName = String(contact.firstName ?? "").trim();
  const lastName = String(contact.lastName ?? "").trim();
  const title = String(contact.title ?? "").trim();
  const company = String(
    contact.resolvedCompany ?? contact.company ?? contact.rawCompany ?? "",
  ).trim();

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    return Response.json({ linkedInUrl: null });
  }

  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 512,
      system:
        'You are a LinkedIn profile URL finder. Use web_search to find the LinkedIn profile URL for the given person. Return ONLY valid JSON: {"linkedInUrl": "https://www.linkedin.com/in/..." } or {"linkedInUrl": null} if not found. No other text.',
      messages: [
        {
          role: "user",
          content: `Find LinkedIn URL for: ${firstName} ${lastName}, ${title} at ${company}`,
        },
      ],
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
          max_uses: 2,
        },
      ],
    }),
  });

  if (!anthropicRes.ok) {
    const errText = await anthropicRes.text().catch(() => "");
    const lowered = errText.toLowerCase();
    if (
      lowered.includes("web_search") ||
      lowered.includes("tool") ||
      anthropicRes.status === 400
    ) {
      return Response.json({ linkedInUrl: null });
    }
    return Response.json({ linkedInUrl: null });
  }

  const json = (await anthropicRes.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  const text = (json.content ?? [])
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text ?? "")
    .join("\n")
    .trim();
  const linkedInUrl = text ? parseLinkedInUrl(text) : null;

  if (linkedInUrl) {
    if (emailKey) {
      try {
        await kv.set(getCachedKey(emailKey), linkedInUrl, { ex: 60 * 60 * 24 * 30 });
      } catch {
        // Best effort cache write.
      }
    }
  }

  return Response.json({ linkedInUrl, linkedinSource: "ai_search" as const });
  } catch (err) {
    console.error("[enrich/linkedin-search] unexpected error:", err);
    return Response.json(
      { error: "Internal server error", detail: "LinkedIn search failed. Please try again." },
      { status: 500 },
    );
  }
}
