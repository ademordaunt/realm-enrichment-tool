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

export async function POST(request: Request): Promise<Response> {
  const appPassword = process.env.APP_PASSWORD?.trim() ?? "";
  if (!appPassword) {
    return Response.json({ error: "APP_PASSWORD is not configured." }, { status: 500 });
  }

  let payload: { password?: string };
  try {
    payload = (await request.json()) as { password?: string };
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const candidate = String(payload.password ?? "");
  if (candidate !== appPassword) {
    return Response.json({ error: "Incorrect password" }, { status: 401 });
  }

  const token = await sha256Hex(appPassword);
  const cookieStore = await cookies();
  cookieStore.set(AUTH_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return Response.json({ ok: true });
}
