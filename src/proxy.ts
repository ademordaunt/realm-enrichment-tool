import { NextRequest, NextResponse } from "next/server";

const AUTH_COOKIE = "realm-auth";
const INTERNAL_AUTH_HEADER = "x-realm-internal-auth";

function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname.startsWith("/api/auth/login") ||
    pathname.startsWith("/api/auth/session")
  );
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hasValidInternalAuth(request: NextRequest): boolean {
  const expected = process.env.INTERNAL_API_SECRET?.trim() ?? "";
  if (!expected) return false;
  const provided = request.headers.get(INTERNAL_AUTH_HEADER)?.trim() ?? "";
  return provided !== "" && provided === expected;
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();
  if (hasValidInternalAuth(request)) return NextResponse.next();

  const appPassword = process.env.APP_PASSWORD;
  if (!appPassword) {
    return NextResponse.json(
      { error: "APP_PASSWORD is not configured." },
      { status: 500 },
    );
  }

  const expectedToken = await sha256Hex(appPassword);
  const sessionToken = request.cookies.get(AUTH_COOKIE)?.value ?? "";
  if (sessionToken === expectedToken) return NextResponse.next();

  const loginUrl = new URL("/login", request.url);
  const nextPath = `${pathname}${search}`;
  if (nextPath && nextPath !== "/") {
    loginUrl.searchParams.set("next", nextPath);
  }
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
