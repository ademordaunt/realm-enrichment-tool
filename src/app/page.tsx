"use client";

import { EventContextForm } from "@/components/EventContextForm";
import { EnrichmentProgress } from "@/components/EnrichmentProgress";
import type { PrePushSettings } from "@/components/PrePushScreen";
import { PrePushScreen } from "@/components/PrePushScreen";
import { applyInitialReviewStatus, ReviewTable } from "@/components/ReviewTable";
import { SuccessScreen } from "@/components/SuccessScreen";
import type { HubSpotPushDonePayload } from "@/lib/hubspot/push-result";
import type {
  EnrichedCompany,
  EnrichedContact,
  EventContext,
  ListType,
  ParseResponse,
  RawCompanyRow,
  RawContactRow,
} from "@/lib/utils/types";
import { ENRICHMENT_BATCH_SIZE } from "@/lib/enrichment/ai-enricher";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

const ACCEPT = ".csv,.xlsx,.xls,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv";

const NAV_STEPS = [
  "Upload",
  "Event Context",
  "Enrichment",
  "Review & Edit",
  "Import Settings",
  "Complete",
] as const;

const PREVIEW_MAX_ROWS = 50;

const MONTH_LONG_TO_ABBREV: Record<string, string> = {
  january: "Jan.",
  february: "Feb.",
  march: "Mar.",
  april: "Apr.",
  may: "May.",
  june: "Jun.",
  july: "Jul.",
  august: "Aug.",
  september: "Sep.",
  october: "Oct.",
  november: "Nov.",
  december: "Dec.",
};

function formatContactDefaultLeadSourceDescription(ctx: EventContext): string {
  const name = ctx.eventName.trim();
  const eventDate = ctx.eventDate.trim();
  const parts = eventDate.split(/\s+/).filter(Boolean);
  if (parts.length < 2) {
    return name || eventDate;
  }
  const year = parts[parts.length - 1]!;
  const monthPart = parts.slice(0, -1).join(" ");
  const abbrev =
    MONTH_LONG_TO_ABBREV[monthPart.toLowerCase()] ??
    `${monthPart.slice(0, 3)}.`;
  return `${name} ${abbrev} ${year}`.trim();
}

const PRIMARY_ACTION_BUTTON =
  "rounded-lg bg-[#7B35C1] px-4 py-2 text-sm font-medium text-white hover:bg-[#6A2AAD] disabled:cursor-not-allowed disabled:opacity-50";

const UPLOAD_FADE_IN = "animate-[fadeIn_0.3s_ease-in]";

function breadcrumbIndex(s: Step): number {
  switch (s) {
    case "upload":
      return 0;
    case "context":
      return 1;
    case "enriching":
    case "verifying":
      return 2;
    case "enriched":
      return 3;
    case "prepush":
    case "pushing":
      return 4;
    case "complete":
      return 5;
    default:
      return 0;
  }
}

type Step =
  | "upload"
  | "context"
  | "enriching"
  | "verifying"
  | "enriched"
  | "prepush"
  | "pushing"
  | "complete";

function rowDedupKey(row: RawCompanyRow | RawContactRow, kind: "companies" | "contacts"): string {
  if (kind === "companies") {
    return `c:${(row as RawCompanyRow).rawName?.trim().toLowerCase() ?? ""}`;
  }
  const c = row as RawContactRow;
  const em = c.email?.trim().toLowerCase() ?? "";
  if (em) return `e:${em}`;
  return `n:${c.firstName?.trim() ?? ""}|${c.lastName?.trim() ?? ""}|${c.company?.trim() ?? ""}`;
}

function listAllDuplicatePairs(
  rows: Array<RawCompanyRow | RawContactRow>,
  kind: "companies" | "contacts",
  exempt: Set<string>,
): [number, number][] {
  const out: [number, number][] = [];
  const groups = new Map<string, number[]>();
  for (let i = 0; i < rows.length; i++) {
    const k = rowDedupKey(rows[i]!, kind);
    const list = groups.get(k) ?? [];
    list.push(i);
    groups.set(k, list);
  }
  for (const indices of groups.values()) {
    if (indices.length < 2) continue;
    for (let u = 0; u < indices.length; u++) {
      for (let v = u + 1; v < indices.length; v++) {
        const a = indices[u]!;
        const b = indices[v]!;
        const sig = `${a}-${b}`;
        if (!exempt.has(sig)) out.push([a, b]);
      }
    }
  }
  return out;
}

function findFirstDuplicatePair(
  rows: Array<RawCompanyRow | RawContactRow>,
  kind: "companies" | "contacts",
  exempt: Set<string>,
): [number, number] | null {
  const all = listAllDuplicatePairs(rows, kind, exempt);
  return all.length > 0 ? all[0]! : null;
}

function duplicateDisplayName(
  row: RawCompanyRow | RawContactRow,
  kind: "companies" | "contacts",
): string {
  if (kind === "companies") {
    return (row as RawCompanyRow).rawName?.trim() ?? "";
  }
  const c = row as RawContactRow;
  return `${c.firstName?.trim() ?? ""} ${c.lastName?.trim() ?? ""}`.trim();
}

