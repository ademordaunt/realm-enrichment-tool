import { getHubSpotAccessToken, hubspotFetch } from "@/lib/hubspot/http";
import { normalizeLeadSourceOptions } from "@/lib/hubspot/lead-source-options";

interface HubSpotPropertyOption {
  label: string;
  value: string;
  hidden: boolean;
  [key: string]: unknown;
}

interface HubSpotPropertyResponse {
  options?: HubSpotPropertyOption[];
}

export async function GET(): Promise<Response> {
  try {
    try {
      getHubSpotAccessToken();
    } catch {
      return Response.json(
        { error: "Missing HUBSPOT_ACCESS_TOKEN. Add it to .env.local.", options: [] },
        { status: 500 },
      );
    }

    const res = await hubspotFetch("/crm/v3/properties/contacts/lead_source__deal_source");
    if (!res.ok) {
      const text = await res.text();
      console.error("[hubspot/properties/lead-source] HubSpot error:", res.status, text);
      return Response.json(
        { error: `HubSpot returned ${res.status}`, options: [] },
        { status: 500 },
      );
    }

    const data = (await res.json()) as HubSpotPropertyResponse;
    const options = normalizeLeadSourceOptions(
      (data.options ?? [])
        .filter((opt) => !opt.hidden)
        .map((opt) => ({ label: opt.label, value: opt.value })),
    );

    return Response.json({ options });
  } catch (err) {
    console.error("[hubspot/properties/lead-source] unexpected error:", err);
    return Response.json(
      { error: "Internal server error", options: [] },
      { status: 500 },
    );
  }
}
