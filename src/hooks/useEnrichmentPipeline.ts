"use client";

import { useCallback, useRef, useState } from "react";
import type {
  EnrichedCompany, EnrichedContact, EnrichmentSummary,
  RawCompanyRow, RawContactRow, EventContext,
} from "@/lib/utils/types";
import {
  ENRICHMENT_BATCH_SIZE,
  needsCompanyLinkedInLookup,
  needsLinkedInLookup,
} from "@/lib/enrichment/enrichment-utils";

type Step =
  | "starter" | "upload" | "context" | "enriching" | "verifying"
  | "costestimate" | "prereview" | "enriched" | "prepush" | "pushing" | "complete";

type ProgressState = {
  startRow: number;
  endRow: number;
  totalRows: number;
  detail?: string | null;
  fromCache?: boolean;
} | null;

type ZoomInfoVerifySummary =
  | { kind: "success"; enrichedCount: number; cachedCount: number; creditsUsed: number; listType: "companies" | "contacts" }
  | { kind: "no_matches" }
  | { kind: "credentials" };

type HubSpotPrecheckItem = {
  id: string;
  hubspotId: string | null;
  hubspotComplete: boolean;
  existingData: Record<string, string>;
};

type NdjsonEvent =
  | { type: "progress"; start: number; end: number; total: number; detail?: string }
  | { type: "done"; listType: "companies" | "contacts"; rows: EnrichedCompany[] | EnrichedContact[]; enrichedCount?: number; cachedCount?: number; commonRoomHits?: number; creditsUsed?: number }
  | { type: "error"; message: string; zoomInfoAuthFailure?: boolean };

class ZoomInfoVerifyError extends Error {
  readonly zoomInfoAuthFailure: boolean;
  constructor(message: string, options?: { zoomInfoAuthFailure?: boolean }) {
    super(message);
    this.name = "ZoomInfoVerifyError";
    this.zoomInfoAuthFailure = Boolean(options?.zoomInfoAuthFailure);
  }
}

function apiJsonErrorMessage(o: { error?: string; detail?: string }): string {
  if (typeof o.detail === "string" && o.detail.length > 0) return o.detail;
  if (typeof o.error === "string" && o.error.length > 0) return o.error;
  return "";
}

function fallbackAiCompanyRows(rows: RawCompanyRow[], errMsg: string): EnrichedCompany[] {
  return rows.map((row) => ({
    id: crypto.randomUUID(),
    rawInput: row.rawName,
    resolvedName: row.rawName,
    confidenceScore: "unresolved" as const,
    identityConfidence: "unresolved" as const,
    aiReasoning: errMsg,
    needsReview: true,
    domain: "",
    domainSource: "" as const,
    website: "",
    state: "",
    numberOfEmployees: null,
    linkedinUrl: "",
    linkedinSource: "" as const,
    reviewBucket: "needs_review" as const,
    enrichedByZoomInfo: false,
    enrichedByCommonRoom: false,
    enrichedByAI: false,
    status: "pending" as const,
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
      confidenceScore: "unresolved" as const,
      identityConfidence: "unresolved" as const,
      aiReasoning: errMsg,
      needsReview: true,
      title: row.title?.trim() ?? "",
      linkedinUrl: "",
      linkedinSource: "" as const,
      reviewBucket: "needs_review" as const,
      companyDomain: "",
      location: row.location?.trim() ?? "",
      leadSource: row.leadSource?.trim() ?? "",
      leadSourceDescription: row.leadSourceDescription?.trim() ?? "",
      notes: row.notes?.trim() ?? "",
      membershipNotes: row.membershipNotes?.trim() ?? "",
      enrichedByZoomInfo: false,
      enrichedByCommonRoom: false,
      enrichedByAI: false,
      status: "pending" as const,
    };
  });
}

