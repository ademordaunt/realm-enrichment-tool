import { hubspotFetch, readHubSpotError } from "@/lib/hubspot/http";

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
          body: JSON.stringify(chunk.map((id) => String(id))),
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
