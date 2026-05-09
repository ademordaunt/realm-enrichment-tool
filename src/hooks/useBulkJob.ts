"use client";

import { useCallback, useRef, useState } from "react";
import type { BulkJobState, EnrichedCompany, EnrichedContact, EventContext, RawCompanyRow, RawContactRow } from "@/lib/utils/types";

const BULK_JOB_SESSION_KEY = "realm-bulk-job-id";

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

interface BulkJobOptions {
  resolvedListType: "companies" | "contacts" | null;
  workingRows: Array<RawCompanyRow | RawContactRow>;
  setStep: (s: Step) => void;
  setEventContext: (ctx: EventContext | null) => void;
  setEnrichError: (e: string | null) => void;
  setZoomInfoVerifySummary: (s: null) => void;
  setProgress: (p: ProgressState) => void;
  setShowEnrichmentInterruptedBanner: (b: boolean) => void;
  advanceToReview: (rows: EnrichedCompany[] | EnrichedContact[], listType: "companies" | "contacts") => Promise<void>;
  onCancelComplete: () => void;
}

function playCompletionChime() {
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
  } catch { /* ignore */ }
}

function fireEnrichmentCompleteNotification() {
  if (typeof window === "undefined" || typeof Notification === "undefined") return;
  if (Notification.permission === "granted") {
    try {
      new Notification("Realm Enrichment Tool", {
        body: "Enrichment complete — ready for review!",
        icon: "/favicon.ico",
      });
    } catch { /* ignore */ }
  }
  playCompletionChime();
}

