import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import {
  appendJobEnrichedRows,
  getJobEnrichedRows,
  getJobRawRows,
  getJobState,
  setJobState,
} from "@/lib/cache/enrichment-cache";
import {
  enrichCompanyBatchWithCache,
  enrichContactBatchWithCache,
} from "@/lib/enrichment/ai-enricher";
import {
  enrichCompaniesWithZoomInfo,
  enrichContactsWithZoomInfo,
} from "@/lib/enrichment/zoominfo-enricher";
import { mergeEnrichedCompany, mergeEnrichedContact } from "@/lib/enrichment/merger";
import { batchCheckCompaniesInHubSpot, normalizeDomain } from "@/lib/hubspot/companies";
import { batchCheckContactsInHubSpot } from "@/lib/hubspot/contacts";
import { queueJobChunk } from "@/lib/jobs/qstash";
import type {
  BulkJobState,
  EnrichedCompany,
  EnrichedContact,
  RawCompanyRow,
  RawContactRow,
} from "@/lib/utils/types";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 60;

type ProcessPhase = "ai" | "zoominfo" | "linkedin";

const AI_CHUNK_SIZE = 15;
const AI_BATCH_SIZE = 3;
const ZOOM_CHUNK_SIZE = 25;
const LINKEDIN_CHUNK_SIZE = 10;

function fallbackAiCompanyRows(rows: RawCompanyRow[], errMsg: string): EnrichedCompany[] {
  return rows.map((row) => ({
    id: crypto.randomUUID(),
    rawInput: row.rawName,
    resolvedName: row.rawName,
    confidenceScore: "unresolved",
    aiReasoning: errMsg,
    needsReview: true,
    domain: "",
    website: "",
    state: "",
    numberOfEmployees: null,
    linkedinUrl: "",
    enrichedByZoomInfo: false,
    enrichedByCommonRoom: false,
    enrichedByAI: false,
    status: "pending",
  }));
}

