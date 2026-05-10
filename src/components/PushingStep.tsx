"use client";

type HubSpotPushListSnapshot = {
  listId: string;
  listName: string;
  folderId?: string;
};

interface PushingStepProps {
  pushProgress: { current: number; total: number };
  pushListCreatedMeta: HubSpotPushListSnapshot | null;
}

export function PushingStep({ pushProgress, pushListCreatedMeta }: PushingStepProps) {
  return (
    <div className="rounded-xl border border-(--border-default) bg-(--bg-card) p-5 shadow-(--shadow-card)">
      <p className="text-sm font-medium text-(--text-primary)" role="status">
        Pushing record {pushProgress.current} of {pushProgress.total} to HubSpot…
      </p>
      {pushListCreatedMeta ? (
        <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-950 dark:border-emerald-800/50 dark:bg-emerald-950/35 dark:text-emerald-100" role="status">
          HubSpot list created: <span className="font-medium">{pushListCreatedMeta.listName}</span>{" "}
          — list ID <span className="font-mono">{pushListCreatedMeta.listId}</span>
          {pushListCreatedMeta.folderId ? (
            <span className="block mt-1 text-emerald-900/80 dark:text-emerald-200/80">
              Folder ID: <span className="font-mono">{pushListCreatedMeta.folderId}</span>
            </span>
          ) : null}
        </p>
      ) : null}
      <p className="text-sm text-(--text-muted) text-center mt-2">
        You can leave this tab. We&apos;ll notify you when the push is complete.
      </p>
    </div>
  );
}
