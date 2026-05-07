"use client";

import { useMemo } from "react";

const PRIMARY_ACTION_BUTTON =
  "rounded-lg bg-(--realm-purple) px-4 py-2 text-sm font-semibold text-white hover:bg-(--realm-purple-hover) disabled:cursor-not-allowed disabled:opacity-50";

const cardClass =
  "rounded-xl border border-(--border-default) bg-(--bg-card) p-6 shadow-(--shadow-card) sm:p-8";

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

export interface CostEstimateScreenProps {
  totalRows: number;
  hubspotCompleteCount: number;
  onProceed: () => void;
  onBack: () => void;
}

export function CostEstimateScreen({
  totalRows,
  hubspotCompleteCount,
  onProceed,
  onBack,
}: CostEstimateScreenProps) {
  const needEnrichment = Math.max(0, totalRows - hubspotCompleteCount);
  const ziLow = Math.round(needEnrichment * 0.6);
  const ziHigh = Math.round(needEnrichment * 0.8);
  const anthLow = ((needEnrichment / 3) * 0.015).toFixed(2);
  const anthHigh = ((needEnrichment / 3) * 0.015 + (needEnrichment * 0.3 * 0.02)).toFixed(2);

  const runTimeLabel = useMemo(() => {
    const zoomInfoMinutes = Math.round((needEnrichment / 25) * 0.5);
    const aiMinutes = Math.round((needEnrichment / 3) * 0.4);
    const linkedInMinutes = Math.round(needEnrichment * 0.3 * 0.1);
    const totalMinutes = zoomInfoMinutes + aiMinutes + linkedInMinutes + 5;

    if (totalMinutes < 60) {
      return `~${totalMinutes} minute${totalMinutes === 1 ? "" : "s"}`;
    }

    const roundedToHalfHour = Math.max(60, Math.round(totalMinutes / 30) * 30);
    const hours = Math.floor(roundedToHalfHour / 60);
    const minutes = roundedToHalfHour % 60;
    if (minutes === 0) {
      return `~${hours} hour${hours === 1 ? "" : "s"}`;
    }
    return `~${hours} hour${hours === 1 ? "" : "s"} ${minutes} minutes`;
  }, [needEnrichment]);

  const rowClass = "flex justify-between gap-4 border-b border-(--border-default) pb-2 last:border-b-0 last:pb-0";

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 py-10">
      <div className={cardClass}>
        <h1 className="text-lg font-semibold text-(--realm-navy) sm:text-xl">Import Cost Estimate</h1>

        <div className="mt-6 space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-(--text-muted)">
            Record summary
          </h2>
          <dl className="space-y-3 text-sm">
            <div className={rowClass}>
              <dt className="text-(--text-muted)">Records uploaded</dt>
              <dd className="font-medium tabular-nums text-(--text-primary)">{fmtInt(totalRows)}</dd>
            </div>
            <div className={rowClass}>
              <dt className="text-(--text-muted)">Already in HubSpot (complete)</dt>
              <dd className="font-medium tabular-nums text-(--text-primary)">
                {fmtInt(hubspotCompleteCount)}
              </dd>
            </div>
            <div className={rowClass}>
              <dt className="text-(--text-muted)">Need enrichment</dt>
              <dd className="font-medium tabular-nums text-(--text-primary)">{fmtInt(needEnrichment)}</dd>
            </div>
          </dl>
        </div>

        <hr className="my-6 border-(--border-default)" />

        <div className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-(--text-muted)">
            Estimated costs
          </h2>
          <dl className="space-y-3 text-sm">
            <div className={rowClass}>
              <dt className="text-(--text-muted)">Estimated ZoomInfo credits</dt>
              <dd className="text-right font-medium tabular-nums text-(--text-primary)">
                {fmtInt(ziLow)}–{fmtInt(ziHigh)}
              </dd>
            </div>
            <div className={rowClass}>
              <dt className="text-(--text-muted)">Estimated Anthropic cost</dt>
              <dd className="font-medium text-(--text-primary)">
                ~${anthLow}–${anthHigh}
              </dd>
            </div>
            <div className={rowClass}>
              <dt className="text-(--text-muted)">Estimated run time</dt>
              <dd className="font-medium text-(--text-primary)">{runTimeLabel}</dd>
            </div>
          </dl>
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg border border-(--border-default) bg-white px-4 py-2 text-sm font-medium text-(--text-primary) hover:bg-(--bg-muted)"
          >
            ← Back
          </button>
          <button type="button" onClick={onProceed} className={PRIMARY_ACTION_BUTTON}>
            Proceed with Enrichment →
          </button>
        </div>
      </div>
    </div>
  );
}
