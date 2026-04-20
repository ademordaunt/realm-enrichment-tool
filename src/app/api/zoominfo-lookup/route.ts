import { NextResponse } from "next/server";
import { getZoomInfoToken } from "@/lib/zoominfo/auth";

export async function GET() {
  try {
    const token = await getZoomInfoToken();

    const url =
      "https://api.zoominfo.com/gtm/data/v1/lookup/enrich?" +
      new URLSearchParams({
        "filter[entity]": "contact",
        "filter[fieldType]": "output",
      }).toString();

    console.log("[ZoomInfo Lookup] URL:", url);
    console.log("[ZoomInfo Lookup] Token present:", !!token);

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.api+json",
        "Content-Type": "application/vnd.api+json",
      },
    });

    console.log("[ZoomInfo Lookup] status:", res.status);
    console.log("[ZoomInfo Lookup] content-type:", res.headers.get("content-type"));

    const text = await res.text();
    console.log("[ZoomInfo Lookup] raw response (first 500 chars):", text.slice(0, 500));

    try {
      const data = JSON.parse(text);
      return NextResponse.json(data);
    } catch {
      return NextResponse.json({
        error: "Non-JSON response",
        raw: text.slice(0, 1000),
        status: res.status,
      });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message });
  }
}
