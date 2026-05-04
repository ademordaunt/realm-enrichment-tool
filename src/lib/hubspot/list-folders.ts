import { hubspotFetch } from "@/lib/hubspot/http";

export type HubSpotFolderRow = { id: string; name: string };

/**
 * Parses HubSpot list folders API JSON into a flat folder list.
 */
export function parseHubSpotFoldersJson(json: unknown): HubSpotFolderRow[] {
  const folders: HubSpotFolderRow[] = [];
  const walkFolderNodes = (nodes: unknown): void => {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;
      const folderNode = node as Record<string, unknown>;
      const name = folderNode.name;
      const id = folderNode.id;
      if (name != null && id != null) {
        folders.push({ id: String(id), name: String(name) });
      }
      walkFolderNodes(folderNode.childNodes);
    }
  };

  if (Array.isArray(json)) {
    for (const item of json) {
      if (item && typeof item === "object" && "id" in item && "name" in item) {
        const o = item as { id: unknown; name: unknown };
        folders.push({ id: String(o.id), name: String(o.name) });
      }
    }
  } else if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    const folder = o.folder;
    if (folder && typeof folder === "object") {
      walkFolderNodes((folder as Record<string, unknown>).childNodes);
    }
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
 * On failure or empty results, returns an empty array.
 */
export async function fetchHubSpotListFolders(): Promise<HubSpotFolderRow[]> {
  try {
    const [contactsRes, companiesRes] = await Promise.all([
      hubspotFetch("/crm/v3/lists/folders?objectTypeId=0-1"),
      hubspotFetch("/crm/v3/lists/folders?objectTypeId=0-2"),
    ]);
    const contactsRawBody = await contactsRes.clone().text();
    const companiesRawBody = await companiesRes.clone().text();
    console.log("[HubSpot Folders] contacts status:", contactsRes.status);
    console.log("[HubSpot Folders] contacts raw body:", contactsRawBody);
    console.log("[HubSpot Folders] companies status:", companiesRes.status);
    console.log("[HubSpot Folders] companies raw body:", companiesRawBody);

    const combined: HubSpotFolderRow[] = [];
    if (contactsRes.ok) {
      const contactsJson: unknown = await contactsRes.json();
      combined.push(...parseHubSpotFoldersJson(contactsJson));
    }
    if (companiesRes.ok) {
      const companiesJson: unknown = await companiesRes.json();
      combined.push(...parseHubSpotFoldersJson(companiesJson));
    }

    const deduped = new Map<string, HubSpotFolderRow>();
    for (const folder of combined) {
      if (!deduped.has(folder.id)) deduped.set(folder.id, folder);
    }
    return [...deduped.values()];
  } catch {
    return [];
  }
}
