import { Redis } from "@upstash/redis";
import type {
  BulkJobState,
  EnrichedCompany,
  EnrichedContact,
  IdentityConfidence,
} from "@/lib/utils/types";
import { isPersonalEmail } from "@/lib/utils/contacts";

const kv = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const COMPANY_TTL = 60 * 60 * 24 * 30; // 30 days in seconds
const CONTACT_TTL = 60 * 60 * 24 * 30;
const JOB_TTL = 60 * 60 * 24 * 7;
const MANUAL_EDITS_TTL = 60 * 60 * 24 * 7; // 7 days
const RAW_SHARD_LIMIT_BYTES = 800 * 1024;

function normalizeCompanyKey(name: string): string {
  return `company:${name.toLowerCase().trim().replace(/[^a-z0-9]/g, "_")}`;
}

function normalizeContactKey(email: string): string {
  return `contact:${email.toLowerCase().trim()}`;
}

function normalizeManualEditsKey(stableKey: string, listType: "companies" | "contacts"): string {
  return `manual_edits:${listType}:${stableKey.trim().toLowerCase()}`;
}

export async function getCachedCompany(name: string): Promise<EnrichedCompany | null> {
  try {
    const result = await kv.get<EnrichedCompany>(normalizeCompanyKey(name));
    if (!result) return null;
    let migrated: EnrichedCompany = result;
    const hasLinkedInUrl = typeof migrated.linkedinUrl === "string" && migrated.linkedinUrl.trim() !== "";
    const hasLinkedInSource =
      typeof migrated.linkedinSource === "string" && migrated.linkedinSource.trim() !== "";
    if (hasLinkedInUrl && !hasLinkedInSource) {
      migrated = {
        ...migrated,
        linkedinSource: migrated.enrichedByZoomInfo === true ? "zoominfo" : "hubspot",
      };
    }
    if (migrated.enrichedByZoomInfo !== true) {
      const hasZoomInfoIndicativeFields =
        migrated.numberOfEmployees != null ||
        (typeof migrated.industry === "string" && migrated.industry.trim() !== "") ||
        migrated.revenue != null ||
        (typeof migrated.description === "string" && migrated.description.trim() !== "");
      if (hasZoomInfoIndicativeFields) {
        migrated = {
          ...migrated,
          enrichedByZoomInfo: true,
          domainSource:
            typeof migrated.domain === "string" &&
            migrated.domain.trim() !== "" &&
            migrated.domainSource !== "hubspot_verified"
              ? "zoominfo_verified"
              : migrated.domainSource,
        };
      }
    }
    const idConf = migrated.identityConfidence as
      | IdentityConfidence
      | null
      | undefined
      | "";
    if (
      (idConf === undefined || idConf === null || idConf === "") &&
      typeof migrated.confidenceScore === "string" &&
      migrated.confidenceScore.trim() !== ""
    ) {
      migrated = {
        ...migrated,
        identityConfidence: migrated.confidenceScore as IdentityConfidence,
      };
    }
    const hasLinkedInSourceAiSearch = migrated.linkedinSource === "ai_search";
    const hasLinkedInUrlForAmber = Boolean(migrated.linkedinUrl?.trim());
    const linkedinAmberFlag =
      migrated.linkedinAmberFlag ??
      (hasLinkedInSourceAiSearch && hasLinkedInUrlForAmber);
    migrated = {
      ...migrated,
      linkedinAmberFlag,
      trustedSortTier: migrated.trustedSortTier ?? 2,
      csvDomain: migrated.csvDomain ?? "",
      csvState: migrated.csvState ?? "",
      csvEmployees: migrated.csvEmployees ?? "",
      csvIndustry: migrated.csvIndustry ?? "",
    };
    return migrated;
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
    if (!result) return null;
    const hasValidCompanyDomain =
      typeof result.companyDomain === "string" && result.companyDomain.trim() !== "";
    if (!hasValidCompanyDomain) return null;
    const hasLinkedInSourceAiSearch = result.linkedinSource === "ai_search";
    const hasLinkedInUrl = Boolean(result.linkedinUrl?.trim());
    const linkedinAmberFlag =
      result.linkedinAmberFlag ??
      (hasLinkedInSourceAiSearch && hasLinkedInUrl);
    const resolvedEmail = result.resolvedEmail?.trim() ?? "";
    const migratedEmailSource =
      result.emailSource ??
      (resolvedEmail
        ? (isPersonalEmail(resolvedEmail) ? "personal" : "csv")
        : "csv");
    return {
      ...result,
      ziContactAccuracyScore:
        typeof result.ziContactAccuracyScore === "number"
          ? result.ziContactAccuracyScore
          : undefined,
      ziMatchDiscarded: result.ziMatchDiscarded ?? false,
      emailSource: migratedEmailSource,
      personalEmail: result.personalEmail ?? undefined,
      hubspotCompanyId: result.hubspotCompanyId ?? undefined,
      linkedinAmberFlag,
      trustedSortTier: result.trustedSortTier ?? (linkedinAmberFlag ? 1 : 2),
      csvTitle: result.csvTitle ?? "",
      csvDomain: result.csvDomain ?? "",
      csvState: result.csvState ?? "",
      csvEmployees: result.csvEmployees ?? "",
      csvIndustry: result.csvIndustry ?? "",
    };
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

export async function getManualEdits(
  stableKey: string,
  listType: "companies" | "contacts",
): Promise<Record<string, unknown> | null> {
  try {
    const result = await kv.get<Record<string, unknown>>(
      normalizeManualEditsKey(stableKey, listType),
    );
    return result ?? null;
  } catch {
    return null;
  }
}

export async function setManualEdit(
  stableKey: string,
  listType: "companies" | "contacts",
  field: string,
  value: unknown,
): Promise<void> {
  try {
    const key = normalizeManualEditsKey(stableKey, listType);
    const existing = (await kv.get<Record<string, unknown>>(key)) ?? {};
    existing[field] = value;
    await kv.set(key, existing, { ex: MANUAL_EDITS_TTL });
  } catch {
    // Best-effort
  }
}

export async function checkKvConnectivity(): Promise<void> {
  try {
    await kv.set("__health_check__", "1", { ex: 10 });
    const val = await kv.get("__health_check__");
    if (String(val) !== "1") {
      console.error("[Cache] KV health check failed — reads not returning written values");
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
