import type { EnrichedCompany } from "@/lib/utils/types";

type Score = EnrichedCompany["confidenceScore"];

const STYLES: Record<Score, string> = {
  high: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-100",
  medium: "bg-amber-100 text-amber-950 dark:bg-amber-950/50 dark:text-amber-100",
  low: "bg-orange-100 text-orange-950 dark:bg-orange-950/50 dark:text-orange-100",
  unresolved: "bg-red-100 text-red-900 dark:bg-red-950/50 dark:text-red-100",
};

export function ConfidenceBadge({ score }: { score: Score }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STYLES[score] ?? STYLES.unresolved}`}
    >
      {score}
    </span>
  );
}
