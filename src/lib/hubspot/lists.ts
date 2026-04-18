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
    list?: { listId?: string; id?: string };
    listId?: string;
    id?: string;
  };
  const listId = json.list?.listId ?? json.list?.id ?? json.listId ?? json.id;
  if (!listId) {
    throw new Error("HubSpot did not return listId when creating a list.");
  }
  return String(listId);
}

export async function addRecordsToList(listId: string, recordIds: string[]): Promise<void> {
  if (recordIds.length === 0) return;

  const res = await hubspotFetch(
    `/crm/v3/lists/${encodeURIComponent(listId)}/memberships/add`,
    {
      method: "PUT",
      body: JSON.stringify(recordIds.map((id) => String(id))),
    },
  );

  if (!res.ok) {
    throw new Error(await readHubSpotError(res));
  }
}
