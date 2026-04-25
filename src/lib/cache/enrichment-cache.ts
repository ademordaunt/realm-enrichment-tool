import { Redis } from "@upstash/redis";
import type {
  BulkJobState,
  EnrichedCompany,
  EnrichedContact,
} from "@/lib/utils/types";

const kv = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const COMPANY_TTL = 60 * 60 * 24 * 30; // 30 days in seconds
const CONTACT_TTL = 60 * 60 * 24 * 30;
const JOB_TTL = 60 * 60 * 24 * 7;
const RAW_SHARD_LIMIT_BYTES = 800 * 1024;

function normalizeCompanyKey(name: string): string {
  return `company:${name.toLowerCase().trim().replace(/[^a-z0-9]/g, "_")}`;
}

function normalizeContactKey(email: string): string {
  return `contact:${email.toLowerCase().trim()}`;
}

export async function getCachedCompany(name: string): Promise<EnrichedCompany | null> {
  try {
    const result = await kv.get<EnrichedCompany>(normalizeCompanyKey(name));
    if (!result) return null;
    const hasLinkedInUrl = typeof result.linkedinUrl === "string" && result.linkedinUrl.trim() !== "";
    const hasLinkedInSource = typeof result.linkedinSource === "string" && result.linkedinSource.trim() !== "";
    if (hasLinkedInUrl && !hasLinkedInSource) {
      return {
        ...result,
        linkedinSource: result.enrichedByZoomInfo === true ? "zoominfo" : "hubspot",
      };
    }
    return result;
  } catch {
    return null; // Never let cache errors block enrichment
  }
}

export async function setCachedCompany(name: string, data: EnrichedCompany): Promise<void> {
  try {
    await kv.set(normalizeCompanyKey(name), data, { ex: COMPANY_TTL });
  } catch {
    // Silently fail — caching is best-effort
  }
}

export async function getCachedContact(email: string): Promise<EnrichedContact | null> {
  try {
    const result = await kv.get<EnrichedContact>(normalizeContactKey(email));
    return result ?? null;
  } catch {
    return null;
  }
}

export async function setCachedContact(email: string, data: EnrichedContact): Promise<void> {
  try {
    await kv.set(normalizeContactKey(email), data, { ex: CONTACT_TTL });
  } catch {
    // Silently fail
  }
}

export async function checkKvConnectivity(): Promise<void> {
  try {
    await kv.set("__health_check__", "1", { ex: 10 });
    const val = await kv.get("__health_check__");
    if (val !== "1") {
      console.error("[Cache] KV health check failed — reads not returning written values");
    } else {
      console.log("[Cache] KV connected and healthy");
    }
  } catch (err) {
    console.error(
      "[Cache] KV connectivity failed — caching disabled. Check KV_REST_API_URL and KV_REST_API_TOKEN env vars.",
      String(err),
    );
  }
}

function jobMetaKey(jobId: string): string {
  return `job:${jobId}:meta`;
}

function jobRawKey(jobId: string): string {
  return `job:${jobId}:raw`;
}

function jobRawShardKey(jobId: string, shardIndex: number): string {
  return `job:${jobId}:raw:${shardIndex}`;
}

function jobRawMetaKey(jobId: string): string {
  return `job:${jobId}:raw:meta`;
}

function jobRowsKey(jobId: string, chunkIndex: number): string {
  return `job:${jobId}:rows:${chunkIndex}`;
}

export async function setJobState(jobId: string, state: BulkJobState): Promise<void> {
  await kv.set(jobMetaKey(jobId), state, { ex: JOB_TTL });
}

export async function getJobState(jobId: string): Promise<BulkJobState | null> {
  const state = await kv.get<BulkJobState>(jobMetaKey(jobId));
  return state ?? null;
}

export async function setJobRawRows(jobId: string, rows: unknown[]): Promise<void> {
  const raw = JSON.stringify(rows);
  const size = Buffer.byteLength(raw, "utf8");
  if (size <= RAW_SHARD_LIMIT_BYTES) {
    await kv.set(jobRawKey(jobId), rows, { ex: JOB_TTL });
    await kv.del(jobRawMetaKey(jobId));
    return;
  }

  const shards: unknown[][] = [];
  let current: unknown[] = [];
  for (const row of rows) {
    current.push(row);
    const shardSize = Buffer.byteLength(JSON.stringify(current), "utf8");
    if (shardSize > RAW_SHARD_LIMIT_BYTES) {
      current.pop();
      if (current.length > 0) shards.push(current);
      current = [row];
    }
  }
  if (current.length > 0) shards.push(current);

  await Promise.all(
    shards.map((shardRows, shardIndex) =>
      kv.set(jobRawShardKey(jobId, shardIndex), shardRows, { ex: JOB_TTL }),
    ),
  );
  await kv.set(jobRawMetaKey(jobId), { shards: shards.length }, { ex: JOB_TTL });
  await kv.del(jobRawKey(jobId));
}

export async function getJobRawRows(jobId: string): Promise<unknown[] | null> {
  const rawSingle = await kv.get<unknown[]>(jobRawKey(jobId));
  if (Array.isArray(rawSingle)) return rawSingle;

  const meta = await kv.get<{ shards?: number }>(jobRawMetaKey(jobId));
  const shardCount = Number(meta?.shards ?? 0);
  if (!Number.isFinite(shardCount) || shardCount <= 0) return null;

  const shards = await Promise.all(
    Array.from({ length: shardCount }, (_, i) => kv.get<unknown[]>(jobRawShardKey(jobId, i))),
  );
  const out: unknown[] = [];
  for (const shard of shards) {
    if (Array.isArray(shard)) out.push(...shard);
  }
  return out;
}

export async function appendJobEnrichedRows(
  jobId: string,
  chunkIndex: number,
  rows: unknown[],
): Promise<void> {
  await kv.set(jobRowsKey(jobId, chunkIndex), rows, { ex: JOB_TTL });
}

export async function getJobEnrichedRows(jobId: string, totalChunks: number): Promise<unknown[]> {
  const chunks = await Promise.all(
    Array.from({ length: totalChunks }, (_, i) => kv.get<unknown[]>(jobRowsKey(jobId, i))),
  );
  const out: unknown[] = [];
  for (const chunk of chunks) {
    if (Array.isArray(chunk)) out.push(...chunk);
  }
  return out;
}
