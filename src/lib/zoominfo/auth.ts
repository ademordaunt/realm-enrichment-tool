let cachedAccessToken: string | null = null;
/** Epoch ms when the cached token must be refreshed. */
let tokenExpiresAt = 0;

/**
 * Returns a valid JWT for ZoomInfo Data API calls, refreshing when expired.
 */
export async function getZoomInfoToken(): Promise<string> {
  const now = Date.now();
  if (cachedAccessToken && now < tokenExpiresAt - 60_000) {
    return cachedAccessToken;
  }

  const clientId = process.env.ZOOMINFO_CLIENT_ID?.trim();
  const clientSecret = process.env.ZOOMINFO_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error(
      "ZoomInfo credentials missing: set ZOOMINFO_CLIENT_ID and ZOOMINFO_CLIENT_SECRET.",
    );
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch("https://api.zoominfo.com/gtm/oauth/v1/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ZoomInfo token request failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) {
    throw new Error("ZoomInfo token response missing access_token.");
  }

  cachedAccessToken = json.access_token;
  const expiresInMs = Math.max(1, json.expires_in ?? 3600) * 1000;
  tokenExpiresAt = now + expiresInMs;
  return cachedAccessToken;
}

/** Force next call to fetch a new token (e.g. after 401). */
export function invalidateZoomInfoToken(): void {
  cachedAccessToken = null;
  tokenExpiresAt = 0;
}
