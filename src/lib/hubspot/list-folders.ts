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
      // HubSpot may use childFolders, childNodes, or children depending on API version
      walkFolderNodes(
        folderNode.childFolders ?? folderNode.childNodes ?? folderNode.children,
      );
    }
  };

  if (Array.isArray(json)) {
    walkFolderNodes(json);
  } else if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    const folder = o.folder;
    if (folder && typeof folder === "object") {
      const f = folder as Record<string, unknown>;
      walkFolderNodes(f.childFolders ?? f.childNodes ?? f.children);
    }
    const list =
      (Array.isArray(o.objects) && o.objects) ||
      (Array.isArray(o.folders) && o.folders) ||
      (Array.isArray(o.results) && o.results) ||
      [];
    walkFolderNodes(list);
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