async function consumeEnrichmentNdjson(
  res: Response,
  onProgress: (e: { start: number; end: number; total: number; detail?: string | null }) => void,
): Promise<{ rows: EnrichedCompany[] | EnrichedContact[]; enrichedCount: number; cachedCount: number; commonRoomHits: number; creditsUsed: number }> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body from enrichment.");
  const decoder = new TextDecoder();
  let buffer = "";
  let result: EnrichedCompany[] | EnrichedContact[] | null = null;
  let enrichedCount = 0;
  let cachedCount = 0;
  let commonRoomHits = 0;
  let creditsUsed = 0;

  const handleLine = (line: string) => {
    const t = line.trim();
    if (!t) return;
    let parsed: unknown;
    try { parsed = JSON.parse(line); } catch { return; }
    const msg = parsed as NdjsonEvent;
    if (msg.type === "progress") {
      onProgress({ start: msg.start, end: msg.end, total: msg.total, detail: msg.detail ?? null });
    } else if (msg.type === "error") {
      throw new ZoomInfoVerifyError(msg.message, { zoomInfoAuthFailure: msg.zoomInfoAuthFailure === true });
    } else if (msg.type === "done") {
      result = msg.rows;
      enrichedCount = typeof msg.enrichedCount === "number" ? msg.enrichedCount : 0;
      cachedCount = typeof msg.cachedCount === "number" ? msg.cachedCount : 0;
      commonRoomHits = typeof msg.commonRoomHits === "number" ? msg.commonRoomHits : 0;
      creditsUsed = typeof msg.creditsUsed === "number" ? msg.creditsUsed : enrichedCount;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (value) {
      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;
    }
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) handleLine(line);
    if (done) break;
  }
  if (buffer.trim()) handleLine(buffer.trim());
  if (!result) throw new Error("Enrichment finished without a result payload.");
  return { rows: result, enrichedCount, cachedCount, commonRoomHits, creditsUsed };
}

function linkedInLookupIdentityOk(row: EnrichedCompany | EnrichedContact): boolean {
  const ic = row.identityConfidence ?? row.confidenceScore;
  return ic === "high" || ic === "medium";
}

async function runLinkedInLookupPass(
  contacts: EnrichedContact[],
  signal: AbortSignal,
  onProgress: (done: number, total: number) => void,
): Promise<EnrichedContact[]> {
  const missingIndices: number[] = [];
  for (let i = 0; i < contacts.length; i++) {
    const c = contacts[i]!;
    if (linkedInLookupIdentityOk(c) && needsLinkedInLookup(c)) missingIndices.push(i);
  }
  const total = missingIndices.length;
  if (total === 0) return contacts;
  const out = contacts.slice();
  let done = 0;
  for (const idx of missingIndices) {
    const row = out[idx]!;
    const res = await fetch("/api/enrich/linkedin-search", {
      method: "POST", signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contact: row }),
    });
    if (!res.ok) { done += 1; onProgress(done, total); continue; }
    const payload = (await res.json()) as { linkedInUrl?: string | null };
    const linkedInUrl = String(payload.linkedInUrl ?? "").trim();
    if (linkedInUrl) out[idx] = { ...row, linkedinUrl: linkedInUrl, linkedinSource: "ai_search", enrichedByAI: true };
    done += 1;
    onProgress(done, total);
  }
  return out;
}

async function runCompanyLinkedInLookupPass(
  companies: EnrichedCompany[],
  signal: AbortSignal,
  onProgress: (done: number, total: number) => void,
): Promise<EnrichedCompany[]> {
  const missingIndices: number[] = [];
  for (let i = 0; i < companies.length; i++) {
    const c = companies[i]!;
    if (linkedInLookupIdentityOk(c) && needsCompanyLinkedInLookup(c)) missingIndices.push(i);
  }
  const total = missingIndices.length;
  if (total === 0) return companies;
  const out = companies.slice();
  let done = 0;
  for (const idx of missingIndices) {
    const row = out[idx]!;
    const res = await fetch("/api/enrich/linkedin-search", {
      method: "POST", signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company: row }),
    });
    if (!res.ok) { done += 1; onProgress(done, total); continue; }
    const payload = (await res.json()) as { linkedInUrl?: string | null };
    const linkedInUrl = String(payload.linkedInUrl ?? "").trim();
    if (linkedInUrl) out[idx] = { ...row, linkedinUrl: linkedInUrl, linkedinSource: "ai_search", enrichedByAI: true };
    done += 1;
    onProgress(done, total);
  }
  return out;
}

