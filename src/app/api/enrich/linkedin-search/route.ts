import { kv } from "@vercel/kv";

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

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

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

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ linkedInUrl: null });
  }
  if (!isRecord(body) || !isRecord(body.contact)) {
    return Response.json({ linkedInUrl: null });
  }

  const contact = body.contact as LinkedInSearchContact;
  const existing = String(contact.linkedinUrl ?? "").trim();
  if (existing) {
    return Response.json({ linkedInUrl: existing });
  }

  const emailKey = normalizeEmailKey(contact);
  if (emailKey) {
    try {
      const cached = await kv.get<string>(getCachedKey(emailKey));
      if (cached?.trim()) {
        return Response.json({ linkedInUrl: cached.trim() });
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
    console.log(
      "[LinkedIn Search] Found URL for",
      firstName,
      lastName,
      "→",
      linkedInUrl,
    );
    if (emailKey) {
      try {
        await kv.set(getCachedKey(emailKey), linkedInUrl, { ex: 60 * 60 * 24 * 30 });
      } catch {
        // Best effort cache write.
      }
    }
  }

  return Response.json({ linkedInUrl });
}
