"use client";

const ROW_COUNT = 6;

export function ReviewTableSkeleton() {
  return (
    <div className="space-y-3 animate-pulse" role="status" aria-live="polite" aria-label="Loading review table">
      <div className="h-8 w-56 rounded bg-zinc-100 dark:bg-zinc-800" />
      <div className="overflow-hidden rounded-lg border border-(--border-default)">
        <div className="h-10 w-full bg-zinc-100 dark:bg-zinc-800" />
        <div className="space-y-2 px-3 py-3">
          {Array.from({ length: ROW_COUNT }).map((_, i) => (
            <div key={i} className="grid grid-cols-[60px_1.2fr_1fr_1fr_0.8fr] gap-2">
              <div className="h-8 rounded bg-zinc-100 dark:bg-zinc-800" />
              <div className="h-8 rounded bg-zinc-100 dark:bg-zinc-800" />
              <div className="h-8 rounded bg-zinc-100 dark:bg-zinc-800" />
              <div className="h-8 rounded bg-zinc-100 dark:bg-zinc-800" />
              <div className="h-8 rounded bg-zinc-100 dark:bg-zinc-800" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
