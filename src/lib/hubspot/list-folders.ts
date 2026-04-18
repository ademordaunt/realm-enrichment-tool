import { hubspotFetch, readHubSpotError } from "@/lib/hubspot/http";

export type HubSpotFolderRow = { id: string; name: string };

/**
 * Parses HubSpot list folders API JSON into a flat folder list.
 */
export function parseHubSpotFoldersJson(json: unknown): HubSpotFolderRow[] {
  const folders: HubSpotFolderRow[] = [];

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

  return folders;
}

/**
 * Fetches CRM list folders from HubSpot (contacts API path used for list folder tree).
 */
export async function fetchHubSpotListFolders(): Promise<
  { ok: true; folders: HubSpotFolderRow[] } | { ok: false; status: number; message: string }
> {
  const res = await hubspotFetch("/contacts/v1/lists/folders");

  if (!res.ok) {
    const message = await readHubSpotError(res);
    return { ok: false, status: res.status, message };
  }

  const json: unknown = await res.json();
  return { ok: true, folders: parseHubSpotFoldersJson(json) };
}
