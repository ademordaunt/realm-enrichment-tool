"use client";

export type PhaseStatus = "complete" | "active" | "waiting";

export interface Phase {
  label: string;
  status: PhaseStatus;
  /** 0–100. Only meaningful when status === "active". */
  progress?: number;
  /** Shown as subtitle under the active bar only. */
  detail?: string | null;
}

interface EnrichmentProgressBarsProps {
  title: string;
  phases: Phase[];
}

export function EnrichmentProgressBars({ title, phases }: EnrichmentProgressBarsProps) {
  return (
    <div className="rounded-xl border border-(--border-default) bg-(--bg-card) p-5 shadow-(--shadow-card)">
      <p className="mb-4 text-center text-base font-semibold text-(--realm-navy)" role="status">
        {title}
      </p>
      <div className="space-y-3">
        {phases.map((phase) => (
          <PhaseBar key={phase.label} phase={phase} />
        ))}
      </div>
    </div>
  );
}

function PhaseBar({ phase }: { phase: Phase }) {
  const { label, status, progress = 0, detail } = phase;

  const icon = status === "complete" ? "✅" : status === "active" ? "⏳" : "○";
  const pct = status === "complete" ? 100 : status === "active" ? Math.min(100, progress) : 0;

  return (
    <div className={status === "waiting" ? "opacity-50" : undefined}>
      <div className="mb-1 flex items-center justify-between gap-2 text-sm">
        <span className="flex items-center gap-1.5">
          <span aria-hidden>{icon}</span>
          <span
            className={
              status === "active"
                ? "font-semibold text-(--realm-navy)"
                : "text-(--text-primary)"
            }
          >
            {label}
          </span>
        </span>
        {status === "active" && pct > 0 ? (
          <span className="text-xs tabular-nums text-(--text-muted)">{Math.round(pct)}%</span>
        ) : null}
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-(--bg-muted)" aria-hidden>
        <div
          className={`h-full max-w-full rounded-full transition-all duration-400 ease-out ${
            status === "complete"
              ? "bg-emerald-500 dark:bg-emerald-600"
              : status === "active"
                ? "bg-(--realm-purple)"
                : "bg-transparent"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {detail && status === "active" ? (
        <p className="mt-1 text-xs text-(--text-muted)">{detail}</p>
      ) : null}
    </div>
  );
}