function fallbackAiContactRows(rows: RawContactRow[], errMsg: string): EnrichedContact[] {
  return rows.map((row) => {
    const rawEmail = row.email?.trim() ?? "";
    return {
      id: crypto.randomUUID(),
      firstName: row.firstName,
      lastName: row.lastName,
      rawEmail,
      rawCompany: row.company?.trim() ?? "",
      resolvedEmail: rawEmail,
      isPersonalEmail: false,
      resolvedCompany: row.company?.trim() ?? "",
      confidenceScore: "unresolved",
      aiReasoning: errMsg,
      needsReview: true,
      title: row.title?.trim() ?? "",
      linkedinUrl: "",
      companyDomain: "",
      location: row.location?.trim() ?? "",
      leadSource: row.leadSource?.trim() ?? "",
      leadSourceDescription: row.leadSourceDescription?.trim() ?? "",
      notes: row.notes?.trim() ?? "",
      membershipNotes: row.membershipNotes?.trim() ?? "",
      phone: row.phone?.trim() || undefined,
      enrichedByZoomInfo: false,
      enrichedByCommonRoom: false,
      enrichedByAI: false,
      status: "pending",
    };
  });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

async function persistRowsByAiChunks(jobId: string, rows: unknown[]): Promise<void> {
  const shards = chunk(rows, AI_CHUNK_SIZE);
  for (let i = 0; i < shards.length; i++) {
    await appendJobEnrichedRows(jobId, i, shards[i] ?? []);
  }
}

function isNonEmpty(v: unknown): boolean {
  return typeof v === "string" && v.trim() !== "";
}

function mergePrecheckCompany(row: EnrichedCompany, existingData: Record<string, string>): EnrichedCompany {
  const merged = { ...row };
  if (!merged.domain?.trim() && existingData.domain?.trim()) merged.domain = existingData.domain.trim();
  if (!merged.state?.trim() && existingData.state?.trim()) merged.state = existingData.state.trim();
  if (merged.numberOfEmployees == null && existingData.numberofemployees?.trim()) {
    const parsed = Number.parseInt(existingData.numberofemployees, 10);
    if (Number.isFinite(parsed)) merged.numberOfEmployees = parsed;
  }
  if (!merged.linkedinUrl?.trim() && existingData.linkedin_company_page?.trim()) {
    merged.linkedinUrl = existingData.linkedin_company_page.trim();
  }
  if (!merged.industry?.trim() && existingData.industry?.trim()) merged.industry = existingData.industry.trim();
  if (!merged.description?.trim() && existingData.description?.trim()) {
    merged.description = existingData.description.trim();
  }
  if (!merged.city?.trim() && existingData.city?.trim()) merged.city = existingData.city.trim();
  return merged;
}

function mergePrecheckContact(row: EnrichedContact, existingData: Record<string, string>): EnrichedContact {
  const merged = { ...row };
  if (!merged.title?.trim() && existingData.jobtitle?.trim()) merged.title = existingData.jobtitle.trim();
  if (!merged.resolvedCompany?.trim() && existingData.company?.trim()) {
    merged.resolvedCompany = existingData.company.trim();
  }
  if (!merged.linkedinUrl?.trim() && existingData.ds_liprofile?.trim()) {
    merged.linkedinUrl = existingData.ds_liprofile.trim();
  }
  if (!merged.location?.trim() && existingData.state?.trim()) merged.location = existingData.state.trim();
  if (!merged.phone?.trim() && existingData.phone?.trim()) merged.phone = existingData.phone.trim();
  if (!merged.ziManagementLevel?.trim() && existingData.job_level?.trim()) {
    merged.ziManagementLevel = existingData.job_level.trim();
  }
  if (!merged.ziJobFunction?.trim() && existingData.job_function?.trim()) {
    merged.ziJobFunction = existingData.job_function.trim();
  }
  return merged;
}

async function runHubSpotPrecheck(
  listType: "companies" | "contacts",
  rows: EnrichedCompany[] | EnrichedContact[],
): Promise<{ rows: EnrichedCompany[] | EnrichedContact[]; skippedCount: number }> {
  if (listType === "companies") {
    const companyRows = rows as EnrichedCompany[];
    const lookup = await batchCheckCompaniesInHubSpot(companyRows.map((r) => normalizeDomain(r.domain ?? "")));
    let skippedCount = 0;
    const merged = companyRows.map((row) => {
      const domain = normalizeDomain(row.domain ?? "");
      const match = domain ? lookup.get(domain) : undefined;
      if (!match) return row;
      const complete =
        isNonEmpty(match.existingData.domain) &&
        isNonEmpty(match.existingData.state) &&
        isNonEmpty(match.existingData.numberofemployees) &&
        isNonEmpty(match.existingData.linkedin_company_page) &&
        isNonEmpty(match.existingData.industry);
      if (complete) skippedCount += 1;
      const mergedRow = mergePrecheckCompany(row, match.existingData);
      mergedRow.hubspotId = match.hubspotId;
      mergedRow.hubspotComplete = complete;
      return mergedRow;
    });
    return { rows: merged, skippedCount };
  }

  const contactRows = rows as EnrichedContact[];
  const lookup = await batchCheckContactsInHubSpot(
    contactRows.map((r) => String(r.rawEmail || r.resolvedEmail || "").trim().toLowerCase()),
  );
  let skippedCount = 0;
  const merged = contactRows.map((row) => {
    const email = String(row.rawEmail || row.resolvedEmail || "").trim().toLowerCase();
    const match = email ? lookup.get(email) : undefined;
    if (!match) return row;
    const complete =
      isNonEmpty(match.existingData.jobtitle) &&
      isNonEmpty(match.existingData.company) &&
      isNonEmpty(match.existingData.ds_liprofile);
    if (complete) skippedCount += 1;
    const mergedRow = mergePrecheckContact(row, match.existingData);
    mergedRow.hubspotId = match.hubspotId;
    mergedRow.hubspotComplete = complete;
    return mergedRow;
  });
  return { rows: merged, skippedCount };
}

async function runLinkedInBatch(
  request: Request,
  listType: "companies" | "contacts",
  rows: (EnrichedCompany | EnrichedContact)[],
): Promise<(EnrichedCompany | EnrichedContact)[]> {
  const out = rows.slice();
  const endpoint = new URL("/api/enrich/linkedin-search", request.url).href;
  for (let i = 0; i < out.length; i++) {
    const row = out[i]!;
    const missing = !(row as { linkedinUrl?: string }).linkedinUrl?.trim();
    if (!missing) continue;
    const body =
      listType === "companies"
        ? { company: row as EnrichedCompany }
        : { contact: row as EnrichedContact };
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) continue;
    const json = (await res.json()) as { linkedInUrl?: string | null };
    const linkedInUrl = String(json.linkedInUrl ?? "").trim();
    if (!linkedInUrl) continue;
    out[i] = { ...row, linkedinUrl: linkedInUrl, enrichedByAI: true };
  }
  return out;
}

