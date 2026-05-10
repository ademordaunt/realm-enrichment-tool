import { readFile } from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const listType = req.nextUrl.searchParams.get("listType");
  if (listType !== "companies" && listType !== "contacts") {
    return NextResponse.json({ error: "Invalid or missing listType" }, { status: 400 });
  }
  const file =
    listType === "companies"
      ? "COMPANYFIELD_TRUST_RULES.html"
      : "CONTACTFIELD_TRUST_RULES.html";
  try {
    const fullPath = path.join(process.cwd(), "docs", file);
    const html = await readFile(fullPath, "utf8");
    return new NextResponse(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch {
    return NextResponse.json({ error: "Trust rules file not found" }, { status: 404 });
  }
}
