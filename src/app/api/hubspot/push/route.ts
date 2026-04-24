import { handleHubSpotPushRequest } from "@/lib/hubspot/push-handler";

export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  try {
    return await handleHubSpotPushRequest(request);
  } catch (err) {
    return Response.json(
      { error: "Internal server error", detail: String(err) },
      { status: 500 },
    );
  }
}