async function handler(req: Request): Promise<Response> {
  let jobState: BulkJobState | null = null;
  try {
    const body = (await req.json()) as { jobId?: string; chunkIndex?: number; phase?: ProcessPhase };
    const jobId = String(body.jobId ?? "").trim();
    const chunkIndex = Number.isFinite(body.chunkIndex) ? Number(body.chunkIndex) : 0;
    const phase = body.phase;
    if (!jobId || (phase !== "ai" && phase !== "zoominfo" && phase !== "linkedin")) {
      return Response.json({ ok: true });
    }

    jobState = await getJobState(jobId);
    if (!jobState) return Response.json({ ok: true });
    if (jobState.status === "cancelled" || jobState.status === "failed") return Response.json({ ok: true });

    jobState.status = "running";
    jobState.currentPhase = phase;
    await setJobState(jobId, jobState);

    const rawRows = await getJobRawRows(jobId);
    if (!rawRows) throw new Error("Job raw rows not found.");

    if (phase === "ai") {
      const aiSlice = rawRows.slice(chunkIndex * AI_CHUNK_SIZE, (chunkIndex + 1) * AI_CHUNK_SIZE);
      const anthropicApiKey = process.env.ANTHROPIC_API_KEY?.trim();
      if (!anthropicApiKey) throw new Error("Missing ANTHROPIC_API_KEY.");
      const client = new Anthropic({ apiKey: anthropicApiKey });

      const enrichedSlice: (EnrichedCompany | EnrichedContact)[] = [];
      for (const batchRows of chunk(aiSlice, AI_BATCH_SIZE)) {
        try {
          if (jobState.listType === "companies") {
            const { rows } = await enrichCompanyBatchWithCache(
              client,
              batchRows as RawCompanyRow[],
              jobState.eventContext,
            );
            enrichedSlice.push(...rows);
          } else {
            const { rows } = await enrichContactBatchWithCache(
              client,
              batchRows as RawContactRow[],
              jobState.eventContext,
            );
            enrichedSlice.push(...rows);
          }
        } catch (batchErr) {
          const msg = batchErr instanceof Error ? batchErr.message : "AI batch failed.";
          console.error("[Jobs/Process] AI batch failed; continuing:", batchErr);
          if (jobState.listType === "companies") {
            enrichedSlice.push(...fallbackAiCompanyRows(batchRows as RawCompanyRow[], msg));
          } else {
            enrichedSlice.push(...fallbackAiContactRows(batchRows as RawContactRow[], msg));
          }
        }
      }

      await appendJobEnrichedRows(jobId, chunkIndex, enrichedSlice);
      jobState.processedRows = Math.min(
        jobState.totalRows,
        (chunkIndex + 1) * AI_CHUNK_SIZE,
      );
      jobState.checkpointChunk = chunkIndex;
      await setJobState(jobId, jobState);

      const hasMoreAi = chunkIndex + 1 < jobState.totalAiChunks;
      if (hasMoreAi) {
        await queueJobChunk({ jobId, chunkIndex: chunkIndex + 1, phase: "ai" });
        return Response.json({ ok: true });
      }

      const allAiRows = await getJobEnrichedRows(jobId, jobState.totalAiChunks);
      const prechecked = await runHubSpotPrecheck(
        jobState.listType,
        allAiRows as EnrichedCompany[] | EnrichedContact[],
      );
      await persistRowsByAiChunks(jobId, prechecked.rows);
      jobState.hubspotSkippedCount = prechecked.skippedCount;
      jobState.aiComplete = true;
      jobState.precheckComplete = true;
      jobState.currentPhase = "zoominfo";
      jobState.processedRows = 0;
      jobState.checkpointChunk = 0;
      await setJobState(jobId, jobState);
      await queueJobChunk({ jobId, chunkIndex: 0, phase: "zoominfo" });
      return Response.json({ ok: true });
    }

    if (phase === "zoominfo") {
      const allRows = (await getJobEnrichedRows(jobId, jobState.totalAiChunks)) as Array<
        EnrichedCompany | EnrichedContact
      >;
      const zoomSlice = allRows.slice(chunkIndex * ZOOM_CHUNK_SIZE, (chunkIndex + 1) * ZOOM_CHUNK_SIZE);
      const needsZoom = zoomSlice.filter((row) => row.hubspotComplete !== true);
      const baseById = new Map(needsZoom.map((row) => [row.id, row]));
      if (jobState.listType === "companies") {
        const ziMap = await enrichCompaniesWithZoomInfo(needsZoom as EnrichedCompany[]);
        for (const [rowId, zi] of ziMap) {
          const base = baseById.get(rowId) as EnrichedCompany | undefined;
          if (!base) continue;
          const { cachedHit: _cachedHit, ...ziFields } = zi;
          const merged = mergeEnrichedCompany(base, ziFields, {});
          const targetIdx = allRows.findIndex((row) => row.id === rowId);
          if (targetIdx >= 0) allRows[targetIdx] = merged;
          if (zi.enrichedByZoomInfo) {
            if (zi.cachedHit) jobState.cachedCount += 1;
            else jobState.enrichedCount += 1;
          }
        }
      } else {
        const ziMap = await enrichContactsWithZoomInfo(needsZoom as EnrichedContact[]);
        for (const [rowId, zi] of ziMap) {
          const base = baseById.get(rowId) as EnrichedContact | undefined;
          if (!base) continue;
          const merged = mergeEnrichedContact(base, zi, {});
          const targetIdx = allRows.findIndex((row) => row.id === rowId);
          if (targetIdx >= 0) allRows[targetIdx] = merged;
          if (zi.enrichedByZoomInfo) jobState.enrichedCount += 1;
        }
      }
      jobState.creditsUsed = jobState.enrichedCount;
      await persistRowsByAiChunks(jobId, allRows);
      jobState.processedRows = Math.min(jobState.totalRows, (chunkIndex + 1) * ZOOM_CHUNK_SIZE);
      jobState.checkpointChunk = chunkIndex;

      const hasMoreZoom = chunkIndex + 1 < jobState.totalZoomChunks;
      if (hasMoreZoom) {
        await setJobState(jobId, jobState);
        await queueJobChunk({ jobId, chunkIndex: chunkIndex + 1, phase: "zoominfo" });
        return Response.json({ ok: true });
      }

      jobState.zoomInfoComplete = true;
      jobState.currentPhase = "linkedin";
      jobState.processedRows = 0;
      jobState.checkpointChunk = 0;
      await setJobState(jobId, jobState);
      await queueJobChunk({ jobId, chunkIndex: 0, phase: "linkedin" });
      return Response.json({ ok: true });
    }

    const allRows = (await getJobEnrichedRows(jobId, jobState.totalAiChunks)) as Array<
      EnrichedCompany | EnrichedContact
    >;
    const missingIndices: number[] = [];
    for (let i = 0; i < allRows.length; i++) {
      if (!(allRows[i] as { linkedinUrl?: string }).linkedinUrl?.trim()) {
        missingIndices.push(i);
      }
    }
    const group = missingIndices.slice(
      chunkIndex * LINKEDIN_CHUNK_SIZE,
      (chunkIndex + 1) * LINKEDIN_CHUNK_SIZE,
    );
    if (group.length > 0) {
      const subset = group.map((idx) => allRows[idx]!);
      const enrichedSubset = await runLinkedInBatch(req, jobState.listType, subset);
      for (let i = 0; i < group.length; i++) {
        allRows[group[i]!] = enrichedSubset[i]!;
      }
      await persistRowsByAiChunks(jobId, allRows);
    }
    const totalLinkedInChunks = Math.ceil(missingIndices.length / LINKEDIN_CHUNK_SIZE);
    jobState.processedRows = Math.min(missingIndices.length, (chunkIndex + 1) * LINKEDIN_CHUNK_SIZE);
    jobState.checkpointChunk = chunkIndex;
    if (chunkIndex + 1 < totalLinkedInChunks) {
      await setJobState(jobId, jobState);
      await queueJobChunk({ jobId, chunkIndex: chunkIndex + 1, phase: "linkedin" });
      return Response.json({ ok: true });
    }

    jobState.linkedInComplete = true;
    jobState.currentPhase = "complete";
    jobState.status = "complete";
    jobState.completedAt = new Date().toISOString();
    jobState.processedRows = jobState.totalRows;
    await setJobState(jobId, jobState);
    return Response.json({ ok: true });
  } catch (err) {
    if (jobState) {
      jobState.status = "failed";
      jobState.error = err instanceof Error ? err.message : String(err);
      await setJobState(jobState.jobId, jobState);
    }
    return Response.json({ ok: true });
  }
}

export const POST = process.env.NODE_ENV === "development"
  ? handler
  : verifySignatureAppRouter(handler);
