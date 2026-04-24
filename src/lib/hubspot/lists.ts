import { hubspotFetch, readHubSpotError } from "@/lib/hubspot/http";

export async function createStaticList(name: string, objectTypeId: string): Promise<string> {
  const res = await hubspotFetch("/crm/v3/lists", {
    method: "POST",
    body: JSON.stringify({
      name,
      objectTypeId,
      processingType: "MANUAL",
    }),
  });

  if (!res.ok) {
    throw new Error(await readHubSpotError(res));
  }

  const json = (await res.json()) as {
    list?: { listId?: string | number; id?: string | number; hs_list_id?: string | number };
    listId?: string | number;
    id?: string | number;
    hs_list_id?: string | number;
    list_id?: string | number;
    objectId?: string | number;
    object_id?: string | number;
  };
  console.log("[HubSpot] createStaticList raw response:", json);
  const listId =
    json.list?.listId ??
    json.list?.id ??
    json.list?.hs_list_id ??
    json.listId ??
    json.id ??
    json.hs_list_id ??
    json.list_id ??
    json.objectId ??
    json.object_id;
  if (!listId) {
    throw new Error("HubSpot did not return listId when creating a list.");
  }
  return String(listId);
}

const LIST_MEMBERSHIP_CHUNK_SIZE = 100;

export async function addRecordsToList(listId: string, recordIds: string[]): Promise<void> {
  if (recordIds.length === 0) return;

  for (let i = 0; i < recordIds.length; i += LIST_MEMBERSHIP_CHUNK_SIZE) {
    const chunk = recordIds.slice(i, i + LIST_MEMBERSHIP_CHUNK_SIZE);

    let lastError: string | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await hubspotFetch(
        `/crm/v3/lists/${encodeURIComponent(listId)}/memberships/add`,
        {
          method: "PUT",
          body: JSON.stringify({ recordIds: chunk.map((id) => String(id)) }),
        },
      );
      if (res.ok) {
        lastError = null;
        break;
      }
      const rawText = await res.clone().text();
      console.error("[HubSpot] addRecordsToList chunk failed", {
        chunkIndex: Math.floor(i / LIST_MEMBERSHIP_CHUNK_SIZE) + 1,
        attempt,
        status: res.status,
        body: rawText,
      });
      lastError = await readHubSpotError(res);
      if (attempt < 1) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    if (lastError) {
      const chunkIndex = Math.floor(i / LIST_MEMBERSHIP_CHUNK_SIZE) + 1;
      throw new Error(`Failed to add records to list (chunk ${chunkIndex}): ${lastError}`);
    }
  }
}
