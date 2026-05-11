"use client";

import dynamic from "next/dynamic";
import { CostEstimateScreen } from "@/components/CostEstimateScreen";
import { EnrichingStep } from "@/components/EnrichingStep";
import { PushingStep } from "@/components/PushingStep";
import { PrePushSkeleton } from "@/components/PrePushSkeleton";
import { ReviewTableSkeleton } from "@/components/ReviewTableSkeleton";
import { StarterScreen } from "@/components/StarterScreen";
import { UploadStep } from "@/components/UploadStep";
import { SuccessScreen } from "@/components/SuccessScreen";
import type { PrePushSettings } from "@/components/PrePushScreen";
import { applyInitialReviewStatus } from "@/lib/utils/review-status";
import { finalizeRowsForReview } from "@/lib/utils/prereview";
import { useEnrichmentPipeline } from "@/hooks/useEnrichmentPipeline";
import { useBulkJob } from "@/hooks/useBulkJob";
import { useWizardSession } from "@/hooks/useWizardSession";
import { useHubSpotPush, MANUAL_EDITS_SESSION_KEY } from "@/hooks/useHubSpotPush";
import type {
  EnrichedCompany, EnrichedContact, EventContext,
  ListType, ParseResponse, RawCompanyRow, RawContactRow,
} from "@/lib/utils/types";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

const EventContextForm = dynamic(
  () => import("@/components/EventContextForm").then((m) => ({ default: m.EventContextForm })),
  { loading: () => null },
);
const PrePushScreen = dynamic(
  () => import("@/components/PrePushScreen").then((m) => ({ default: m.PrePushScreen })),
  { loading: () => <PrePushSkeleton /> },
);
const ReviewTable = dynamic(
  () => import("@/components/ReviewTable").then((m) => ({ default: m.ReviewTable })),
  { loading: () => <ReviewTableSkeleton /> },
);
const PreReviewGate = dynamic(
  () => import("@/components/PreReviewGate").then((m) => ({ default: m.PreReviewGate })),
  { loading: () => null },
);

const NAV_STEPS = ["Upload", "Event Context", "Enrichment", "Review & Edit", "Import Settings", "Complete"] as const;

type Step =
  | "starter" | "upload" | "context" | "enriching" | "verifying"
  | "costestimate" | "prereview" | "enriched" | "prepush" | "pushing" | "complete";

type PersistedManualLinkedInEdits = {
  rows: Array<{ stableKey: string; linkedinUrl: string }>;
};

const MONTH_LONG_TO_ABBREV: Record<string, string> = {
  january: "Jan.", february: "Feb.", march: "Mar.", april: "Apr.", may: "May.",
  june: "Jun.", july: "Jul.", august: "Aug.", september: "Sep.", october: "Oct.",
  november: "Nov.", december: "Dec.",
};

function formatContactDefaultLeadSourceDescription(ctx: EventContext): string {
  const name = ctx.eventName.trim();
  const parts = ctx.eventDate.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return name || ctx.eventDate.trim();
  const year = parts[parts.length - 1]!;
  const monthPart = parts.slice(0, -1).join(" ");
  const abbrev = MONTH_LONG_TO_ABBREV[monthPart.toLowerCase()] ?? `${monthPart.slice(0, 3)}.`;
  return `${name} ${abbrev} ${year}`.trim();
}

function breadcrumbIndex(s: Step): number {
  switch (s) {
    case "starter": return -1;
    case "upload": return 0;
    case "context": return 1;
    case "enriching": case "verifying": case "costestimate": return 2;
    case "prereview": case "enriched": return 3;
    case "prepush": case "pushing": return 4;
    case "complete": return 5;
    default: return 0;
  }
}

function apiJsonErrorMessage(o: { error?: string; detail?: string }): string {
  if (typeof o.detail === "string" && o.detail.length > 0) return o.detail;
  if (typeof o.error === "string" && o.error.length > 0) return o.error;
  return "";
}

