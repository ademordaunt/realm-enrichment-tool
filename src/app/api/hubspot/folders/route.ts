import { fetchHubSpotListFolders } from "@/lib/hubspot/list-folders";
import { getHubSpotAccessToken } from "@/lib/hubspot/http";

export async function GET(): Promise<Response> {
  try {
    getHubSpotAccessToken();
  } catch {
    return Response.json(
      { error: "Missing HUBSPOT_ACCESS_TOKEN. Add it to .env.local." },
      { status: 500 },
    );
  }

  const folders = await fetchHubSpotListFolders();
  return Response.json({ folders });
}