function playEnrichmentChime() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
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
  } catch {
    /* ignore */
  }
}

function fireEnrichmentCompleteNotification() {
  if (typeof window === "undefined" || typeof Notification === "undefined") return;
  if (Notification.permission === "granted") {
    try {
      new Notification("Realm Enrichment Tool", {
        body: "Enrichment complete — ready for review!",
        icon: "/favicon.ico",
      });
    } catch {
      /* ignore */
    }
  }
  playEnrichmentChime();
}

function firePushCompleteNotification() {
  if (typeof window === "undefined" || typeof Notification === "undefined") return;
  if (Notification.permission === "granted") {
    try {
      new Notification("Realm Enrichment Tool", {
        body: "HubSpot push complete — your records are ready!",
        icon: "/favicon.ico",
      });
    } catch {
      /* ignore */
    }
  }
  playEnrichmentChime();
}

function collectKeys(rows: Array<RawCompanyRow | RawContactRow>, maxScan: number): string[] {
  const keys = new Set<string>();
  for (let i = 0; i < Math.min(rows.length, maxScan); i++) {
    Object.keys(rows[i] ?? {}).forEach((k) => keys.add(k));
  }
  return Array.from(keys).sort();
}

type NdjsonEvent =
  | { type: "progress"; start: number; end: number; total: number; detail?: string }
  | {
      type: "done";
      listType: "companies" | "contacts";
      rows: EnrichedCompany[] | EnrichedContact[];
    }
  | { type: "error"; message: string };

async function consumeEnrichmentNdjson(
  res: Response,
  onProgress: (e: {
    start: number;
    end: number;
    total: number;
    detail?: string | null;
  }) => void,
): Promise<{
  rows: EnrichedCompany[] | EnrichedContact[];
  rawNdjson: string;
}> {
  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error("No response body from enrichment.");
  }
  const decoder = new TextDecoder();
  let buffer = "";
  let rawNdjson = "";
  let result: EnrichedCompany[] | EnrichedContact[] | null = null;

  const handleLine = (line: string) => {
    const t = line.trim();
    if (!t) return;
    const msg = JSON.parse(t) as NdjsonEvent;
    if (msg.type === "progress") {
      onProgress({
        start: msg.start,
        end: msg.end,
        total: msg.total,
        detail: msg.detail ?? null,
      });
    } else if (msg.type === "error") {
      throw new Error(msg.message);
    } else if (msg.type === "done") {
      result = msg.rows;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (value) {
      const chunk = decoder.decode(value, { stream: true });
      rawNdjson += chunk;
      buffer += chunk;
    }
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      handleLine(line);
    }
    if (done) {
      break;
    }
  }
  if (buffer.trim()) {
    handleLine(buffer.trim());
  }
  if (!result) {
    throw new Error("Enrichment finished without a result payload.");
  }
  return { rows: result, rawNdjson };
}

function fallbackAiCompanyRows(rows: RawCompanyRow[], errMsg: string): EnrichedCompany[] {
  return rows.map((row) => ({
    id: crypto.randomUUID(),
    rawInput: row.rawName,
    resolvedName: row.rawName,
    confidenceScore: "unresolved" as const,
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
      enrichedByZoomInfo: false,
      enrichedByCommonRoom: false,
      enrichedByAI: false,
      status: "pending" as const,
    };
  });
}

type PushNdjsonEvent =
  | { type: "progress"; current: number; total: number }
  | {
      type: "done";
      created: number;
      updated: number;
      errors: { rowId: string; error: string }[];
      listId: string;
      listName: string;
      totalPushed: number;
    }
  | { type: "error"; message: string };

async function consumePushNdjson(
  res: Response,
  onProgress: (e: { current: number; total: number }) => void,
): Promise<HubSpotPushDonePayload> {
  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error("No response body from HubSpot push.");
  }
  const decoder = new TextDecoder();
  let buffer = "";
  let result: HubSpotPushDonePayload | null = null;

  const handleLine = (line: string) => {
    const t = line.trim();
    if (!t) return;
    const msg = JSON.parse(t) as PushNdjsonEvent;
    if (msg.type === "progress") {
      onProgress({ current: msg.current, total: msg.total });
    } else if (msg.type === "error") {
      throw new Error(msg.message);
    } else if (msg.type === "done") {
      result = {
        created: msg.created,
        updated: msg.updated,
        errors: msg.errors,
        listId: msg.listId,
        listName: msg.listName,
        totalPushed: msg.totalPushed,
      };
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: true });
    }
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      handleLine(line);
    }
    if (done) {
      break;
    }
  }
  if (buffer.trim()) {
    handleLine(buffer.trim());
  }
  if (!result) {
    throw new Error("HubSpot push finished without a result payload.");
  }
  return result;
}

