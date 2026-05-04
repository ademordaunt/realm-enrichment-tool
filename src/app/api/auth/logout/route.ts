import { cookies } from "next/headers";

const AUTH_COOKIE = "realm-auth";

export async function POST(): Promise<Response> {
  const cookieStore = await cookies();
  cookieStore.set(AUTH_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  return Response.json({ ok: true });
}
