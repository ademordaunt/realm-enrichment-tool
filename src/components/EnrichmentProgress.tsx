"use client";

export interface EnrichmentProgressProps {
  startRow: number;
  endRow: number;
  totalRows: number;
  /** Shown above the bar. */
  verifyTitle?: string;
  /** Sub-line below the bar for verifying (e.g. Common Room / ZoomInfo status). */
  verifyDetail?: string | null;
}

export function EnrichmentProgress({
  startRow,
  endRow,
  totalRows,
  verifyTitle,
  verifyDetail,
}: EnrichmentProgressProps) {
  const pct =
    totalRows > 0 ? Math.min(100, Math.round((endRow / totalRows) * 100)) : 0;

  return (
    <div className="rounded-xl border border-(--border-default) bg-(--bg-card) p-5 shadow-(--shadow-card)">
      {verifyTitle ? (
        <p
          className="text-center text-sm font-semibold text-(--text-primary)"
          role="status"
        >
          {verifyTitle}
        </p>
      ) : null}
      <p
        className={`text-center text-sm font-medium text-(--text-primary) ${
          verifyTitle ? "mt-2" : ""
        }`}
        role="status"
      >
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
      {verifyDetail ? (
        <p className="mt-2 text-center text-sm text-(--text-muted)">{verifyDetail}</p>
      ) : null}
    </div>
  );
}