export default function Home() {
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enrichError, setEnrichError] = useState<string | null>(null);
  const [result, setResult] = useState<ParseResponse | null>(null);
  const [listOverride, setListOverride] = useState<"companies" | "contacts" | null>(null);
  const [segmentIndex, setSegmentIndex] = useState(0);

  const [progress, setProgress] = useState<{
    startRow: number;
    endRow: number;
    totalRows: number;
    detail?: string | null;
    /** True when the current batch was served entirely from KV cache (AI skipped). */
    fromCache?: boolean;
  } | null>(null);

  const [enriched, setEnriched] = useState<EnrichedCompany[] | EnrichedContact[] | null>(null);
  const [enrichedListType, setEnrichedListType] = useState<"companies" | "contacts" | null>(
    null,
  );
  const [reviewRows, setReviewRows] = useState<EnrichedCompany[] | EnrichedContact[]>([]);
  const [eventContext, setEventContext] = useState<EventContext | null>(null);
  const [pushProgress, setPushProgress] = useState<{ current: number; total: number } | null>(
    null,
  );
  const [pushResult, setPushResult] = useState<HubSpotPushDonePayload | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);
  const [lastPushLeadSource, setLastPushLeadSource] = useState<string | null>(null);

  const [previewRowsOverride, setPreviewRowsOverride] = useState<Array<RawCompanyRow | RawContactRow> | null>(
    null,
  );
  const [duplicateExemptPairs, setDuplicateExemptPairs] = useState<Set<string>>(() => new Set());
  const [dupFeedback, setDupFeedback] = useState<"removed" | "kept" | null>(null);
  /** Snapshot of unresolved duplicate-pair count when the user first sees the duplicate card (for "N of M" UI). */
  const [duplicateSessionTotal, setDuplicateSessionTotal] = useState<number | null>(null);
  const [showSuccessFlash, setShowSuccessFlash] = useState(false);

  const enrichAbortRef = useRef<AbortController | null>(null);
  const uploadFlashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enrichmentBannerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [showEnrichmentCompleteBanner, setShowEnrichmentCompleteBanner] = useState(false);
  const [completionBannerText, setCompletionBannerText] = useState(
    "✓ Enrichment complete — your results are ready below.",
  );

  const approvedRowsForPush = useMemo(
    () => reviewRows.filter((r) => r.status === "approved"),
    [reviewRows],
  );
  useLayoutEffect(() => {
    if (!enriched?.length || !enrichedListType) {
      setReviewRows([]);
      return;
    }
    setReviewRows(applyInitialReviewStatus(enriched));
  }, [enriched, enrichedListType]);

  useEffect(() => {
    return () => {
      if (uploadFlashTimeoutRef.current) {
        clearTimeout(uploadFlashTimeoutRef.current);
        uploadFlashTimeoutRef.current = null;
      }
      if (enrichmentBannerTimeoutRef.current) {
        clearTimeout(enrichmentBannerTimeoutRef.current);
        enrichmentBannerTimeoutRef.current = null;
      }
    };
  }, []);

  const parseFile = useCallback(
    async (f: File, listType?: "companies" | "contacts") => {
      setBusy(true);
      setError(null);
      try {
        const body = new FormData();
        body.append("file", f);
        if (listType) {
          body.append("listType", listType);
        }
        const res = await fetch("/api/parse", {
          method: "POST",
          body,
        });
        const json = (await res.json()) as ParseResponse & { error?: string };
        if (!res.ok) {
          setResult(null);
          setShowSuccessFlash(false);
          setError(json.error ?? `Request failed (${res.status})`);
          return;
        }
        if ("error" in json && json.error) {
          setResult(null);
          setShowSuccessFlash(false);
          setError(json.error);
          return;
        }
        setResult(json);
        setShowSuccessFlash(true);
        if (uploadFlashTimeoutRef.current) {
          clearTimeout(uploadFlashTimeoutRef.current);
        }
        uploadFlashTimeoutRef.current = setTimeout(() => {
          setShowSuccessFlash(false);
          uploadFlashTimeoutRef.current = null;
        }, 1500);
        setSegmentIndex(0);
        setStep("upload");
        setEnriched(null);
        setEnrichedListType(null);
        setEventContext(null);
        setPushResult(null);
        setPushError(null);
        setLastPushLeadSource(null);
        setPreviewRowsOverride(null);
        setDuplicateExemptPairs(new Set());
        if (json.listType !== "unknown") {
          setListOverride(null);
        }
      } catch (e) {
        setResult(null);
        setShowSuccessFlash(false);
        setError(e instanceof Error ? e.message : "Failed to upload file.");
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const onFiles = useCallback(
    (files: FileList | null) => {
      const f = files?.[0];
      if (!f) return;
      setFile(f);
      setListOverride(null);
      void parseFile(f);
    },
    [parseFile],
  );

  const effectiveListType: ListType = useMemo(() => {
    if (!result) return "unknown";
    if (result.multiEvent?.segments?.length) {
      const seg = result.multiEvent.segments[segmentIndex];
      if (seg?.listType && seg.listType !== "unknown") {
        return seg.listType;
      }
    }
    if (result.listType === "unknown" && listOverride) {
      return listOverride;
    }
    return result.listType;
  }, [listOverride, result, segmentIndex]);

  const resolvedListType: "companies" | "contacts" | null = useMemo(() => {
    if (effectiveListType === "companies" || effectiveListType === "contacts") {
      return effectiveListType;
    }
    return null;
  }, [effectiveListType]);

  const displayRows = useMemo(() => {
    if (!result) return [];
    if (result.multiEvent?.segments?.length) {
      const seg = result.multiEvent.segments[segmentIndex];
      return seg?.rows ?? result.rows;
    }
    return result.rows;
  }, [result, segmentIndex]);

  const workingRows = previewRowsOverride ?? displayRows;
  const effectiveRowCount = workingRows.length;

  const previewKeys = useMemo(
    () => collectKeys(workingRows, 100),
    [workingRows],
  );

  const duplicatePair = useMemo((): [number, number] | null => {
    if (!resolvedListType) return null;
    return findFirstDuplicatePair(workingRows, resolvedListType, duplicateExemptPairs);
  }, [workingRows, resolvedListType, duplicateExemptPairs]);

  const remainingDuplicatePairsCount = useMemo(() => {
    if (!resolvedListType) return 0;
    return listAllDuplicatePairs(workingRows, resolvedListType, duplicateExemptPairs).length;
  }, [workingRows, resolvedListType, duplicateExemptPairs]);

  useEffect(() => {
    if (!resolvedListType) {
      setDuplicateSessionTotal(null);
      return;
    }
    const n = listAllDuplicatePairs(workingRows, resolvedListType, duplicateExemptPairs).length;
    if (n === 0) {
      setDuplicateSessionTotal(null);
      return;
    }
    setDuplicateSessionTotal((prev) => (prev == null ? n : prev));
  }, [workingRows, resolvedListType, duplicateExemptPairs]);

  const duplicatePairSerial =
    duplicateSessionTotal != null && remainingDuplicatePairsCount > 0
      ? duplicateSessionTotal - remainingDuplicatePairsCount + 1
      : 1;

  const previewRowsForTable = useMemo(
    () => workingRows.slice(0, PREVIEW_MAX_ROWS),
    [workingRows],
  );

  useEffect(() => {
    setPreviewRowsOverride(null);
    setDuplicateExemptPairs(new Set());
    setDupFeedback(null);
    setDuplicateSessionTotal(null);
  }, [result, segmentIndex]);

  const runZoomVerify = async (
    aiRows: EnrichedCompany[] | EnrichedContact[],
    listType: "companies" | "contacts",
    signal?: AbortSignal,
  ): Promise<EnrichedCompany[] | EnrichedContact[]> => {
    setStep("verifying");
    setProgress({
      startRow: 1,
      endRow: 1,
      totalRows: aiRows.length,
      detail: null,
    });
    const res = await fetch("/api/enrich/zoominfo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: aiRows, listType }),
      signal,
    });
    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(errBody.error ?? `Verification failed (${res.status})`);
    }
    const { rows } = await consumeEnrichmentNdjson(res, (p) => {
      setProgress({
        startRow: p.start,
        endRow: p.end,
        totalRows: p.total,
        detail: p.detail ?? null,
      });
    });
    return rows;
  };

  const runEnrichment = async (context: EventContext) => {
    if (!resolvedListType) return;
    setEventContext(context);
    setEnrichError(null);
    if (typeof window !== "undefined" && "Notification" in window) {
      void Notification.requestPermission();
    }
    const ac = new AbortController();
    enrichAbortRef.current = ac;
    setStep("enriching");
    const batchSize = ENRICHMENT_BATCH_SIZE;
    const totalRows = workingRows.length;
    const numBatches = Math.max(1, Math.ceil(totalRows / batchSize));
    setProgress({
      startRow: 1,
      endRow: Math.min(batchSize, totalRows),
      totalRows,
      detail: null,
      fromCache: false,
    });
    try {
      const batchErrors: string[] = [];
      const aiRowsMerged =
        resolvedListType === "companies"
          ? ([] as EnrichedCompany[])
          : ([] as EnrichedContact[]);

      for (let i = 0; i < numBatches; i++) {
        const start = i * batchSize;
        const batchSlice = workingRows.slice(start, start + batchSize);
        setProgress({
          startRow: start + 1,
          endRow: Math.min(start + batchSlice.length, totalRows),
          totalRows,
          detail: null,
          fromCache: false,
        });

        let res: Response;
        try {
          res = await fetch("/api/enrich/ai", {
            method: "POST",
            signal: ac.signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              rows: batchSlice,
              listType: resolvedListType,
              context,
              batchIndex: i,
              batchSize,
            }),
          });
        } catch (fetchErr) {
          if (fetchErr instanceof Error && fetchErr.name === "AbortError") {
            throw fetchErr;
          }
          const msg =
            fetchErr instanceof Error ? fetchErr.message : "Network error";
          const label = `Batch ${i + 1} of ${numBatches}: ${msg}`;
          batchErrors.push(label);
          setEnrichError(batchErrors.join(" · "));
          if (resolvedListType === "companies") {
            (aiRowsMerged as EnrichedCompany[]).push(
              ...fallbackAiCompanyRows(batchSlice as RawCompanyRow[], label),
            );
          } else {
            (aiRowsMerged as EnrichedContact[]).push(
              ...fallbackAiContactRows(batchSlice as RawContactRow[], label),
            );
          }
          continue;
        }

        if (!res.ok) {
          const errBody = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          const msg = errBody.error ?? `Enrichment failed (${res.status})`;
          const label = `Batch ${i + 1} of ${numBatches}: ${msg}`;
          batchErrors.push(label);
          setEnrichError(batchErrors.join(" · "));
          if (resolvedListType === "companies") {
            (aiRowsMerged as EnrichedCompany[]).push(
              ...fallbackAiCompanyRows(batchSlice as RawCompanyRow[], label),
            );
          } else {
            (aiRowsMerged as EnrichedContact[]).push(
              ...fallbackAiContactRows(batchSlice as RawContactRow[], label),
            );
          }
          continue;
        }

        const payload = (await res.json()) as {
          rows: EnrichedCompany[] | EnrichedContact[];
          allCacheHits?: boolean;
        };
        setProgress({
          startRow: start + 1,
          endRow: Math.min(start + batchSlice.length, totalRows),
          totalRows,
          detail: null,
          fromCache: payload.allCacheHits === true,
        });
        if (resolvedListType === "companies") {
          (aiRowsMerged as EnrichedCompany[]).push(
            ...(payload.rows as EnrichedCompany[]),
          );
        } else {
          (aiRowsMerged as EnrichedContact[]).push(
            ...(payload.rows as EnrichedContact[]),
          );
        }
      }

      const aiRows = aiRowsMerged as
        | EnrichedCompany[]
        | EnrichedContact[];

      let finalRows: EnrichedCompany[] | EnrichedContact[] = aiRows;
      try {
        finalRows = await runZoomVerify(aiRows, resolvedListType, ac.signal);
      } catch (verifyErr) {
        if (verifyErr instanceof Error && verifyErr.name === "AbortError") {
          setStep("context");
          return;
        }
        setEnrichError(
          verifyErr instanceof Error ? verifyErr.message : "ZoomInfo / Common Room step failed.",
        );
        finalRows = aiRows;
      }

      setEnriched(finalRows);
      setEnrichedListType(resolvedListType);
      setStep("enriched");
      fireEnrichmentCompleteNotification();
      if (
        typeof window !== "undefined" &&
        typeof Notification !== "undefined" &&
        Notification.permission !== "granted"
      ) {
        setCompletionBannerText("✓ Enrichment complete — your results are ready below.");
        setShowEnrichmentCompleteBanner(true);
        if (enrichmentBannerTimeoutRef.current) {
          clearTimeout(enrichmentBannerTimeoutRef.current);
        }
        enrichmentBannerTimeoutRef.current = setTimeout(() => {
          setShowEnrichmentCompleteBanner(false);
          enrichmentBannerTimeoutRef.current = null;
        }, 5000);
      }
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        setStep("context");
        return;
      }
      setEnrichError(e instanceof Error ? e.message : "Enrichment failed.");
      setStep("context");
    } finally {
      enrichAbortRef.current = null;
      setProgress(null);
    }
  };

  const startNewImport = useCallback(() => {
    if (uploadFlashTimeoutRef.current) {
      clearTimeout(uploadFlashTimeoutRef.current);
      uploadFlashTimeoutRef.current = null;
    }
    setShowSuccessFlash(false);
    setShowEnrichmentCompleteBanner(false);
    if (enrichmentBannerTimeoutRef.current) {
      clearTimeout(enrichmentBannerTimeoutRef.current);
      enrichmentBannerTimeoutRef.current = null;
    }
    setStep("upload");
    setFile(null);
    setResult(null);
    setListOverride(null);
    setSegmentIndex(0);
    setEnriched(null);
    setEnrichedListType(null);
    setReviewRows([]);
    setEventContext(null);
    setPushResult(null);
    setPushError(null);
    setLastPushLeadSource(null);
    setEnrichError(null);
    setError(null);
    setProgress(null);
    setPreviewRowsOverride(null);
    setDuplicateExemptPairs(new Set());
  }, []);

  const runHubSpotPush = useCallback(
    async (settings: PrePushSettings) => {
      if (!enrichedListType || !eventContext) return;
      const approved = reviewRows.filter((r) => r.status === "approved");
      if (approved.length === 0) return;
      setPushError(null);
      setLastPushLeadSource(settings.leadSource);
      setStep("pushing");
      setPushProgress({ current: 0, total: approved.length });
      try {
        const res = await fetch("/api/hubspot/push", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rows: settings.contactRowsOverride ?? approved,
            listType: enrichedListType,
            eventName: eventContext.eventName,
            listName: settings.listName,
            folderId: settings.folderId,
            leadSource: settings.leadSource,
            leadSourceDescription: settings.leadSourceDescription,
            useExistingLeadSource: settings.useExistingLeadSource,
            useExistingLeadSourceDescription: settings.useExistingLeadSourceDescription,
            notes: settings.notes,
          }),
        });
        if (!res.ok) {
          const errBody = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(errBody.error ?? `HubSpot push failed (${res.status})`);
        }
        const done = await consumePushNdjson(res, (p) => {
          setPushProgress({ current: p.current, total: p.total });
        });
        setPushResult(done);
        setStep("complete");
        firePushCompleteNotification();
        if (
          typeof window !== "undefined" &&
          typeof Notification !== "undefined" &&
          Notification.permission !== "granted"
        ) {
          setCompletionBannerText("✓ HubSpot push complete — your records are ready!");
          setShowEnrichmentCompleteBanner(true);
          if (enrichmentBannerTimeoutRef.current) {
            clearTimeout(enrichmentBannerTimeoutRef.current);
          }
          enrichmentBannerTimeoutRef.current = setTimeout(() => {
            setShowEnrichmentCompleteBanner(false);
            enrichmentBannerTimeoutRef.current = null;
          }, 5000);
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : "HubSpot push failed.";
        setPushError(message);
        setPushResult({
          created: 0,
          updated: 0,
          errors: [
            {
              rowId: "push",
              error: message,
            },
          ],
          listId: "",
          listName: settings.listName || eventContext.eventName,
          totalPushed: 0,
        });
        setStep("complete");
      } finally {
        setPushProgress(null);
      }
    },
    [enrichedListType, eventContext, reviewRows],
  );

  const bc = breadcrumbIndex(step);

  const enrichmentBatchPercent = useMemo(() => {
    if (!progress || progress.totalRows <= 0) return 0;
    const totalBatches = Math.max(1, Math.ceil(progress.totalRows / ENRICHMENT_BATCH_SIZE));
    const currentBatch = Math.ceil(progress.endRow / ENRICHMENT_BATCH_SIZE);
    return Math.min(100, (currentBatch / totalBatches) * 100);
  }, [progress]);

  return (
    <div className="flex min-h-screen flex-1 flex-col bg-(--bg-page)">
      {showEnrichmentCompleteBanner ? (
        <div
          className="fixed top-14 left-0 right-0 z-40 border-b border-emerald-700/20 bg-emerald-600 px-4 py-3 text-center text-sm font-medium text-white shadow-sm"
          role="status"
        >
          {completionBannerText}
        </div>
      ) : null}

      <header className="fixed top-0 left-0 right-0 z-50 grid h-14 w-full grid-cols-1 items-center bg-(--realm-navy) px-4 shadow-(--shadow-card) sm:px-6 md:grid-cols-[1fr_auto_1fr]">
        <div
          className="min-w-0 whitespace-nowrap text-lg font-semibold tracking-tight text-white md:col-start-1 md:row-start-1"
          style={{ textShadow: "0 1px 3px rgba(0,0,0,0.4)" }}
        >
          <span className="text-white font-semibold">Realm</span>
          <span className="text-white font-semibold">.Security</span>
        </div>
        <nav
          className="hidden max-w-[min(100vw-8rem,40rem)] flex-wrap items-center justify-center gap-x-0.5 gap-y-1 text-center text-[10px] leading-tight sm:max-w-none sm:text-xs md:col-start-2 md:row-start-1 md:flex md:text-sm"
          aria-label="Import steps"
        >
          {NAV_STEPS.map((label, i) => {
            const isCurrent = i === bc;
            const isDone = i < bc;
            return (
              <span key={label} className="inline-flex items-center">
                {i > 0 ? (
                  <span className="px-0.5 text-white/30 sm:px-1" aria-hidden>
                    ·
                  </span>
                ) : null}
                <span
                  className={
                    isCurrent
                      ? "font-semibold text-white"
                      : isDone
                        ? "text-white/60"
                        : "text-white/30"
                  }
                >
                  {label}
                </span>
              </span>
            );
          })}
        </nav>
        <div className="hidden min-w-0 md:col-start-3 md:row-start-1 md:block" aria-hidden />
      </header>

      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 pb-8 pt-22 sm:px-6">
        {step === "upload" && (
          <div className="flex min-h-[calc(100vh-3.5rem)] w-full flex-col items-center justify-center py-12">
            {!result && (
              <section
                className={`relative flex min-h-55 w-full cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-(--border-default) bg-(--bg-card) px-6 py-10 transition-colors ${
                  busy ? "opacity-80" : "hover:border-(--realm-purple) hover:bg-(--bg-muted)"
                }`}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onFiles(e.dataTransfer.files);
                }}
              >
                <input
                  className="absolute inset-0 cursor-pointer opacity-0"
                  type="file"
                  accept={ACCEPT}
                  disabled={busy}
                  onChange={(e) => onFiles(e.target.files)}
                  aria-label="Upload CSV or Excel file"
                />
                <div className="pointer-events-none text-center">
                  <p className="text-base font-medium text-(--text-primary)">
                    Drop a file here, or click to browse
                  </p>
                  <p className="mt-2 text-sm text-(--text-muted)">
                    Accepted: .csv, .xlsx, .xls — max 5 MB
                  </p>
                </div>
              </section>
            )}

            {busy && (
              <p className="text-sm text-zinc-600 dark:text-zinc-400" role="status">
                Parsing…
              </p>
            )}

            {error && (
              <div
                className="w-full rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-100"
                role="alert"
              >
                {error}
              </div>
            )}

            {result && file && showSuccessFlash && (
              <div
                className={`flex w-full flex-col items-center justify-center py-16 ${UPLOAD_FADE_IN}`}
                role="status"
                aria-live="polite"
              >
                <span className="text-7xl leading-none text-green-500" aria-hidden>
                  ✓
                </span>
                <p className={`mt-4 text-base font-medium text-(--text-primary) ${UPLOAD_FADE_IN}`}>
                  File uploaded successfully
                </p>
              </div>
            )}

            {result && file && !showSuccessFlash && (
              <section
                className={`flex w-full flex-col gap-6 rounded-xl border border-(--border-default) bg-(--bg-card) p-5 shadow-(--shadow-card) sm:p-6 ${UPLOAD_FADE_IN}`}
              >
                <div className="flex w-full flex-wrap items-start justify-between gap-3 text-sm text-(--text-primary)">
                  <p className="min-w-0 flex-1">
                    ✓ <span className="font-semibold">{file.name}</span> — {effectiveRowCount}{" "}
                    row{effectiveRowCount === 1 ? "" : "s"} detected as{" "}
                    <span className="font-semibold capitalize">
                      {effectiveListType === "unknown" ? "unknown" : effectiveListType}
                    </span>
                  </p>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                    {result.listType === "unknown" && (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          className={`${PRIMARY_ACTION_BUTTON} px-3 py-1.5 text-xs`}
                          onClick={() => {
                            if (!file) return;
                            void parseFile(file, "companies");
                          }}
                        >
                          Companies
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          className={`${PRIMARY_ACTION_BUTTON} px-3 py-1.5 text-xs`}
                          onClick={() => {
                            if (!file) return;
                            void parseFile(file, "contacts");
                          }}
                        >
                          Contacts
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      className="text-sm font-medium text-(--realm-purple) hover:text-(--realm-purple-hover) hover:underline"
                      onClick={() => {
                        startNewImport();
                      }}
                    >
                      Change File
                    </button>
                  </div>
                </div>

                {duplicatePair && resolvedListType ? (
                  <div
                    className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-100"
                    role="status"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="min-w-0 flex-1 text-sm font-bold">
                        Duplicate found: &quot;
                        {duplicateDisplayName(workingRows[duplicatePair[0]]!, resolvedListType)}
                        &quot;
                      </p>
                      {duplicateSessionTotal != null && duplicateSessionTotal > 1 ? (
                        <p className="shrink-0 text-xs text-amber-900/60 dark:text-amber-200/70">
                          {duplicatePairSerial} of {duplicateSessionTotal} duplicates
                        </p>
                      ) : null}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="rounded-lg border border-amber-700/30 bg-white px-3 py-1.5 text-sm font-medium text-amber-950 hover:bg-amber-100 dark:border-amber-600/40 dark:bg-amber-900/50 dark:text-amber-50 dark:hover:bg-amber-900/80"
                        onClick={() => {
                          const [a, b] = duplicatePair;
                          const removeIndex = Math.max(a, b);
                          const base = previewRowsOverride ?? displayRows;
                          setPreviewRowsOverride(base.filter((_, i) => i !== removeIndex));
                          setDupFeedback("removed");
                        }}
                      >
                        Remove Duplicate
                      </button>
                      <button
                        type="button"
                        className="rounded-lg border border-amber-700/30 bg-white px-3 py-1.5 text-sm font-medium text-amber-950 hover:bg-amber-100 dark:border-amber-600/40 dark:bg-amber-900/50 dark:text-amber-50 dark:hover:bg-amber-900/80"
                        onClick={() => {
                          setDuplicateExemptPairs((prev) =>
                            new Set(prev).add(`${duplicatePair[0]}-${duplicatePair[1]}`),
                          );
                          setDupFeedback("kept");
                        }}
                      >
                        Keep Both
                      </button>
                    </div>
                    {dupFeedback ? (
                      <p className="mt-2 text-xs text-amber-800 dark:text-amber-200">
                        {dupFeedback === "removed"
                          ? "Removed the later duplicate row from this import."
                          : "Kept both rows for this pair."}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <div className="max-h-72 overflow-y-auto overflow-x-auto rounded-lg border border-(--border-default)">
                    <table className="min-w-full border-collapse text-left text-xs sm:text-sm">
                      <thead className="sticky top-0 z-1 bg-(--bg-muted)">
                        <tr>
                          {previewKeys.map((k) => (
                            <th
                              key={k}
                              className="whitespace-nowrap border-b border-(--border-default) px-3 py-2 font-semibold text-(--text-secondary)"
                            >
                              {k}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {previewRowsForTable.map((row, ri) => (
                          <tr
                            key={ri}
                            className={ri % 2 === 0 ? "bg-(--bg-card)" : "bg-(--bg-page)"}
                          >
                            {previewKeys.map((k) => (
                              <td
                                key={k}
                                className="border-b border-(--border-default) px-3 py-2 text-(--text-primary)"
                              >
                                {(row as Record<string, string | undefined>)[k] ?? ""}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={!resolvedListType || effectiveRowCount === 0}
                    onClick={() => setStep("context")}
                    className={PRIMARY_ACTION_BUTTON}
                  >
                    Continue →
                  </button>
                </div>
              </section>
            )}
          </div>
        )}

        {step === "context" && resolvedListType && (
          <>
            {enrichError && (
              <div
                className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-100"
                role="alert"
              >
                {enrichError}
              </div>
            )}
            <EventContextForm
              listType={resolvedListType}
              sourceFileName={file?.name ?? null}
              initialValues={eventContext}
              onBackToUpload={startNewImport}
              onSubmit={(ctx) => void runEnrichment(ctx)}
            />
          </>
        )}

        {step === "enriching" && progress && (
          <div className="flex flex-col gap-4">
            <div className="rounded-xl border border-(--border-default) bg-(--bg-card) p-5 shadow-(--shadow-card)">
              <p className="text-center text-sm font-medium text-(--text-primary)" role="status">
                {progress.fromCache
                  ? `Loaded from cache: rows ${progress.startRow}–${progress.endRow} of ${progress.totalRows}…`
                  : `Analyzing rows ${progress.startRow}–${progress.endRow} of ${progress.totalRows}…`}
              </p>
              <div
                className="mt-3 h-2 w-full overflow-hidden rounded-full bg-(--bg-muted)"
                aria-hidden
              >
                <div
                  className="h-full max-w-full rounded-full bg-(--realm-purple) transition-all duration-400 ease-out"
                  style={{ width: `${enrichmentBatchPercent}%` }}
                />
              </div>
              <p className="mt-3 text-center text-sm text-(--text-muted)">
                You can leave this tab. We&apos;ll notify you when enrichment is complete.
              </p>
            </div>
            <button
              type="button"
              className="self-center rounded-lg border border-(--border-default) bg-white px-4 py-2 text-sm font-medium text-(--text-primary) transition-colors hover:bg-(--bg-muted)"
              onClick={() => enrichAbortRef.current?.abort()}
            >
              Cancel Enrichment
            </button>
          </div>
        )}

        {step === "verifying" && progress && (
          <EnrichmentProgress
            startRow={progress.startRow}
            endRow={progress.endRow}
            totalRows={progress.totalRows}
            verifyTitle={
              resolvedListType === "companies"
                ? "Verifying non-confident companies with ZoomInfo…"
                : "Verifying non-confident contacts with Common Room and ZoomInfo…"
            }
            verifyDetail={progress.detail}
          />
        )}

        {step === "pushing" && pushProgress && (
          <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100" role="status">
              Pushing record {pushProgress.current} of {pushProgress.total} to HubSpot…
            </p>
            <p className="text-sm text-(--text-muted) text-center mt-2">
              You can leave this tab. We&apos;ll notify you when the push is complete.
            </p>
          </div>
        )}

        {step === "enriched" && enriched && enrichedListType && (
          <section className="rounded-xl border border-(--border-default) bg-(--bg-card) p-5 pb-24 shadow-(--shadow-card)">
            {pushError && (
              <div
                className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-100"
                role="alert"
              >
                {pushError}
              </div>
            )}
            {enrichError && (
              <div
                className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-700/80 dark:bg-amber-950/40 dark:text-amber-100"
                role="status"
              >
                {enrichError}
              </div>
            )}
            <p className="mt-3 text-sm text-(--text-muted) bg-(--bg-muted) rounded-lg px-4 py-2">
              ℹ️ ZoomInfo verification: pending API access · 0 credits estimated for this import
            </p>
            <div className="mt-4">
              <ReviewTable
                rows={reviewRows}
                listType={enrichedListType}
                onRowsChange={setReviewRows}
                onApprove={() => {
                  setPushError(null);
                  setStep("prepush");
                }}
              />
            </div>
          </section>
        )}

        {step === "prepush" &&
          enriched &&
          enrichedListType &&
          eventContext &&
          approvedRowsForPush.length > 0 && (
          <PrePushScreen
            listType={enrichedListType}
            approvedRows={approvedRowsForPush}
            defaultListName={eventContext.eventName}
            defaultLeadSourceDescription={
              enrichedListType === "contacts"
                ? formatContactDefaultLeadSourceDescription(eventContext)
                : ""
            }
            onBack={() => setStep("enriched")}
            onPush={(settings) => void runHubSpotPush(settings)}
          />
        )}

        {step === "complete" && pushResult && (
          <SuccessScreen
            result={pushResult}
            leadSourceUsed={lastPushLeadSource ?? undefined}
            onStartNew={startNewImport}
          />
        )}
      </main>

    </div>
  );
}
