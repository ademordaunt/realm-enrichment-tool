import { fetchHubSpotListFolders } from "@/lib/hubspot/list-folders";
import { getHubSpotAccessToken } from "@/lib/hubspot/http";

export async function GET(): Promise<Response> {
  try {
    try {
      getHubSpotAccessToken();
    } catch {
      return Response.json(
        {
          error: "Missing HUBSPOT_ACCESS_TOKEN. Add it to .env.local.",
          detail: "Missing HUBSPOT_ACCESS_TOKEN",
        },
        { status: 500 },
      );
    }

    const folders = await fetchHubSpotListFolders();
    return Response.json({ folders });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Internal server error";
    return Response.json(
      { error: message, detail: String(err) },
      { status: 500 },
    );
  }
}
