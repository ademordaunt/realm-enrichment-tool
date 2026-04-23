"use client";

import { useEffect, useMemo, useState } from "react";
import type { BulkJobState } from "@/lib/utils/types";

interface BulkProgressScreenProps {
  jobState: BulkJobState | null;
  onCancel: () => void;
}

function formatStartedAt(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatRunningFor(startedAt: string, nowMs: number): string {
  const s = new Date(startedAt).getTime();
  if (!Number.isFinite(s)) return "—";
  const mins = Math.max(0, Math.floor((nowMs - s) / 60000));
  return `${mins} min`;
}

type PhaseState = "done" | "active" | "waiting";

function phaseIcon(state: PhaseState): string {
  if (state === "done") return "✅";
  if (state === "active") return "⏳";
  return "⬜";
}

export function BulkProgressScreen({ jobState, onCancel }: BulkProgressScreenProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [resumeBusy, setResumeBusy] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const pct = useMemo(() => {
    if (!jobState || jobState.totalRows <= 0) return 0;
    return Math.min(100, Math.round((jobState.processedRows / jobState.totalRows) * 100));
  }, [jobState]);

  if (!jobState) return null;

  const aiState: PhaseState = jobState.aiComplete
    ? "done"
    : jobState.currentPhase === "ai"
      ? "active"
      : "waiting";
  const precheckState: PhaseState = jobState.precheckComplete
    ? "done"
    : jobState.currentPhase === "precheck"
      ? "active"
      : "waiting";
  const zoomState: PhaseState = jobState.zoomInfoComplete
    ? "done"
    : jobState.currentPhase === "zoominfo"
      ? "active"
      : "waiting";
  const linkedInState: PhaseState = jobState.linkedInComplete
    ? "done"
    : jobState.currentPhase === "linkedin"
      ? "active"
      : "waiting";

  const startedAt = formatStartedAt(jobState.startedAt);
  const runningFor = formatRunningFor(jobState.startedAt, nowMs);

  const handleResume = async () => {
    if (!jobState?.jobId || resumeBusy) return;
    setResumeBusy(true);
    setResumeError(null);
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(jobState.jobId)}/resume`, {
        method: "POST",
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "unknown");
        throw new Error(`Resume failed (${res.status}): ${text}`);
      }
    } catch (err) {
      setResumeError(err instanceof Error ? err.message : "Failed to resume job.");
    } finally {
      setResumeBusy(false);
    }
  };

  if (jobState.status === "failed") {
    return (
      <div className="rounded-xl border border-(--border-default) bg-(--bg-card) p-5 shadow-(--shadow-card)">
        <p className="text-base font-semibold text-amber-700" role="alert">
          ⚠️ Enrichment failed
        </p>
        <p className="mt-2 text-sm text-(--text-primary)">{jobState.error || "Unknown error."}</p>
        {resumeError ? (
          <p className="mt-2 text-xs text-red-600" role="alert">
            {resumeError}
          </p>
        ) : null}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            disabled={resumeBusy}
            onClick={() => void handleResume()}
            className="rounded-lg bg-[#7B35C1] px-4 py-2 text-sm font-medium text-white hover:bg-[#6A2AAD] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {resumeBusy ? "Trying..." : "Try Again"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-(--border-default) bg-white px-4 py-2 text-sm font-medium text-(--text-primary) hover:bg-(--bg-muted)"
          >
            Start Over
          </button>
        </div>
      </div>
    );
  }

  if (jobState.status === "cancelled") {
    return (
      <div className="rounded-xl border border-(--border-default) bg-(--bg-card) p-5 shadow-(--shadow-card)">
        <p className="text-sm text-(--text-primary)">Import cancelled.</p>
        <button
          type="button"
          onClick={onCancel}
          className="mt-4 rounded-lg border border-(--border-default) bg-white px-4 py-2 text-sm font-medium text-(--text-primary) hover:bg-(--bg-muted)"
        >
          Start Over
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-(--border-default) bg-(--bg-card) p-5 shadow-(--shadow-card)">
      <p className="text-base font-semibold text-(--realm-navy)">
        {jobState.eventContext.eventName || "Bulk import"}
      </p>
      <p className="mt-1 text-sm text-(--text-muted)">
        Running in background — you can close this tab.
      </p>

      <div className="mt-4">
        <div className="h-2 w-full overflow-hidden rounded-full bg-(--bg-muted)" aria-hidden>
          <div
            className="h-full max-w-full rounded-full bg-(--realm-purple) transition-all duration-400 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-2 text-right text-xs text-(--text-muted)">{pct}%</p>
      </div>

      <div className="mt-4 space-y-2 text-sm text-(--text-primary)">
        <p>
          {phaseIcon(aiState)} AI cleaning{" "}
          <span className="text-(--text-muted)">
            {aiState === "active" ? `${jobState.processedRows} / ${jobState.totalRows}` : `${jobState.totalRows} / ${jobState.totalRows}`}
          </span>{" "}
          <span className="text-(--text-muted)">{aiState === "done" ? "complete" : aiState === "active" ? "in progress..." : "waiting"}</span>
        </p>
        <p>
          {phaseIcon(precheckState)} HubSpot check{" "}
          <span className="text-(--text-muted)">—</span>{" "}
          <span className="text-(--text-muted)">
            {precheckState === "done" ? "complete" : precheckState === "active" ? "in progress..." : "waiting"}
          </span>
        </p>
        <p>
          {phaseIcon(zoomState)} ZoomInfo enrichment{" "}
          <span className="text-(--text-muted)">
            {zoomState === "done"
              ? `${jobState.enrichedCount} enriched, ${jobState.hubspotSkippedCount} skipped`
              : "—"}
          </span>{" "}
          <span className="text-(--text-muted)">
            {zoomState === "done" ? "complete" : zoomState === "active" ? "in progress..." : "waiting"}
          </span>
        </p>
        <p>
          {phaseIcon(linkedInState)} LinkedIn search{" "}
          <span className="text-(--text-muted)">—</span>{" "}
          <span className="text-(--text-muted)">
            {linkedInState === "done" ? "complete" : linkedInState === "active" ? "in progress..." : "waiting"}
          </span>
        </p>
      </div>

      <p className="mt-4 text-xs text-(--text-muted)">
        Started: {startedAt} · Running for: {runningFor}
      </p>

      <button
        type="button"
        onClick={onCancel}
        className="mt-4 rounded-lg border border-(--border-default) bg-white px-4 py-2 text-sm font-medium text-(--text-primary) transition-colors hover:bg-(--bg-muted)"
      >
        Cancel Import
      </button>
    </div>
  );
}