export function useBulkJob(options: BulkJobOptions) {
  const {
    resolvedListType, workingRows,
    setStep, setEventContext, setEnrichError, setZoomInfoVerifySummary,
    setProgress, setShowEnrichmentInterruptedBanner,
    advanceToReview, onCancelComplete,
  } = options;

  const [bulkJobId, setBulkJobId] = useState<string | null>(null);
  const [bulkJobState, setBulkJobState] = useState<BulkJobState | null>(null);
  const [consecutivePollingErrors, setConsecutivePollingErrors] = useState(0);
  const [bulkRowsContinueLoading, setBulkRowsContinueLoading] = useState(false);

  const bulkCompleteNotifiedRef = useRef(false);
  const bulkPollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollingInFlightRef = useRef(false);

  const stopJobPolling = useCallback(() => {
    if (bulkPollTimerRef.current) {
      clearInterval(bulkPollTimerRef.current);
      bulkPollTimerRef.current = null;
    }
  }, []);

  const startJobPolling = useCallback(
    (jobId: string) => {
      stopJobPolling();
      const tick = async () => {
        if (pollingInFlightRef.current) return;
        pollingInFlightRef.current = true;
        try {
          const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/status`, {
            method: "GET",
            cache: "no-store",
          });
          if (!res.ok) {
            setConsecutivePollingErrors((n) => n + 1);
            return;
          }
          const state = (await res.json()) as BulkJobState;
          setConsecutivePollingErrors(0);
          setBulkJobState(state);
          setProgress({
            startRow: 1,
            endRow: state.processedRows,
            totalRows: state.totalRows || 1,
            detail: `Bulk job ${state.currentPhase}: ${state.processedRows} of ${state.totalRows}`,
          });
          if (state.status === "complete") {
            stopJobPolling();
            if (!bulkCompleteNotifiedRef.current) {
              bulkCompleteNotifiedRef.current = true;
              fireEnrichmentCompleteNotification();
            }
            return;
          }
          if (state.status === "failed" || state.status === "cancelled") {
            stopJobPolling();
            return;
          }
        } catch (err) {
          console.error("[bulk-job] polling failed", err);
          setConsecutivePollingErrors((n) => n + 1);
        } finally {
          pollingInFlightRef.current = false;
        }
      };
      void tick();
      bulkPollTimerRef.current = setInterval(() => { void tick(); }, 5000);
    },
    [stopJobPolling, setProgress],
  );

  const loadCompletedBulkRows = useCallback(
    async (jobId: string, listType: "companies" | "contacts") => {
      const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/rows`, {
        method: "GET",
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Failed to load completed rows (${res.status})`);
      const payload = (await res.json()) as { rows: EnrichedCompany[] | EnrichedContact[] };
      await advanceToReview(payload.rows, listType);
      setShowEnrichmentInterruptedBanner(false);
      setProgress(null);
      if (typeof window !== "undefined") window.sessionStorage.removeItem(BULK_JOB_SESSION_KEY);
      setBulkJobId(null);
      setBulkJobState(null);
    },
    [advanceToReview, setShowEnrichmentInterruptedBanner, setProgress],
  );

  const handleContinueToReview = useCallback(async () => {
    const jobId = bulkJobId;
    const listType = bulkJobState?.listType;
    if (!jobId || !listType) return;
    setBulkRowsContinueLoading(true);
    setEnrichError(null);
    try {
      await loadCompletedBulkRows(jobId, listType);
    } catch (e) {
      setEnrichError(e instanceof Error ? e.message : "Failed to load completed rows.");
    } finally {
      setBulkRowsContinueLoading(false);
    }
  }, [bulkJobId, bulkJobState?.listType, loadCompletedBulkRows, setEnrichError]);

  const startBulkJob = useCallback(
    async (context: EventContext) => {
      if (!resolvedListType) return;
      setEventContext(context);
      setEnrichError(null);
      setZoomInfoVerifySummary(null);
      try {
        const res = await fetch("/api/jobs/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ listType: resolvedListType, eventContext: context, rows: workingRows }),
        });
        if (!res.ok) {
          const errBody = await res.text().catch(() => "unknown");
          console.error("[startBulkJob] failed:", res.status, errBody);
          setEnrichError("Failed to start bulk job. Please try again.");
          setStep("context");
          return;
        }
        const payload = (await res.json()) as { jobId?: string };
        const jobId = String(payload.jobId ?? "");
        if (!jobId) {
          setEnrichError("Failed to start bulk job. Please try again.");
          setStep("context");
          return;
        }
        setBulkJobId(jobId);
        bulkCompleteNotifiedRef.current = false;
        if (typeof window !== "undefined") window.sessionStorage.setItem(BULK_JOB_SESSION_KEY, jobId);
        setStep("enriching");
        startJobPolling(jobId);
      } catch {
        setEnrichError("Failed to start bulk job. Please try again.");
        setStep("context");
      }
    },
    [resolvedListType, workingRows, setEventContext, setEnrichError, setZoomInfoVerifySummary, setStep, startJobPolling],
  );

  const resetBulkJob = useCallback(() => {
    stopJobPolling();
    setBulkJobId(null);
    setBulkJobState(null);
    bulkCompleteNotifiedRef.current = false;
  }, [stopJobPolling]);

  const cancelBulkJob = useCallback(async () => {
    const activeJobId = bulkJobId;
    if (activeJobId) {
      try {
        await fetch(`/api/jobs/${encodeURIComponent(activeJobId)}/cancel`, { method: "POST" });
      } catch { /* best-effort */ }
    }
    stopJobPolling();
    setBulkJobId(null);
    setBulkJobState(null);
    bulkCompleteNotifiedRef.current = false;
    if (typeof window !== "undefined") window.sessionStorage.removeItem(BULK_JOB_SESSION_KEY);
    onCancelComplete();
  }, [bulkJobId, stopJobPolling, onCancelComplete]);

  return {
    bulkJobId,
    setBulkJobId,
    bulkJobState,
    consecutivePollingErrors,
    bulkRowsContinueLoading,
    startBulkJob,
    cancelBulkJob,
    handleContinueToReview,
    startJobPolling,
    stopJobPolling,
    resetBulkJob,
  };
}
