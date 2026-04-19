import { hubspotFetch } from "@/lib/hubspot/http";

export type HubSpotFolderRow = { id: string; name: string };

/** Used when the HubSpot API returns nothing or errors so the folder dropdown always works. */
export const FALLBACK_FOLDERS: HubSpotFolderRow[] = [
  { id: "cisoexecnet", name: "CISOExecNet" },
  { id: "cyalliance", name: "CyAlliance" },
  { id: "cyalliance-post-event", name: "CyAlliance — CyAlliance Post-Event" },
  { id: "cyalliance-pre-event", name: "CyAlliance — CyAlliance Pre-Event" },
];

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
 * Fetches CRM list folders from HubSpot (CRM v3 lists folders).
 * On failure or empty results, returns {@link FALLBACK_FOLDERS}.
 */
export async function fetchHubSpotListFolders(): Promise<HubSpotFolderRow[]> {
  try {
    const res = await hubspotFetch("/crm/v3/lists/folders");
    if (!res.ok) {
      return [...FALLBACK_FOLDERS];
    }
    const json: unknown = await res.json();
    const folders = parseHubSpotFoldersJson(json);
    if (folders.length === 0) {
      return [...FALLBACK_FOLDERS];
    }
    return folders;
  } catch {
    return [...FALLBACK_FOLDERS];
  }
}
