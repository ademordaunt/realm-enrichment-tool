"use client";

const ROW_COUNT = 5;

export function PrePushSkeleton() {
  return (
    <div className="flex flex-col gap-6 animate-pulse" role="status" aria-live="polite" aria-label="Loading import settings">
      <div className="flex flex-col gap-1">
        <div className="h-7 w-44 rounded bg-zinc-100 dark:bg-zinc-800" />
        <div className="h-4 w-72 rounded bg-zinc-100 dark:bg-zinc-800" />
      </div>
      <div className="rounded-xl border border-(--border-default) bg-(--bg-card) p-6 shadow-(--shadow-card)">
        <div className="mb-4 h-4 w-32 rounded bg-zinc-100 dark:bg-zinc-800" />
        <div className="flex flex-col gap-3">
          <div className="h-9 w-full rounded-lg bg-zinc-100 dark:bg-zinc-800" />
          <div className="h-9 w-full rounded-lg bg-zinc-100 dark:bg-zinc-800" />
        </div>
      </div>
      <div className="rounded-xl border border-(--border-default) bg-(--bg-card) p-6 shadow-(--shadow-card)">
        <div className="mb-3 h-4 w-20 rounded bg-zinc-100 dark:bg-zinc-800" />
        <div className="overflow-hidden rounded-lg border border-(--border-default)">
          <div className="h-9 w-full bg-zinc-100 dark:bg-zinc-800" />
          <div className="space-y-2 px-3 py-3">
            {Array.from({ length: ROW_COUNT }).map((_, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_1fr_1fr_0.8fr] gap-2">
                <div className="h-7 rounded bg-zinc-100 dark:bg-zinc-800" />
                <div className="h-7 rounded bg-zinc-100 dark:bg-zinc-800" />
                <div className="h-7 rounded bg-zinc-100 dark:bg-zinc-800" />
                <div className="h-7 rounded bg-zinc-100 dark:bg-zinc-800" />
                <div className="h-7 rounded bg-zinc-100 dark:bg-zinc-800" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
