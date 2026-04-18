"use client";

export interface EnrichmentProgressProps {
  startRow: number;
  endRow: number;
  totalRows: number;
  mode: "enriching" | "verifying";
  /** Shown above the bar when `mode === "verifying"`. */
  verifyTitle?: string;
  /** Sub-line below the bar for verifying (e.g. Common Room / ZoomInfo status). */
  verifyDetail?: string | null;
}

export function EnrichmentProgress({
  startRow,
  endRow,
  totalRows,
  mode,
  verifyTitle,
  verifyDetail,
}: EnrichmentProgressProps) {
  const pct =
    totalRows > 0 ? Math.min(100, Math.round((endRow / totalRows) * 100)) : 0;

  return (
    <div className="rounded-xl border border-(--border-default) bg-(--bg-card) p-5 shadow-(--shadow-card)">
      {mode === "verifying" && verifyTitle ? (
        <p
          className="text-center text-sm font-semibold text-(--text-primary)"
          role="status"
        >
          {verifyTitle}
        </p>
      ) : null}
      <p
        className={`text-center text-sm font-medium text-(--text-primary) ${
          mode === "verifying" && verifyTitle ? "mt-2" : ""
        }`}
      >
        {pct}% complete
      </p>
      <p className="mt-1 text-center text-sm text-(--text-secondary)" role="status">
        Analyzing rows {startRow}–{endRow} of {totalRows}…
      </p>
      <div
        className="mt-3 h-2 w-full overflow-hidden rounded-full bg-(--bg-muted)"
        aria-hidden
      >
        <div
          className="h-full max-w-full rounded-full bg-(--realm-purple) transition-all duration-400 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      {mode === "enriching" ? (
        <p className="mt-2 text-center text-sm text-(--text-muted)">
          You can leave this tab — we&apos;ll notify you when enrichment is complete
        </p>
      ) : verifyDetail ? (
        <p className="mt-2 text-center text-sm text-(--text-muted)">{verifyDetail}</p>
      ) : null}
    </div>
  );
}
