import { getHubSpotAccessToken, hubspotFetch, readHubSpotError } from "@/lib/hubspot/http";

export async function GET() {
  try {
    getHubSpotAccessToken();
  } catch {
    return Response.json(
      { error: "Missing HUBSPOT_ACCESS_TOKEN. Add it to .env.local." },
      { status: 500 },
    );
  }

  const res = await hubspotFetch("/contacts/v1/lists/folders");

  if (!res.ok) {
    const message = await readHubSpotError(res);
    return Response.json({ error: message, folders: [] }, { status: res.status });
  }

  const json = (await res.json()) as unknown;
  const folders: { id: string; name: string }[] = [];

  if (Array.isArray(json)) {
    for (const item of json) {
      if (item && typeof item === "object" && "id" in item && "name" in item) {
        const o = item as { id: unknown; name: unknown };
        folders.push({ id: String(o.id), name: String(o.name) });
      }
    }
  } else if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    const list =
      (Array.isArray(o.objects) && o.objects) ||
      (Array.isArray(o.folders) && o.folders) ||
      (Array.isArray(o.results) && o.results) ||
      [];
    for (const item of list) {
      if (item && typeof item === "object" && "id" in item && "name" in item) {
        const row = item as { id: unknown; name: unknown };
        folders.push({ id: String(row.id), name: String(row.name) });
      }
    }
  }

  return Response.json({ folders });
}
