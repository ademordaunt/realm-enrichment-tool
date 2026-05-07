import { NextResponse } from "next/server";

export const maxDuration = 9;

// Prospector REST API does not exist yet in Common Room.
// This route is a stub pending Common Room's response on adding a REST endpoint.
// See: https://github.com/your-repo/issues for tracking.
export async function POST(req: Request): Promise<Response> {
  void req;
  try {
    return NextResponse.json({ results: [] });
  } catch (err) {
    console.error("[enrich/prospector] unexpected error:", err);
    return Response.json(
      { error: "Internal server error", detail: "Prospector request failed. Please try again." },
      { status: 500 },
    );
  }
}