function computeZoomVerifyNonHighTotal(rows: (EnrichedCompany | EnrichedContact)[]): number {
  return rows.filter((r) => r.hubspotComplete !== true).length;
}

function countZoomVerifyNonHighPrefix(rows: (EnrichedCompany | EnrichedContact)[], beforeIndex: number): number {
  let n = 0;
  for (let j = 0; j < Math.min(beforeIndex, rows.length); j++) {
    if (rows[j]!.hubspotComplete !== true) n++;
  }
  return n;
}

const ZOOM_VERIFY_COMPANY_CHUNK_SIZE = 15;
const ZOOM_VERIFY_CONTACT_CHUNK_SIZE = 8;
const MIN_PHASE_DISPLAY_MS = 700;

async function waitForMinimumPhaseDisplay(
  phaseStartMs: number,
  signal?: AbortSignal,
): Promise<void> {
  const remainingMs = MIN_PHASE_DISPLAY_MS - (Date.now() - phaseStartMs);
  if (remainingMs <= 0) return;
  await new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, remainingMs);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** HubSpot property name → enriched row field name (companies). */
const companyFieldMap: Record<string, string> = {
  domain: "domain", state: "state", numberofemployees: "numberOfEmployees",
  linkedin_company_page: "linkedinUrl", industry: "industry", description: "description", city: "city",
};
const contactFieldMap: Record<string, string> = {
  jobtitle: "title", company: "resolvedCompany", ds_liprofile: "linkedinUrl",
  state: "location", phone: "phone", job_level: "ziManagementLevel", job_function: "ziJobFunction",
};

function isBlank(value: string | null | undefined): boolean {
  return value == null || value.trim() === "";
}

function mergeHubSpotExistingIntoCompany(merged: EnrichedCompany, existing: Record<string, string>): void {
  for (const [hsKey, rowKey] of Object.entries(companyFieldMap)) {
    const raw = existing[hsKey];
    if (raw == null || String(raw).trim() === "") continue;
    const val = String(raw).trim();
    if (rowKey === "numberOfEmployees") {
      if (merged.numberOfEmployees != null) continue;
      const n = Number.parseInt(val, 10);
      if (Number.isFinite(n)) merged.numberOfEmployees = n;
      continue;
    }
    const cur = merged[rowKey as keyof EnrichedCompany];
    if (typeof cur === "string" && !isBlank(cur)) continue;
    if (cur != null && typeof cur !== "string") continue;
    (merged as unknown as Record<string, unknown>)[rowKey] = val;
  }
  if (isBlank(merged.website) && !isBlank(merged.domain)) {
    const d = merged.domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]!;
    if (d) merged.website = `https://www.${d}`;
  }
  const hsLi = String(existing.linkedin_company_page ?? "").trim();
  if (hsLi && merged.linkedinUrl.trim() === hsLi) merged.linkedinSource = "hubspot";
  const hsDom = String(existing.domain ?? "").trim();
  if (hsDom && merged.domain.trim().toLowerCase() === hsDom.toLowerCase()) merged.domainSource = "hubspot_verified";
}

function contactPrecheckFieldEmpty(merged: EnrichedContact, rowKey: string): boolean {
  const v = (merged as unknown as Record<string, unknown>)[rowKey];
  if (v == null) return true;
  if (typeof v === "string") return isBlank(v);
  return false;
}

function mergeHubSpotExistingIntoContact(merged: EnrichedContact, existing: Record<string, string>): void {
  for (const [hsKey, rowKey] of Object.entries(contactFieldMap)) {
    const raw = existing[hsKey];
    if (raw == null || String(raw).trim() === "") continue;
    if (!contactPrecheckFieldEmpty(merged, rowKey)) continue;
    (merged as unknown as Record<string, unknown>)[rowKey] = String(raw).trim();
  }
  const hsLi = String(existing.ds_liprofile ?? "").trim();
  if (hsLi && merged.linkedinUrl.trim() === hsLi) merged.linkedinSource = "hubspot";
}

