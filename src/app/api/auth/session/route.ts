import { cookies } from "next/headers";

const AUTH_COOKIE = "realm-auth";

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Validates `realm-auth` cookie for client-side session bootstrap on /login. */
export async function GET(): Promise<Response> {
  const appPassword = process.env.APP_PASSWORD?.trim() ?? "";
  if (!appPassword) {
    return Response.json({ error: "APP_PASSWORD is not configured." }, { status: 500 });
  }

  const expectedToken = await sha256Hex(appPassword);
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(AUTH_COOKIE)?.value ?? "";
  if (sessionToken === expectedToken) {
    return Response.json({ ok: true });
  }
  return Response.json({ ok: false }, { status: 401 });
}
