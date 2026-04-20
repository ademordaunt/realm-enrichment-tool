"use client";

export interface EnrichmentProgressProps {
  endRow: number;
  totalRows: number;
  /** ZoomInfo / verification status (e.g. “ZoomInfo enriching N of M companies”). */
  verifyDetail?: string | null;
}

export function EnrichmentProgress({ endRow, totalRows, verifyDetail }: EnrichmentProgressProps) {
  const pct =
    totalRows > 0 ? Math.min(100, Math.round((endRow / totalRows) * 100)) : 0;

  return (
    <div className="rounded-xl border border-(--border-default) bg-(--bg-card) p-5 shadow-(--shadow-card)">
      {verifyDetail ? (
        <p
          className="mb-2 text-center text-base font-semibold text-(--realm-navy)"
          role="status"
        >
          {verifyDetail}
        </p>
      ) : null}
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-(--bg-muted)"
        aria-hidden
      >
        <div
          className="h-full max-w-full rounded-full bg-(--realm-purple) transition-all duration-400 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
