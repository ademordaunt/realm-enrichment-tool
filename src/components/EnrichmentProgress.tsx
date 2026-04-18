"use client";

export interface EnrichmentProgressProps {
  startRow: number;
  endRow: number;
  totalRows: number;
}

export function EnrichmentProgress({
  startRow,
  endRow,
  totalRows,
}: EnrichmentProgressProps) {
  const pct =
    totalRows > 0 ? Math.min(100, Math.round((endRow / totalRows) * 100)) : 0;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100" role="status">
        Enriching rows {startRow}–{endRow} of {totalRows}…
      </p>
      <div
        className="mt-3 h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
        aria-hidden
      >
        <div
          className="h-full rounded-full bg-blue-600 transition-[inline-size] duration-300 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
