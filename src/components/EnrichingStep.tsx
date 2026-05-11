"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";
import { EnrichmentProgressBars } from "@/components/EnrichmentProgressBars";
import type { Phase } from "@/components/EnrichmentProgressBars";
import type { BulkJobState } from "@/lib/utils/types";
import { ENRICHMENT_BATCH_SIZE } from "@/lib/enrichment/enrichment-utils";

const BulkProgressScreen = dynamic(
  () => import("@/components/BulkProgressScreen").then((m) => ({ default: m.BulkProgressScreen })),
  { loading: () => null },
);

type Step = "enriching" | "verifying";

type ProgressState = {
  startRow: number;
  endRow: number;
  totalRows: number;
  detail?: string | null;
  fromCache?: boolean;
} | null;

interface EnrichingStepProps {
  step: Step;
  wizardImportMode: "event" | "bulk";
  bulkJobId: string | null;
  bulkJobState: BulkJobState | null;
  consecutivePollingErrors: number;
  bulkPollingInFlight: boolean;
  bulkRowsContinueLoading: boolean;
  progress: ProgressState;
  resolvedListType: "companies" | "contacts" | null;
  pipelineCompleteHold?: boolean;
  cancelBulkJob: () => Promise<void>;
  retryStatusPollNow: () => Promise<void>;
  handleContinueToReview: () => Promise<void>;
  cancelEnrichmentToContext: () => void;
}

export function EnrichingStep({
  step, wizardImportMode, bulkJobId, bulkJobState, consecutivePollingErrors,
  bulkPollingInFlight, bulkRowsContinueLoading, progress, resolvedListType,
  pipelineCompleteHold = false,
  cancelBulkJob, retryStatusPollNow, handleContinueToReview, cancelEnrichmentToContext,
}: EnrichingStepProps) {
  const enrichmentBatchPercent = useMemo(() => {
    if (!progress || progress.totalRows <= 0) return 0;
    const totalBatches = Math.max(1, Math.ceil(progress.totalRows / ENRICHMENT_BATCH_SIZE));
    const currentBatch = Math.ceil(progress.endRow / ENRICHMENT_BATCH_SIZE);
    return Math.min(100, (currentBatch / totalBatches) * 100);
  }, [progress]);

  const eventPhases = useMemo((): Phase[] | null => {
    if (!progress) return null;
    if (pipelineCompleteHold) {
      return [
        { label: "AI Analysis", status: "complete", progress: 100 },
        { label: resolvedListType === "contacts" ? "ZoomInfo & Common Room Enrichment" : "ZoomInfo Verify", status: "complete", progress: 100 },
        { label: "HubSpot Check", status: "complete", progress: 100 },
        { label: "LinkedIn Search", status: "complete", progress: 100 },
      ];
    }
    const isEnriching = step === "enriching";
    const isVerifying = step === "verifying";
    const isVerifyingHubspot = isVerifying && Boolean(progress.detail?.includes("HubSpot"));
    const isVerifyingLinkedIn = isVerifying && Boolean(progress.detail?.includes("LinkedIn"));
    const isVerifyingZoom = isVerifying && !isVerifyingHubspot && !isVerifyingLinkedIn;
    const zoomPct = isVerifyingZoom && progress.totalRows > 0
      ? Math.min(100, Math.round((progress.endRow / progress.totalRows) * 100)) : 0;
    const linkedInPct = isVerifyingLinkedIn && progress.totalRows > 0
      ? Math.min(100, Math.round((progress.endRow / progress.totalRows) * 100)) : 0;
    return [
      {
        label: "AI Analysis",
        status: isEnriching ? "active" : "complete",
        progress: isEnriching ? enrichmentBatchPercent : 100,
      },
      {
        label: resolvedListType === "contacts" ? "ZoomInfo & Common Room Enrichment" : "ZoomInfo Verify",
        status: isEnriching ? "waiting" : isVerifyingZoom ? "active" : "complete",
        progress: isVerifyingZoom ? zoomPct : isEnriching ? 0 : 100,
        detail: isVerifyingZoom ? progress.detail : undefined,
      },
      {
        label: "HubSpot Check",
        status: isEnriching || isVerifyingZoom ? "waiting" : isVerifyingHubspot ? "active" : "complete",
        progress: isVerifyingHubspot ? 50 : 0,
      },
      {
        label: "LinkedIn Search",
        status: isVerifyingLinkedIn ? "active" : isEnriching || isVerifyingZoom || isVerifyingHubspot ? "waiting" : "complete",
        progress: linkedInPct,
        detail: isVerifyingLinkedIn ? progress.detail : undefined,
      },
    ];
  }, [step, progress, enrichmentBatchPercent, resolvedListType, pipelineCompleteHold]);

  if (wizardImportMode === "bulk" && bulkJobId) {
    return (
      <BulkProgressScreen
        jobState={bulkJobState}
        onCancel={() => { void cancelBulkJob(); }}
        onRetryStatusCheck={() => void retryStatusPollNow()}
        onContinueToReview={() => void handleContinueToReview()}
        continueLoading={bulkRowsContinueLoading}
        consecutivePollingErrors={consecutivePollingErrors}
        retryBusy={bulkPollingInFlight}
      />
    );
  }

  if (wizardImportMode === "event" && eventPhases) {
    return (
      <div className="flex flex-col gap-4">
        <EnrichmentProgressBars phases={eventPhases} />
        <p className="text-center text-sm text-(--text-muted)">
          You can leave this tab. We&apos;ll notify you when enrichment is complete.
        </p>
        <button
          type="button"
          className="self-center rounded-lg border border-(--border-default) bg-white px-4 py-2 text-sm font-medium text-(--text-primary) transition-colors hover:bg-(--bg-muted)"
          onClick={cancelEnrichmentToContext}
        >
          Cancel
        </button>
      </div>
    );
  }

  return null;
}