interface EnrichmentPipelineOptions {
  resolvedListType: "companies" | "contacts" | null;
  workingRows: Array<RawCompanyRow | RawContactRow>;
  wizardImportMode: "event" | "bulk";
  setStep: (s: Step) => void;
  setEventContext: (ctx: EventContext) => void;
  setProgress: (p: ProgressState) => void;
  setEnrichError: (e: string | null) => void;
  setZoomInfoVerifySummary: (s: ZoomInfoVerifySummary | null) => void;
  advanceToReview: (rows: EnrichedCompany[] | EnrichedContact[], listType: "companies" | "contacts") => Promise<void>;
  stopJobPolling: () => void;
}

export function useEnrichmentPipeline(options: EnrichmentPipelineOptions) {
  const {
    resolvedListType, workingRows, wizardImportMode,
    setStep, setEventContext, setProgress, setEnrichError,
    setZoomInfoVerifySummary, advanceToReview, stopJobPolling,
  } = options;

  const [costEstimateMeta, setCostEstimateMeta] = useState<{ totalRows: number; hubspotCompleteCount: number } | null>(null);
  const [eventEnrichmentSummary, setEventEnrichmentSummary] = useState<EnrichmentSummary | null>(null);
  const [showEnrichmentCompleteBanner, setShowEnrichmentCompleteBanner] = useState(false);
  const [completionBannerText, setCompletionBannerText] = useState("✓ Enrichment complete — your results are ready below.");

  const enrichAbortRef = useRef<AbortController | null>(null);
  const bulkContinueRef = useRef<{ rows: EnrichedCompany[] | EnrichedContact[]; listType: "companies" | "contacts"; signal: AbortSignal } | null>(null);
  const bulkCostGateResolveRef = useRef<(() => void) | null>(null);
  const enrichmentBannerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runHubSpotPreCheck = useCallback(async (
    aiRows: EnrichedCompany[] | EnrichedContact[],
    listType: "companies" | "contacts",
    signal?: AbortSignal,
  ): Promise<EnrichedCompany[] | EnrichedContact[]> => {
    const phaseStartMs = Date.now();
    setStep("verifying");
    setProgress({ startRow: 0, endRow: 0, totalRows: 1, detail: "Checking HubSpot for existing records…" });
    try {
      const res = await fetch("/api/hubspot/precheck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listType, rows: aiRows }),
        signal,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
        throw new Error(apiJsonErrorMessage(body) || `HubSpot pre-check failed (${res.status})`);
      }
      const payload = (await res.json()) as { results?: HubSpotPrecheckItem[] };
      const byId = new Map<string, HubSpotPrecheckItem>((payload.results ?? []).map((r) => [r.id, r]));

      if (listType === "companies") {
        return (aiRows as EnrichedCompany[]).map((row) => {
          const match = byId.get(row.id);
          if (!match) return row;
          const merged: EnrichedCompany = { ...row, hubspotId: match.hubspotId, hubspotComplete: match.hubspotComplete, existingData: match.existingData };
          if (match.hubspotComplete) mergeHubSpotExistingIntoCompany(merged, match.existingData);
          return merged;
        });
      }
      return (aiRows as EnrichedContact[]).map((row) => {
        const match = byId.get(row.id);
        if (!match) return row;
        const merged: EnrichedContact = { ...row, hubspotId: match.hubspotId, hubspotComplete: match.hubspotComplete, existingData: match.existingData };
        if (match.hubspotComplete) mergeHubSpotExistingIntoContact(merged, match.existingData);
        return merged;
      });
    } catch (error) {
      console.error("[HubSpot pre-check] failed:", error);
      return aiRows;
    } finally {
      setProgress({ startRow: 1, endRow: 1, totalRows: 1, detail: "Checking HubSpot for existing records…" });
      await waitForMinimumPhaseDisplay(phaseStartMs, signal);
    }
  }, [setStep, setProgress]);

  const runZoomVerify = useCallback(async (
    aiRows: EnrichedCompany[] | EnrichedContact[],
    listType: "companies" | "contacts",
    signal?: AbortSignal,
  ): Promise<{ rows: EnrichedCompany[] | EnrichedContact[]; creditsUsed: number; commonRoomHits: number }> => {
    setStep("verifying");
    const totalRows = aiRows.length;
    const listLabel = listType === "contacts" ? "contacts" : "companies";
    setProgress({ startRow: 1, endRow: 0, totalRows, detail: `ZoomInfo & Common Room enriching 0 of ${totalRows} ${listLabel}…` });
    if (totalRows === 0) {
      setZoomInfoVerifySummary({ kind: "no_matches" });
      return { rows: [], creditsUsed: 0, commonRoomHits: 0 };
    }
    const nonHighTotal = computeZoomVerifyNonHighTotal(aiRows);
    const zoomVerifyChunkSize = listType === "contacts" ? ZOOM_VERIFY_CONTACT_CHUNK_SIZE : ZOOM_VERIFY_COMPANY_CHUNK_SIZE;
    const numChunks = Math.ceil(totalRows / zoomVerifyChunkSize);
    let sumEnriched = 0, sumCached = 0, sumCredits = 0, sumCommonRoomHits = 0;
    const merged: (EnrichedCompany | EnrichedContact)[] = [];

    for (let ci = 0; ci < numChunks; ci++) {
      const chunkStart = ci * zoomVerifyChunkSize;
      const slice = aiRows.slice(chunkStart, chunkStart + zoomVerifyChunkSize);
      const nonHighPrefixCount = countZoomVerifyNonHighPrefix(aiRows, chunkStart);
      const res = await fetch("/api/enrich/zoominfo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: slice, listType, chunkIndex: ci, chunkSize: zoomVerifyChunkSize, totalRows, nonHighTotal, nonHighPrefixCount }),
        signal,
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
        throw new Error(apiJsonErrorMessage(errBody) || `Verification failed (${res.status})`);
      }
      const { rows, enrichedCount, cachedCount, commonRoomHits, creditsUsed } = await consumeEnrichmentNdjson(res, (p) => {
        setProgress({ startRow: p.start, endRow: p.end, totalRows: p.total, detail: `ZoomInfo & Common Room enriching ${Math.min(p.end, p.total)} of ${p.total} ${listLabel}…` });
      });
      merged.push(...rows);
      sumEnriched += enrichedCount;
      sumCached += cachedCount;
      sumCommonRoomHits += commonRoomHits;
      sumCredits += creditsUsed;
    }

    setZoomInfoVerifySummary(
      sumEnriched > 0 || sumCached > 0
        ? { kind: "success", enrichedCount: sumEnriched, cachedCount: sumCached, creditsUsed: sumCredits, listType }
        : { kind: "no_matches" },
    );
    return { rows: merged as EnrichedCompany[] | EnrichedContact[], creditsUsed: sumCredits, commonRoomHits: sumCommonRoomHits };
  }, [setStep, setProgress, setZoomInfoVerifySummary]);

  const runZoomVerifyAndLinkedInTail = useCallback(async (
    rowsAfterAi: EnrichedCompany[] | EnrichedContact[],
    listType: "companies" | "contacts",
    signal: AbortSignal,
    context: { totalRows: number; hubspotFound: number; enrichmentStartTime: number },
  ): Promise<void> => {
    let rowsAfterVerify: EnrichedCompany[] | EnrichedContact[] = rowsAfterAi;
    let zoomCreditsUsed = 0;
    let commonRoomFound = 0;
    try {
      const verify = await runZoomVerify(rowsAfterAi, listType, signal);
      rowsAfterVerify = verify.rows;
      zoomCreditsUsed = verify.creditsUsed;
      commonRoomFound = verify.commonRoomHits;
    } catch (verifyErr) {
      if (verifyErr instanceof Error && verifyErr.name === "AbortError") { setStep("context"); throw verifyErr; }
      if (verifyErr instanceof ZoomInfoVerifyError && verifyErr.zoomInfoAuthFailure) {
        setZoomInfoVerifySummary({ kind: "credentials" });
        setEnrichError(null);
      } else {
        setZoomInfoVerifySummary(null);
        setEnrichError(verifyErr instanceof Error ? verifyErr.message : "ZoomInfo / Common Room step failed.");
      }
      rowsAfterVerify = rowsAfterAi;
    }

    const rowsAfterPrecheck = await runHubSpotPreCheck(rowsAfterVerify, listType, signal);
    context.hubspotFound = rowsAfterPrecheck.filter((r) => r.hubspotComplete === true).length;

    let finalRows: EnrichedCompany[] | EnrichedContact[] = rowsAfterPrecheck;
    if (listType === "contacts") {
      const contactRowsAfterPrecheck = rowsAfterPrecheck as EnrichedContact[];
      const missingLinkedInTotal = contactRowsAfterPrecheck.filter((r) => needsLinkedInLookup(r)).length;
      if (missingLinkedInTotal > 0) {
        const linkedInPhaseStartMs = Date.now();
        setProgress({ startRow: 1, endRow: 0, totalRows: missingLinkedInTotal, detail: `Searching for remaining LinkedIn URLs: 0 of ${missingLinkedInTotal}…` });
        finalRows = await runLinkedInLookupPass(contactRowsAfterPrecheck, signal, (done, total) => {
          setProgress({ startRow: 1, endRow: done, totalRows: total, detail: `Searching for remaining LinkedIn URLs: ${done} of ${total}…` });
        });
        await waitForMinimumPhaseDisplay(linkedInPhaseStartMs, signal);
      }
    }
    if (listType === "companies") {
      const companyRowsAfterPrecheck = rowsAfterPrecheck as EnrichedCompany[];
      const missingCompanyLinkedIn = companyRowsAfterPrecheck.filter((r) => needsCompanyLinkedInLookup(r)).length;
      if (missingCompanyLinkedIn > 0) {
        const linkedInPhaseStartMs = Date.now();
        setProgress({ startRow: 1, endRow: 0, totalRows: missingCompanyLinkedIn, detail: `Finding remaining company LinkedIn profiles… (0 of ${missingCompanyLinkedIn})` });
        finalRows = await runCompanyLinkedInLookupPass(companyRowsAfterPrecheck, signal, (done, total) => {
          setProgress({ startRow: 1, endRow: done, totalRows: total, detail: `Finding remaining company LinkedIn profiles… (${done} of ${total})` });
        });
        await waitForMinimumPhaseDisplay(linkedInPhaseStartMs, signal);
      }
    }

    const withLinkedInSourceFallback = (finalRows.map((row) =>
      row.linkedinUrl?.trim() && !row.linkedinSource?.trim() ? { ...row, linkedinSource: "ai_search" as const } : row
    )) as EnrichedCompany[] | EnrichedContact[];

    const linkedInFoundCount = withLinkedInSourceFallback.filter((r) => r.linkedinSource === "ai_search").length;
    const elapsedMinutes = Math.round((Date.now() - context.enrichmentStartTime) / 60000);
    setEventEnrichmentSummary({ totalRows: context.totalRows, hubspotFound: context.hubspotFound, creditsUsed: zoomCreditsUsed, linkedInFound: linkedInFoundCount, elapsedMinutes, commonRoomFound });

    await advanceToReview(withLinkedInSourceFallback, listType);

    // Fire completion notification
    if (typeof window !== "undefined" && typeof Notification !== "undefined") {
      if (Notification.permission !== "granted") {
        setCompletionBannerText("✓ Enrichment complete — your results are ready below.");
        setShowEnrichmentCompleteBanner(true);
        if (enrichmentBannerTimeoutRef.current) clearTimeout(enrichmentBannerTimeoutRef.current);
        enrichmentBannerTimeoutRef.current = setTimeout(() => {
          setShowEnrichmentCompleteBanner(false);
          enrichmentBannerTimeoutRef.current = null;
        }, 5000);
      }
    }
    if (Notification.permission === "granted") {
      try { new Notification("Realm Enrichment Tool", { body: "Enrichment complete — ready for review!", icon: "/favicon.ico" }); } catch { /* ignore */ }
    }
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctx) {
        const ctx = new Ctx();
        const freqs = [523.25, 659.25, 783.99];
        let t = 0;
        for (const freq of freqs) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.value = freq;
          gain.gain.value = 0.07;
          osc.connect(gain);
          gain.connect(ctx.destination);
          const start = ctx.currentTime + t;
          osc.start(start);
          osc.stop(start + 0.14);
          t += 0.11;
        }
      }
    } catch { /* ignore */ }
  }, [runZoomVerify, runHubSpotPreCheck, setStep, setEnrichError, setZoomInfoVerifySummary, setProgress, setEventEnrichmentSummary, advanceToReview, enrichmentBannerTimeoutRef]);

  const runEnrichment = useCallback(async (context: EventContext) => {
    if (!resolvedListType) return;
    setEventContext(context);
    setEnrichError(null);
    setZoomInfoVerifySummary(null);
    if (typeof window !== "undefined" && "Notification" in window) {
      void Notification.requestPermission().catch(() => {});
    }
    const ac = new AbortController();
    enrichAbortRef.current = ac;
    const enrichmentStartTime = Date.now();
    setStep("enriching");
    const batchSize = ENRICHMENT_BATCH_SIZE;
    const totalRows = workingRows.length;
    const numBatches = Math.max(1, Math.ceil(totalRows / batchSize));
    setProgress({ startRow: 1, endRow: Math.min(batchSize, totalRows), totalRows, detail: null, fromCache: false });
    let pausedForCostEstimate = false;

    try {
      setEventEnrichmentSummary(null);
      const batchErrors: string[] = [];
      const aiRowsMerged = resolvedListType === "companies" ? ([] as EnrichedCompany[]) : ([] as EnrichedContact[]);

      for (let i = 0; i < numBatches; i++) {
        const start = i * batchSize;
        const batchSlice = workingRows.slice(start, start + batchSize);
        setProgress({ startRow: start + 1, endRow: Math.min(start + batchSlice.length, totalRows), totalRows, detail: null, fromCache: false });
        let res: Response;
        try {
          res = await fetch("/api/enrich/ai", {
            method: "POST", signal: ac.signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rows: batchSlice, listType: resolvedListType, context, batchIndex: i, batchSize }),
          });
        } catch (fetchErr) {
          if (fetchErr instanceof Error && fetchErr.name === "AbortError") throw fetchErr;
          const msg = fetchErr instanceof Error ? fetchErr.message : "Network error";
          const label = `Batch ${i + 1} of ${numBatches}: ${msg}`;
          batchErrors.push(label);
          setEnrichError(batchErrors.join(" · "));
          if (resolvedListType === "companies") {
            (aiRowsMerged as EnrichedCompany[]).push(...fallbackAiCompanyRows(batchSlice as RawCompanyRow[], label));
          } else {
            (aiRowsMerged as EnrichedContact[]).push(...fallbackAiContactRows(batchSlice as RawContactRow[], label));
          }
          continue;
        }
        if (!res.ok) {
          const errBody = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
          const msg = apiJsonErrorMessage(errBody) || `Enrichment failed (${res.status})`;
          const label = `Batch ${i + 1} of ${numBatches}: ${msg}`;
          batchErrors.push(label);
          setEnrichError(batchErrors.join(" · "));
          if (resolvedListType === "companies") {
            (aiRowsMerged as EnrichedCompany[]).push(...fallbackAiCompanyRows(batchSlice as RawCompanyRow[], label));
          } else {
            (aiRowsMerged as EnrichedContact[]).push(...fallbackAiContactRows(batchSlice as RawContactRow[], label));
          }
          continue;
        }
        const payload = (await res.json()) as { rows: EnrichedCompany[] | EnrichedContact[]; allCacheHits?: boolean };
        setProgress({ startRow: start + 1, endRow: Math.min(start + batchSlice.length, totalRows), totalRows, detail: null, fromCache: payload.allCacheHits === true });
        if (resolvedListType === "companies") {
          (aiRowsMerged as EnrichedCompany[]).push(...(payload.rows as EnrichedCompany[]));
        } else {
          (aiRowsMerged as EnrichedContact[]).push(...(payload.rows as EnrichedContact[]));
        }
      }

      const aiRows = aiRowsMerged as EnrichedCompany[] | EnrichedContact[];

      if (wizardImportMode === "bulk") {
        pausedForCostEstimate = true;
        bulkContinueRef.current = { rows: aiRows, listType: resolvedListType, signal: ac.signal };
        setCostEstimateMeta({ totalRows: workingRows.length, hubspotCompleteCount: 0 });
        setProgress(null);
        setStep("costestimate");
        await new Promise<void>((resolve) => { bulkCostGateResolveRef.current = resolve; });
        bulkCostGateResolveRef.current = null;
        const pending = bulkContinueRef.current;
        bulkContinueRef.current = null;
        setCostEstimateMeta(null);
        pausedForCostEstimate = false;
        if (!pending) return;
        await runZoomVerifyAndLinkedInTail(pending.rows, pending.listType, pending.signal, { totalRows, hubspotFound: 0, enrichmentStartTime });
      } else {
        await runZoomVerifyAndLinkedInTail(aiRows, resolvedListType, ac.signal, { totalRows, hubspotFound: 0, enrichmentStartTime });
      }
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") { setStep("context"); return; }
      setEnrichError(e instanceof Error ? e.message : "Enrichment failed.");
      setStep("context");
    } finally {
      if (!pausedForCostEstimate) {
        enrichAbortRef.current = null;
        setProgress(null);
      }
    }
  }, [resolvedListType, workingRows, wizardImportMode, setStep, setEventContext, setProgress, setEnrichError, setZoomInfoVerifySummary, runZoomVerifyAndLinkedInTail]);

  const proceedFromCostEstimate = useCallback(() => {
    const resolve = bulkCostGateResolveRef.current;
    bulkCostGateResolveRef.current = null;
    resolve?.();
  }, []);

  const backFromCostEstimate = useCallback(() => {
    bulkContinueRef.current = null;
    const resolve = bulkCostGateResolveRef.current;
    bulkCostGateResolveRef.current = null;
    resolve?.();
    setCostEstimateMeta(null);
    enrichAbortRef.current?.abort();
    enrichAbortRef.current = null;
    setProgress(null);
    setStep("context");
  }, [setProgress, setStep]);

  const cancelEnrichmentToContext = useCallback(() => {
    bulkContinueRef.current = null;
    const resolve = bulkCostGateResolveRef.current;
    bulkCostGateResolveRef.current = null;
    resolve?.();
    setCostEstimateMeta(null);
    enrichAbortRef.current?.abort();
    setProgress(null);
    setStep("context");
  }, [setProgress, setStep]);

  const resetPipeline = useCallback(() => {
    bulkContinueRef.current = null;
    const resolveGate = bulkCostGateResolveRef.current;
    bulkCostGateResolveRef.current = null;
    resolveGate?.();
    setCostEstimateMeta(null);
    setEventEnrichmentSummary(null);
    enrichAbortRef.current?.abort();
    enrichAbortRef.current = null;
    stopJobPolling();
    if (enrichmentBannerTimeoutRef.current) {
      clearTimeout(enrichmentBannerTimeoutRef.current);
      enrichmentBannerTimeoutRef.current = null;
    }
    setShowEnrichmentCompleteBanner(false);
  }, [stopJobPolling, enrichmentBannerTimeoutRef]);

  return {
    costEstimateMeta,
    eventEnrichmentSummary,
    showEnrichmentCompleteBanner,
    completionBannerText,
    setShowEnrichmentCompleteBanner,
    setCompletionBannerText,
    enrichmentBannerTimeoutRef,
    runEnrichment,
    proceedFromCostEstimate,
    backFromCostEstimate,
    cancelEnrichmentToContext,
    resetPipeline,
  };
}
