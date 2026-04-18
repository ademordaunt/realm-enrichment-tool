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

function findFirstDuplicatePair(
  rows: Array<RawCompanyRow | RawContactRow>,
  kind: "companies" | "contacts",
  exempt: Set<string>,
): [number, number] | null {
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
        if (!exempt.has(sig)) return [a, b];
      }
    }
  }
  return null;
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

  const enrichAbortRef = useRef<AbortController | null>(null);

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
          setError(json.error ?? `Request failed (${res.status})`);
          return;
        }
        if ("error" in json && json.error) {
          setResult(null);
          setError(json.error);
          return;
        }
        setResult(json);
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

  const duplicatePairKey = duplicatePair ? `${duplicatePair[0]}-${duplicatePair[1]}` : null;

  useEffect(() => {
    if (duplicatePairKey) setDupFeedback(null);
  }, [duplicatePairKey]);

  const previewRowsForTable = useMemo(
    () => workingRows.slice(0, PREVIEW_MAX_ROWS),
    [workingRows],
  );

  useEffect(() => {
    setPreviewRowsOverride(null);
    setDuplicateExemptPairs(new Set());
    setDupFeedback(null);
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
    setProgress({
      startRow: 1,
      endRow: Math.min(10, workingRows.length),
      totalRows: workingRows.length,
      detail: null,
    });
    try {
      const res = await fetch("/api/enrich/ai", {
        method: "POST",
        signal: ac.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: workingRows,
          listType: resolvedListType,
          context,
        }),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errBody.error ?? `Enrichment failed (${res.status})`);
      }
      const { rows: aiRows } = await consumeEnrichmentNdjson(res, (p) => {
        setProgress({
          startRow: p.start,
          endRow: p.end,
          totalRows: p.total,
          detail: p.detail ?? null,
        });
      });

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
            rows: approved,
            listType: enrichedListType,
            eventName: eventContext.eventName,
            listName: settings.listName,
            folderId: settings.folderId,
            leadSource: settings.leadSource,
            leadSourceDescription: settings.leadSourceDescription,
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
      } catch (e) {
        setPushError(e instanceof Error ? e.message : "HubSpot push failed.");
        setStep("prepush");
      } finally {
        setPushProgress(null);
      }
    },
    [enrichedListType, eventContext, reviewRows],
  );

  const bc = breadcrumbIndex(step);

  return (
    <div className="flex min-h-screen flex-1 flex-col bg-(--bg-page)">
      <header className="fixed top-0 left-0 right-0 z-50 grid h-14 w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 bg-(--realm-navy) px-4 shadow-(--shadow-card) sm:px-6">
        <div className="min-w-0 font-bold text-lg tracking-tight">
          <span className="text-(--realm-purple)">Realm</span>
          <span className="text-white">.Security</span>
        </div>
        <nav
          className="flex max-w-[min(100vw-8rem,40rem)] flex-wrap items-center justify-center gap-x-0.5 gap-y-1 text-center text-[10px] leading-tight sm:max-w-none sm:text-xs md:text-sm"
          aria-label="Import steps"
        >
          {NAV_STEPS.map((label, i) => {
            const isCurrent = i === bc;
            const isDone = i < bc;
            return (
              <span key={label} className="inline-flex items-center">
                {i > 0 ? (
                  <span className="px-0.5 text-white/40 sm:px-1" aria-hidden>
                    ·
                  </span>
                ) : null}
                <span
                  className={
                    isCurrent
                      ? "font-bold text-white"
                      : isDone
                        ? "font-medium text-white/75"
                        : "font-medium text-(--realm-navy-muted)"
                  }
                >
                  {label}
                </span>
              </span>
            );
          })}
        </nav>
        <div className="min-w-0" aria-hidden />
      </header>

      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 pb-8 pt-14 sm:px-6">
        {step === "upload" && !result && (
          <section
            className={`relative flex min-h-55 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-(--border-default) bg-(--bg-card) px-6 py-10 transition-colors ${
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

        {step === "upload" && result && file && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-(--border-default) bg-(--bg-card) px-4 py-3 text-sm shadow-(--shadow-card)">
            <span className="font-semibold text-(--color-success)">File Loaded</span>
            <span className="text-(--text-secondary)">·</span>
            <span className="font-medium text-(--text-primary)">{file.name}</span>
            <span className="text-(--text-muted)">
              · {effectiveRowCount} {effectiveRowCount === 1 ? "row" : "rows"}
            </span>
            <button
              type="button"
              className="ml-auto text-sm font-medium text-(--realm-purple) hover:text-(--realm-purple-hover) hover:underline"
              onClick={() => {
                startNewImport();
              }}
            >
              × Change File
            </button>
          </div>
        )}

        {busy && step === "upload" && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400" role="status">
            Parsing…
          </p>
        )}

        {error && (
          <div
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-100"
            role="alert"
          >
            {error}
          </div>
        )}

        {result && file && step === "upload" && (
          <section className="flex flex-col gap-4 rounded-xl border border-(--border-default) bg-(--bg-card) p-5 shadow-(--shadow-card) sm:p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-(--text-muted)">File Name</p>
                <p className="text-base font-semibold text-(--text-primary)">{file.name}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-medium text-(--text-muted)">Rows Parsed</p>
                <p className="text-base font-semibold tabular-nums text-(--text-primary)">
                  {effectiveRowCount}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium text-(--text-secondary)">Detected List Type</span>
              <span className="rounded-full bg-(--bg-muted) px-3 py-1 text-sm font-medium text-(--text-primary)">
                {result.listType === "unknown" ? "Unknown" : result.listType}
              </span>
            </div>

            {result.listType === "unknown" && (
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-950/50">
                <p className="text-sm font-medium">This file does not match a known header pattern.</p>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                  Choose how to interpret the columns, then apply to re-parse.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                      listOverride === "companies"
                        ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                        : "bg-white ring-1 ring-zinc-300 hover:bg-zinc-100 dark:bg-zinc-900 dark:ring-zinc-600 dark:hover:bg-zinc-800"
                    }`}
                    onClick={() => setListOverride("companies")}
                  >
                    Company list
                  </button>
                  <button
                    type="button"
                    className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                      listOverride === "contacts"
                        ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                        : "bg-white ring-1 ring-zinc-300 hover:bg-zinc-100 dark:bg-zinc-900 dark:ring-zinc-600 dark:hover:bg-zinc-800"
                    }`}
                    onClick={() => setListOverride("contacts")}
                  >
                    Contact list
                  </button>
                  <button
                    type="button"
                    disabled={!listOverride || busy}
                    className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => {
                      if (!file || !listOverride) return;
                      void parseFile(file, listOverride);
                    }}
                  >
                    Apply &amp; re-parse
                  </button>
                </div>
              </div>
            )}

            {result.multiEvent?.segments && result.multiEvent.segments.length > 1 && (
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium" htmlFor="segment">
                  Segment (multi-event file)
                </label>
                <select
                  id="segment"
                  className="max-w-md rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-950"
                  value={segmentIndex}
                  onChange={(e) => setSegmentIndex(Number(e.target.value))}
                >
                  {result.multiEvent.segments.map((s, i) => (
                    <option key={`${s.label}-${i}`} value={i}>
                      {s.label} — {s.rows.length} rows
                    </option>
                  ))}
                </select>
              </div>
            )}

            {duplicatePair && resolvedListType ? (
              <div
                className="rounded-xl border border-(--border-default) border-l-4 border-l-(--color-warning) bg-(--color-warning-bg) p-4 shadow-(--shadow-card)"
                role="region"
                aria-label="Duplicate rows"
              >
                <p className="text-sm font-medium text-(--text-primary)">
                  Duplicate rows detected (rows {duplicatePair[0] + 1} and {duplicatePair[1] + 1}). Choose how
                  to proceed.
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {[duplicatePair[0], duplicatePair[1]].map((idx, col) => {
                    const isSecond = idx === duplicatePair[1];
                    return (
                      <div
                        key={`${idx}-${col}`}
                        className="relative overflow-x-auto rounded-lg border border-(--border-default) bg-(--bg-muted)"
                      >
                        {isSecond ? (
                          <span className="absolute right-2 top-2 z-10 rounded bg-(--color-warning) px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                            Duplicate
                          </span>
                        ) : null}
                        <table className="min-w-full text-left text-xs sm:text-sm">
                          <thead className="bg-(--bg-page)">
                            <tr>
                              {previewKeys.map((k) => (
                                <th
                                  key={k}
                                  className="border-b border-(--border-default) px-2 py-1.5 font-semibold text-(--text-secondary)"
                                >
                                  {k}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              {previewKeys.map((k) => (
                                <td
                                  key={k}
                                  className="border-b border-(--border-default) px-2 py-1.5 text-(--text-primary)"
                                >
                                  {(workingRows[idx] as Record<string, string | undefined>)[k] ?? ""}
                                </td>
                              ))}
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded-lg bg-(--color-warning) px-3 py-2 text-sm font-medium text-white transition-colors hover:opacity-90"
                    onClick={() => {
                      const [a, b] = duplicatePair;
                      const removeIdx = Math.max(a, b);
                      setPreviewRowsOverride(workingRows.filter((_, i) => i !== removeIdx) as typeof workingRows);
                      setDupFeedback("removed");
                    }}
                  >
                    Remove Duplicate
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-(--border-default) bg-white px-3 py-2 text-sm font-medium text-(--text-primary) transition-colors hover:bg-(--bg-muted)"
                    onClick={() => {
                      const [a, b] = duplicatePair;
                      setDuplicateExemptPairs((prev) => new Set(prev).add(`${a}-${b}`));
                      setDupFeedback("kept");
                    }}
                  >
                    Keep Both
                  </button>
                </div>
              </div>
            ) : null}

            {!duplicatePair && dupFeedback === "removed" ? (
              <div
                className="rounded-xl border border-(--border-default) border-l-4 border-l-(--color-success) bg-(--color-success-bg) px-4 py-3 text-sm font-medium text-(--text-primary) shadow-(--shadow-card)"
                role="status"
              >
                ✓ Duplicate removed — 1 row cleaned
              </div>
            ) : null}

            {!duplicatePair && dupFeedback === "kept" ? (
              <div
                className="rounded-xl border border-(--border-default) bg-(--bg-muted) px-4 py-3 text-sm font-medium text-(--text-secondary) shadow-(--shadow-card)"
                role="status"
              >
                Both rows kept
              </div>
            ) : null}

            {duplicatePair ? null : result.warnings.length > 0 ? (
              <div className="flex flex-col gap-2">
                {result.warnings.map((w) => (
                  <div
                    key={w}
                    className="rounded-lg border border-(--border-default) bg-(--color-warning-bg) px-4 py-3 text-sm text-(--text-primary)"
                    role="status"
                  >
                    {w}
                  </div>
                ))}
              </div>
            ) : null}

            <div>
              <h2 className="text-sm font-semibold text-(--realm-navy)">Raw Preview</h2>
              <p className="mt-1 text-xs text-(--text-muted)">
                Showing all {Math.min(effectiveRowCount, PREVIEW_MAX_ROWS)} rows
                {effectiveRowCount > PREVIEW_MAX_ROWS ? " (first 50 shown)" : ""} · Effective list type:{" "}
                <span className="font-medium text-(--text-secondary)">{effectiveListType}</span>
              </p>
              <div className="mt-3 max-h-72 overflow-y-auto overflow-x-auto rounded-lg border border-(--border-default)">
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
                        className={
                          ri % 2 === 0 ? "bg-(--bg-card)" : "bg-(--bg-page)"
                        }
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
            </div>

            <div className="flex justify-end border-t border-(--border-default) pt-4">
              <button
                type="button"
                disabled={!resolvedListType || effectiveRowCount === 0 || duplicatePair !== null}
                onClick={() => setStep("context")}
                className="rounded-lg bg-(--realm-purple) px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-(--realm-purple-hover) disabled:cursor-not-allowed disabled:opacity-50"
              >
                Continue To Event Context
              </button>
            </div>
          </section>
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
            <EnrichmentProgress
              mode="enriching"
              startRow={progress.startRow}
              endRow={progress.endRow}
              totalRows={progress.totalRows}
            />
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
            mode="verifying"
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
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              {enriched.length} {enrichedListType === "companies" ? "companies" : "contacts"} — AI
              enrichment{enrichError ? "" : ", ZoomInfo, and Common Room"} applied
              {enrichError ? " (ZoomInfo / Common Room step failed; showing AI results)." : "."}
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
            defaultLeadSourceDescription={eventContext.eventName}
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
