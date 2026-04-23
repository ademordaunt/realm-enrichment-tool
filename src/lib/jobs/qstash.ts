import { Client } from "@upstash/qstash";

export type JobPhase = "ai" | "zoominfo" | "linkedin";

type QueuePayload = {
  jobId: string;
  chunkIndex: number;
  phase: JobPhase;
};

export function getJobsCallbackUrl(): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${appUrl}/api/jobs/process`;
}

export async function queueJobChunk(payload: QueuePayload): Promise<void> {
  const token = process.env.QSTASH_TOKEN;
  if (process.env.NODE_ENV === "development") {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    void fetch(`${appUrl}/api/jobs/process`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(async (res) => {
        if (!res.ok) {
          const errText = await res.text().catch(() => "unknown");
          console.error(`[Dev] jobs/process failed: ${res.status} ${errText}`);
        }
      })
      .catch((err) => {
        console.error("[Dev] jobs/process request error:", err);
      });
    return;
  }

  if (!token) {
    throw new Error("Missing QSTASH_TOKEN");
  }
  const client = new Client({ token });
  await client.publishJSON({
    url: getJobsCallbackUrl(),
    body: payload,
    retries: 3,
  });
}
