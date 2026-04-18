const HUBSPOT_API = "https://api.hubapi.com";

export function getHubSpotAccessToken(): string {
  const t = process.env.HUBSPOT_ACCESS_TOKEN?.trim();
  if (!t) {
    throw new Error("Missing HUBSPOT_ACCESS_TOKEN.");
  }
  return t;
}

/** HubSpot CRM fetch with Bearer auth. Retries once after 500ms on HTTP 429. */
export async function hubspotFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getHubSpotAccessToken();
  const url = path.startsWith("http") ? path : `${HUBSPOT_API}${path}`;
  const headers = new Headers(init.headers);
  if (!headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (init.body != null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let res = await fetch(url, { ...init, headers });

  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 500));
    res = await fetch(url, { ...init, headers });
  }

  return res;
}

export async function readHubSpotError(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const j = JSON.parse(text) as { message?: string; errors?: { message?: string }[] };
    if (j.message) return j.message;
    if (j.errors?.[0]?.message) return j.errors[0].message!;
  } catch {
    /* ignore */
  }
  return text || `HTTP ${res.status}`;
}
