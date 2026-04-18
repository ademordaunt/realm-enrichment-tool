import { handleHubSpotPushRequest } from "@/lib/hubspot/push-handler";

export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  return handleHubSpotPushRequest(request);
}