async function fetchManualEditsMap(
  rows: EnrichedCompany[] | EnrichedContact[],
  listType: "companies" | "contacts",
): Promise<Map<string, Record<string, unknown>>> {
  const stableKeys = new Set<string>();
  for (const row of rows) {
    const key = listType === "contacts"
      ? (row as EnrichedContact).resolvedEmail?.trim().toLowerCase() ?? ""
      : (row as EnrichedCompany).domain?.trim().toLowerCase() ?? "";
    if (key) stableKeys.add(key);
  }
  if (stableKeys.size === 0) return new Map();
  try {
    const res = await fetch("/api/manual-edits/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys: Array.from(stableKeys), listType }),
      cache: "no-store",
    });
    if (!res.ok) return new Map();
    const payload = (await res.json()) as { edits?: Record<string, Record<string, unknown>> };
    const out = new Map<string, Record<string, unknown>>();
    for (const [key, value] of Object.entries(payload.edits ?? {})) {
      if (value && typeof value === "object" && !Array.isArray(value)) out.set(key, value);
    }
    return out;
  } catch {
    return new Map();
  }
}

export default function Home() {
  const [step, setStep] = useState<Step>("starter");
  const [wizardImportMode, setWizardImportMode] = useState<"event" | "bulk">("event");
  const [bulkSmallListBypass, setBulkSmallListBypass] = useState(false);
  const [showEnrichmentInterruptedBanner, setShowEnrichmentInterruptedBanner] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enrichError, setEnrichError] = useState<string | null>(null);
  const [zoomInfoVerifySummary, setZoomInfoVerifySummary] = useState<
    | { kind: "success"; enrichedCount: number; cachedCount: number; creditsUsed: number; listType: "companies" | "contacts" }
    | { kind: "no_matches" }
    | { kind: "credentials" }
    | null
  >(null);
  const [result, setResult] = useState<ParseResponse | null>(null);
  const [listOverride, setListOverride] = useState<"companies" | "contacts" | null>(null);
  const [segmentIndex, setSegmentIndex] = useState(0);
  const [progress, setProgress] = useState<{ startRow: number; endRow: number; totalRows: number; detail?: string | null; fromCache?: boolean } | null>(null);
  const [enriched, setEnriched] = useState<EnrichedCompany[] | EnrichedContact[] | null>(null);
  const [enrichedListType, setEnrichedListType] = useState<"companies" | "contacts" | null>(null);
  const [reviewRows, setReviewRows] = useState<EnrichedCompany[] | EnrichedContact[]>([]);
  const [eventContext, setEventContext] = useState<EventContext | null>(null);
  const [previewRowsOverride, setPreviewRowsOverride] = useState<Array<RawCompanyRow | RawContactRow> | null>(null);
  const [duplicateExemptPairs, setDuplicateExemptPairs] = useState<Set<string>>(() => new Set());
  const [dupFeedback, setDupFeedback] = useState<"removed" | "kept" | null>(null);
  const [duplicateSessionTotal, setDuplicateSessionTotal] = useState<number | null>(null);
  const [removeAllDupConfirm, setRemoveAllDupConfirm] = useState<string | null>(null);
  const [showSuccessFlash, setShowSuccessFlash] = useState(false);
  const [isReviewTableReady, setIsReviewTableReady] = useState(true);

  const stepContentRef = useRef<HTMLDivElement>(null);
  const parseRequestIdRef = useRef(0);
  const restoredManualEditsRef = useRef(false);
  const restoredApprovedIdsRef = useRef<Set<string> | null>(null);
  const uploadFlashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const removeAllDupMsgTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionResetRef = useRef<() => void>(() => {});

  const effectiveListType: ListType = useMemo(() => {
    if (!result) return "unknown";
    if (result.multiEvent?.segments?.length) {
      const seg = result.multiEvent.segments[segmentIndex];
      if (seg?.listType && seg.listType !== "unknown") return seg.listType;
    }
    if (result.listType === "unknown" && listOverride) return listOverride;
    return result.listType;
  }, [listOverride, result, segmentIndex]);

  const resolvedListType: "companies" | "contacts" | null = useMemo(() => {
    if (effectiveListType === "companies" || effectiveListType === "contacts") return effectiveListType;
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

  const activeNormalizedHeaders = useMemo(() => {
    if (!result) return [] as string[];
    if (result.multiEvent?.segments?.length) return result.multiEvent.segments[segmentIndex]?.headers ?? result.headers ?? [];
    return result.headers ?? [];
  }, [result, segmentIndex]);

  const activeOriginalHeaders = useMemo(() => {
    if (!result) return [] as string[];
    if (result.multiEvent?.segments?.length) return result.multiEvent.segments[segmentIndex]?.originalHeaders ?? result.originalHeaders ?? [];
    return result.originalHeaders ?? [];
  }, [result, segmentIndex]);

  const approvedRowsForPush = useMemo(() => reviewRows.filter((r) => r.status === "approved"), [reviewRows]);

  const approvedRowsById = useMemo(() => {
    const byId = new Map<string, { displayName: string }>();
    for (const row of approvedRowsForPush) {
      if ("rawInput" in row) byId.set(row.id, { displayName: row.resolvedName });
      else byId.set(row.id, { displayName: `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim() });
    }
    return byId;
  }, [approvedRowsForPush]);

  const advanceToReview = useCallback(
    async (rows: EnrichedCompany[] | EnrichedContact[], listType: "companies" | "contacts") => {
      const manualEdits = await fetchManualEditsMap(rows, listType);
      const finalizeOpts = { importMode: wizardImportMode, manualEdits };
      const finalized = listType === "companies"
        ? finalizeRowsForReview(rows as EnrichedCompany[], "companies", finalizeOpts)
        : finalizeRowsForReview(rows as EnrichedContact[], "contacts", finalizeOpts);
      setEnriched(finalized);
      setEnrichedListType(listType);
      setStep("prereview");
    },
    [wizardImportMode],
  );

  // Hooks — call order matters (each uses outputs of prior ones)
  const bulk = useBulkJob({
    resolvedListType, workingRows, setStep, setEventContext, setEnrichError,
    setZoomInfoVerifySummary, setProgress, setShowEnrichmentInterruptedBanner,
    advanceToReview,
    onCancelComplete: useCallback(() => sessionResetRef.current(), []),
  });

  const enrichPipeline = useEnrichmentPipeline({
    resolvedListType, workingRows, wizardImportMode, setStep, setEventContext,
    setProgress, setEnrichError, setZoomInfoVerifySummary, advanceToReview,
    stopJobPolling: bulk.stopJobPolling,
  });

  const push = useHubSpotPush({
    enrichedListType, eventContext, reviewRows, setStep,
    setShowEnrichmentCompleteBanner: enrichPipeline.setShowEnrichmentCompleteBanner,
    setCompletionBannerText: enrichPipeline.setCompletionBannerText,
    enrichmentBannerTimeoutRef: enrichPipeline.enrichmentBannerTimeoutRef,
  });

  const { resetPipeline } = enrichPipeline;
  const onResetEnrichment = useCallback(() => {
    resetPipeline();
    setZoomInfoVerifySummary(null);
  }, [resetPipeline, setZoomInfoVerifySummary]);

  const { setPushResult, setPushError, setLastPushLeadSource } = push;
  const { setBulkJobId, resetBulkJob } = bulk;
  const { setShowEnrichmentCompleteBanner, enrichmentBannerTimeoutRef } = enrichPipeline;

  const session = useWizardSession({
    step, wizardImportMode, enriched, approvedRowsForPush, eventContext, enrichedListType, result,
    setStep, setWizardImportMode, setEnriched, setEnrichedListType, setListOverride, setEventContext,
    setResult, setShowEnrichmentInterruptedBanner, setBulkJobId,
    setSegmentIndex, setFile, setReviewRows,
    setPushResult, setPushError, setLastPushLeadSource,
    setEnrichError, setError, setProgress, setPreviewRowsOverride, setDuplicateExemptPairs,
    setDupFeedback, setDuplicateSessionTotal, setRemoveAllDupConfirm, setShowSuccessFlash,
    setShowEnrichmentCompleteBanner,
    setBulkSmallListBypass,
    onResetEnrichment,
    onResetBulkJob: resetBulkJob,
    restoredApprovedIdsRef,
    enrichmentBannerTimeoutRef,
    uploadFlashTimeoutRef,
    removeAllDupMsgTimeoutRef,
  });

  // Wire circular dep: cancelBulkJob → sessionReset (must be in effect, not inline during render)
  const { resetToUpload } = session;
  useEffect(() => {
    sessionResetRef.current = () => resetToUpload(true);
  });

  // Initialize reviewRows from enriched data
  useLayoutEffect(() => {
    if (!enriched?.length || !enrichedListType) { queueMicrotask(() => setReviewRows([])); return; }
    restoredManualEditsRef.current = false;
    const seeded = applyInitialReviewStatus(enriched);
    const approvedIds = restoredApprovedIdsRef.current;
    if (!approvedIds || approvedIds.size === 0) { queueMicrotask(() => setReviewRows(seeded)); return; }
    const withRestored = seeded.map((row) => ({
      ...row,
      status: approvedIds.has(row.id) ? ("approved" as const) : row.status,
    })) as EnrichedCompany[] | EnrichedContact[];
    queueMicrotask(() => setReviewRows(withRestored));
    restoredApprovedIdsRef.current = null;
  }, [enriched, enrichedListType]);

  // Focus step content on navigation
  useEffect(() => { stepContentRef.current?.focus(); }, [step]);

  // Restore saved LinkedIn URLs from session on enriched step load
  useEffect(() => {
    if (step !== "enriched" || reviewRows.length === 0 || restoredManualEditsRef.current) return;
    if (!enrichedListType || typeof window === "undefined") return;
    const raw = window.sessionStorage.getItem(MANUAL_EDITS_SESSION_KEY);
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as PersistedManualLinkedInEdits;
      const savedRows = Array.isArray(saved?.rows) ? saved.rows : [];
      if (savedRows.length === 0) return;
      const savedByKey = new Map<string, string>();
      for (const r of savedRows) {
        const key = typeof r.stableKey === "string" ? r.stableKey.trim().toLowerCase() : "";
        const url = typeof r.linkedinUrl === "string" ? r.linkedinUrl.trim() : "";
        if (key && url) savedByKey.set(key, url);
      }
      if (savedByKey.size === 0) return;
      const merged = reviewRows.map((row) => {
        const stableKey = enrichedListType === "contacts"
          ? (row as EnrichedContact).resolvedEmail?.trim().toLowerCase() ?? ""
          : (row as EnrichedCompany).domain?.trim().toLowerCase() ?? "";
        if (!stableKey) return row;
        const savedLI = savedByKey.get(stableKey) ?? "";
        if (!savedLI || (row.linkedinUrl ?? "").trim()) return row;
        return { ...row, linkedinUrl: savedLI };
      }) as EnrichedCompany[] | EnrichedContact[];
      restoredManualEditsRef.current = true;
      queueMicrotask(() => setReviewRows(merged));
      window.sessionStorage.removeItem(MANUAL_EDITS_SESSION_KEY);
    } catch { /* ignore malformed */ }
  }, [step, reviewRows, enrichedListType]);

  // Reset upload dedup state on file/segment change
  useEffect(() => {
    queueMicrotask(() => {
      setPreviewRowsOverride(null);
      setDuplicateExemptPairs(new Set());
      setDupFeedback(null);
      setDuplicateSessionTotal(null);
      setRemoveAllDupConfirm(null);
    });
    if (removeAllDupMsgTimeoutRef.current) {
      clearTimeout(removeAllDupMsgTimeoutRef.current);
      removeAllDupMsgTimeoutRef.current = null;
    }
  }, [result, segmentIndex]);

  // Start bulk job polling when bulkJobId is set
  const { bulkJobId, startJobPolling, stopJobPolling } = bulk;
  useEffect(() => {
    if (bulkJobId && wizardImportMode === "bulk") startJobPolling(bulkJobId);
    return () => { stopJobPolling(); };
  }, [bulkJobId, wizardImportMode, startJobPolling, stopJobPolling]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (uploadFlashTimeoutRef.current) { clearTimeout(uploadFlashTimeoutRef.current); uploadFlashTimeoutRef.current = null; }
      if (removeAllDupMsgTimeoutRef.current) { clearTimeout(removeAllDupMsgTimeoutRef.current); removeAllDupMsgTimeoutRef.current = null; }
      if (enrichmentBannerTimeoutRef.current) { clearTimeout(enrichmentBannerTimeoutRef.current); enrichmentBannerTimeoutRef.current = null; }
    };
  }, [enrichmentBannerTimeoutRef]);

  const parseFile = useCallback(async (f: File, listType?: "companies" | "contacts") => {
    const thisRequestId = ++parseRequestIdRef.current;
    setBusy(true);
    setError(null);
    setBulkSmallListBypass(false);
    try {
      const body = new FormData();
      body.append("file", f);
      if (listType) body.append("listType", listType);
      const res = await fetch("/api/parse", { method: "POST", body });
      if (thisRequestId !== parseRequestIdRef.current) return;
      const json = (await res.json()) as ParseResponse & { error?: string; detail?: string };
      if (thisRequestId !== parseRequestIdRef.current) return;
      if (!res.ok || apiJsonErrorMessage(json)) {
        setResult(null); setShowSuccessFlash(false);
        setError(apiJsonErrorMessage(json) || `Request failed (${res.status})`);
        return;
      }
      setResult(json);
      setShowSuccessFlash(true);
      if (uploadFlashTimeoutRef.current) clearTimeout(uploadFlashTimeoutRef.current);
      uploadFlashTimeoutRef.current = setTimeout(() => { setShowSuccessFlash(false); uploadFlashTimeoutRef.current = null; }, 1500);
      setSegmentIndex(0);
      setStep("upload");
      setEnriched(null); setEnrichedListType(null); setEventContext(null);
      setPushResult(null); setPushError(null); setLastPushLeadSource(null);
      setPreviewRowsOverride(null);
      setDuplicateExemptPairs(new Set());
      if (json.listType !== "unknown") setListOverride(null);
    } catch (e) {
      setResult(null); setShowSuccessFlash(false);
      setError(e instanceof Error ? e.message : "Failed to upload file.");
    } finally {
      setBusy(false);
    }
  }, [setPushResult, setPushError, setLastPushLeadSource]);

  const onFiles = useCallback((files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    setFile(f);
    setListOverride(null);
    void parseFile(f);
  }, [parseFile]);

  const bc = breadcrumbIndex(step);
  const hasEnrichedRows = (enriched?.length ?? 0) > 0;
  const isPipelineRunning =
    (wizardImportMode === "event" && (step === "enriching" || step === "verifying")) ||
    (wizardImportMode === "bulk" && step === "enriching" &&
      (bulk.bulkJobState?.status === "queued" || bulk.bulkJobState?.status === "running"));
  const isEnrichmentProgressStep = step === "enriching" || step === "verifying";

  const { pushResult } = push;
  const onBreadcrumbClick = useCallback((index: number) => {
    if (isPipelineRunning || index === bc || index === 2) return;
    if (index === 5) { if (!pushResult) return; setStep("complete"); return; }
    if (index > bc) return;
    if (index === 0) {
      if (hasEnrichedRows) {
        if (!window.confirm("This will discard your enrichment results and return to upload. Continue?")) return;
        resetToUpload(true); return;
      }
      setStep("upload"); return;
    }
    if (index === 1) { setStep("context"); return; }
    if (index === 3) { setStep("enriched"); return; }
    if (index === 4) setStep("prepush");
  }, [bc, hasEnrichedRows, isPipelineRunning, pushResult, resetToUpload]);

  const signOut = useCallback(() => {
    void fetch("/api/auth/logout", { method: "POST" })
      .catch(() => {})
      .finally(() => { window.location.href = "/login"; });
  }, []);

  return (
    <div className="flex min-h-screen flex-1 flex-col bg-(--bg-page)">
      {enrichPipeline.showEnrichmentCompleteBanner ? (
        <motion.div
          initial={{ opacity: 0, scale: 1 }}
          animate={{ opacity: 1, scale: [1, 1.02, 1] }}
          transition={{ duration: 1, ease: "easeOut" }}
          className="fixed top-14 left-0 right-0 z-40 border-b border-emerald-700/20 bg-emerald-600 px-4 py-3 text-center text-sm font-medium text-white shadow-sm"
          role="status"
        >
          {enrichPipeline.completionBannerText}
        </motion.div>
      ) : null}

      <header className="fixed top-0 left-0 right-0 z-50 grid h-14 w-full grid-cols-1 items-center bg-(--realm-navy) px-4 shadow-(--shadow-card) sm:px-6 md:grid-cols-[1fr_auto_1fr]">
        <div className="min-w-0 whitespace-nowrap text-lg font-semibold tracking-tight text-white md:col-start-1 md:row-start-1" style={{ textShadow: "0 1px 3px rgba(0,0,0,0.4)" }}>
          <span className="text-white font-semibold">Realm</span><span className="text-white font-semibold">.Security</span>
        </div>
        {step !== "starter" ? (
          <nav className="hidden max-w-[min(100vw-8rem,40rem)] flex-wrap items-center justify-center gap-x-0.5 gap-y-1 text-center text-xs leading-tight sm:max-w-none md:col-start-2 md:row-start-1 md:flex md:text-sm" aria-label="Import steps">
            {NAV_STEPS.map((label, i) => {
              const isCurrent = i === bc;
              const isDone = i < bc;
              const isAllowedStep = i !== 2 && (i !== 5 || Boolean(push.pushResult));
              const isClickable = !isPipelineRunning && !isCurrent && ((isDone && isAllowedStep) || (i === 5 && Boolean(push.pushResult)));
              return (
                <span key={label} className="inline-flex items-center">
                  {i > 0 ? <span className="px-0.5 text-white/30 sm:px-1" aria-hidden>·</span> : null}
                  {isClickable ? (
                    <button type="button" onClick={() => onBreadcrumbClick(i)} className={isDone ? "cursor-pointer text-white/60 hover:text-white/90" : "cursor-pointer text-white/60"}>{label}</button>
                  ) : (
                    <span className={isCurrent ? "font-semibold text-white" : isDone ? "text-white/60" : "text-white/30"}>{label}</span>
                  )}
                </span>
              );
            })}
          </nav>
        ) : null}
        <div className="hidden min-w-0 md:col-start-3 md:row-start-1 md:flex md:justify-end">
          <button type="button" onClick={signOut} disabled={isEnrichmentProgressStep} className="rounded border border-white/30 px-2.5 py-1 text-xs font-medium text-white hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent">Sign Out</button>
        </div>
      </header>

      <main ref={stepContentRef} tabIndex={-1} className="mx-auto flex w-full max-w-7xl min-h-0 flex-1 flex-col gap-6 px-4 pb-8 pt-22 outline-none sm:px-6">
        {showEnrichmentInterruptedBanner ? (
          <div className="flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950 sm:flex-row sm:items-center sm:justify-between dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-100" role="status">
            <p className="text-sm">Enrichment was interrupted. Click Run to start again.</p>
            <button type="button" onClick={() => setShowEnrichmentInterruptedBanner(false)} className="shrink-0 rounded-lg border border-amber-800/20 bg-white px-3 py-1.5 text-sm font-medium text-amber-950 hover:bg-amber-100 dark:border-amber-600/40 dark:bg-amber-900/60 dark:text-amber-50 dark:hover:bg-amber-900">Dismiss</button>
          </div>
        ) : null}

        {isEnrichmentProgressStep ? (
          <EnrichingStep
            step={step}
            wizardImportMode={wizardImportMode}
            bulkJobId={bulk.bulkJobId}
            bulkJobState={bulk.bulkJobState}
            consecutivePollingErrors={bulk.consecutivePollingErrors}
            bulkPollingInFlight={bulk.isPollingInFlight}
            bulkRowsContinueLoading={bulk.bulkRowsContinueLoading}
            progress={progress}
            resolvedListType={resolvedListType}
            pipelineCompleteHold={enrichPipeline.pipelineCompleteHold}
            cancelBulkJob={bulk.cancelBulkJob}
            retryStatusPollNow={bulk.retryStatusPollNow}
            handleContinueToReview={bulk.handleContinueToReview}
            cancelEnrichmentToContext={enrichPipeline.cancelEnrichmentToContext}
          />
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={step}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
            >
              {step === "starter" && (
                <StarterScreen onSelectMode={(mode) => { setWizardImportMode(mode); setStep("upload"); }} />
              )}

              {step === "costestimate" && enrichPipeline.costEstimateMeta ? (
                <CostEstimateScreen
                  totalRows={enrichPipeline.costEstimateMeta.totalRows}
                  hubspotCompleteCount={enrichPipeline.costEstimateMeta.hubspotCompleteCount}
                  onProceed={enrichPipeline.proceedFromCostEstimate}
                  onBack={enrichPipeline.backFromCostEstimate}
                />
              ) : null}

              {step === "upload" && (
                <UploadStep
                  wizardImportMode={wizardImportMode}
                  bulkSmallListBypass={bulkSmallListBypass}
                  file={file}
                  busy={busy}
                  error={error}
                  result={result}
                  showSuccessFlash={showSuccessFlash}
                  effectiveListType={effectiveListType}
                  effectiveRowCount={effectiveRowCount}
                  resolvedListType={resolvedListType}
                  workingRows={workingRows}
                  displayRows={displayRows}
                  previewRowsOverride={previewRowsOverride}
                  activeNormalizedHeaders={activeNormalizedHeaders}
                  activeOriginalHeaders={activeOriginalHeaders}
                  duplicateExemptPairs={duplicateExemptPairs}
                  dupFeedback={dupFeedback}
                  duplicateSessionTotal={duplicateSessionTotal}
                  removeAllDupConfirm={removeAllDupConfirm}
                  removeAllDupMsgTimeoutRef={removeAllDupMsgTimeoutRef}
                  onFiles={onFiles}
                  parseFile={parseFile}
                  startNewImport={session.startNewImport}
                  setStep={setStep}
                  setPreviewRowsOverride={setPreviewRowsOverride}
                  setDuplicateExemptPairs={setDuplicateExemptPairs}
                  setDupFeedback={setDupFeedback}
                  setRemoveAllDupConfirm={setRemoveAllDupConfirm}
                  setBulkSmallListBypass={setBulkSmallListBypass}
                  resetToUpload={resetToUpload}
                />
              )}

              {step === "context" && resolvedListType && (
                <div className="flex w-full flex-1 flex-col justify-center gap-4 py-6">
                  {enrichError && (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-100" role="alert">{enrichError}</div>
                  )}
                  <EventContextForm
                    listType={resolvedListType}
                    sourceFileName={file?.name ?? null}
                    initialValues={eventContext}
                    importMode={wizardImportMode}
                    onSubmit={(ctx) => wizardImportMode === "bulk" ? void bulk.startBulkJob(ctx) : void enrichPipeline.runEnrichment(ctx)}
                  />
                </div>
              )}

              {step === "prereview" && enriched && enrichedListType && (
                <PreReviewGate
                  rows={enriched}
                  listType={enrichedListType}
                  enrichmentSummary={enrichPipeline.eventEnrichmentSummary}
                  onContinue={(updatedRows) => {
                    const lt = enrichedListType!;
                    const finalizeOpts = { importMode: eventContext?.importMode ?? wizardImportMode };
                    const finalized = lt === "companies"
                      ? finalizeRowsForReview(updatedRows as EnrichedCompany[], "companies", finalizeOpts)
                      : finalizeRowsForReview(updatedRows as EnrichedContact[], "contacts", finalizeOpts);
                    setEnriched(finalized);
                    setIsReviewTableReady(false);
                    setStep("enriched");
                    void import("@/components/ReviewTable")
                      .then(() => setIsReviewTableReady(true))
                      .catch(() => setIsReviewTableReady(true));
                  }}
                />
              )}

              {step === "enriched" && enriched && enrichedListType && (
                <section className="rounded-xl border border-(--border-default) bg-(--bg-card) p-5 pb-24 shadow-(--shadow-card)">
                  {push.pushError && (
                    <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-100" role="alert">{push.pushError}</div>
                  )}
                  {enrichError && (
                    <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-700/80 dark:bg-amber-950/40 dark:text-amber-100" role="status">{enrichError}</div>
                  )}
                  {zoomInfoVerifySummary?.kind === "credentials" ? (
                    <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-700/80 dark:bg-amber-950/40 dark:text-amber-100" role="alert">ZoomInfo: credentials not configured</div>
                  ) : null}
                  <div className="mt-4">
                    {!isReviewTableReady || reviewRows.length === 0 ? (
                      <ReviewTableSkeleton />
                    ) : (
                      <ReviewTable
                        rows={reviewRows}
                        listType={enrichedListType}
                        onRowsChange={setReviewRows}
                        onApprove={() => { push.setPushError(null); setStep("prepush"); }}
                      />
                    )}
                  </div>
                </section>
              )}

              {step === "prepush" && enriched && enrichedListType && eventContext && approvedRowsForPush.length > 0 && (
                <PrePushScreen
                  listType={enrichedListType}
                  approvedRows={approvedRowsForPush}
                  defaultListName={eventContext.eventName}
                  defaultLeadSourceDescription={enrichedListType === "contacts" ? formatContactDefaultLeadSourceDescription(eventContext) : ""}
                  onPush={(settings: PrePushSettings) => void push.runHubSpotPush(settings)}
                />
              )}

              {step === "pushing" && push.pushProgress && (
                <PushingStep pushProgress={push.pushProgress} pushListCreatedMeta={push.pushListCreatedMeta} />
              )}

              {step === "complete" && push.pushResult && (
                <SuccessScreen
                  result={push.pushResult}
                  rowsById={approvedRowsById}
                  leadSourceUsed={push.lastPushLeadSource ?? undefined}
                  onStartNew={session.startNewImport}
                />
              )}
            </motion.div>
          </AnimatePresence>
        )}
      </main>
    </div>
  );
}
