let cachedJwt: string | null = null;
/** Epoch ms when the cached token must be refreshed (tokens last ~1 hour) */
let tokenExpiresAt = 0;

/**
 * Returns a valid JWT for ZoomInfo Data API calls, refreshing when expired.
 */
export async function getZoomInfoToken(): Promise<string> {
  const now = Date.now();
  if (cachedJwt && now < tokenExpiresAt - 60_000) {
    return cachedJwt;
  }

  console.log("[ZoomInfo auth] env check:", {
    hasUsername: !!process.env.ZOOMINFO_USERNAME,
    hasPassword: !!process.env.ZOOMINFO_PASSWORD,
    hasClientId: !!process.env.ZOOMINFO_CLIENT_ID,
  });

  // ZOOMINFO_PASSWORD is the user's actual ZoomInfo web account login password (not the API client secret).
  const body = {
    username: process.env.ZOOMINFO_USERNAME,
    password: process.env.ZOOMINFO_PASSWORD,
    client_id: process.env.ZOOMINFO_CLIENT_ID,
  };

  if (
    !body.username?.trim() ||
    !body.password?.trim() ||
    !body.client_id?.trim()
  ) {
    throw new Error(
      "ZoomInfo credentials missing: set ZOOMINFO_USERNAME, ZOOMINFO_PASSWORD, and ZOOMINFO_CLIENT_ID.",
    );
  }

  const res = await fetch("https://api.zoominfo.com/authenticate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ZoomInfo authenticate failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as { jwt?: string };
  if (!json.jwt) {
    throw new Error("ZoomInfo authenticate response missing jwt.");
  }

  cachedJwt = json.jwt;
  tokenExpiresAt = now + 60 * 60 * 1000;
  return cachedJwt;
}

/** Force next call to fetch a new token (e.g. after 401). */
export function invalidateZoomInfoToken(): void {
  cachedJwt = null;
  tokenExpiresAt = 0;
}
