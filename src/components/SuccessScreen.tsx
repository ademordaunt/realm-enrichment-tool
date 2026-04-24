"use client";

import type { HubSpotPushDonePayload } from "@/lib/hubspot/push-result";
import { useState } from "react";

const STAT_CARD =
  "flex flex-col gap-1 rounded-xl border border-zinc-200 bg-zinc-50 p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/40";

const PRIMARY_ACTION =
  "rounded-lg bg-(--realm-purple) px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-(--realm-purple-hover)";

export interface SuccessScreenProps {
  result: HubSpotPushDonePayload;
  onStartNew: () => void;
  /** Lead source selected on the pre-push screen. */
  leadSourceUsed?: string;
}

export function SuccessScreen({ result, onStartNew, leadSourceUsed }: SuccessScreenProps) {
  const [showErrors, setShowErrors] = useState(false);
  const portalId = process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID?.trim() ?? "";
  const listUrl =
    portalId && result.listId
      ? `https://app.hubspot.com/contacts/${portalId}/objectLists/${result.listId}/filters`
      : null;
  const folderId = result.folderId?.trim() ?? "";
  const folderUrl =
    portalId && folderId
      ? `https://app.hubspot.com/contacts/${portalId}/lists/folders/${encodeURIComponent(folderId)}`
      : null;

  const failed = result.errors.length;
  const membershipError = result.errors.some((e) => e.rowId === "membership");

  return (
    <section className="flex flex-col gap-6 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
        ✅ Import Complete
      </h2>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className={STAT_CARD}>
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Created
          </span>
          <span className="text-3xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50">
            {result.created}
          </span>
        </div>
        <div className={STAT_CARD}>
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Updated
          </span>
          <span className="text-3xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50">
            {result.updated}
          </span>
        </div>
        <div className={STAT_CARD}>
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Errors
          </span>
          <span
            className={`text-3xl font-bold tabular-nums ${
              failed > 0 ? "text-amber-800 dark:text-amber-200" : "text-zinc-900 dark:text-zinc-50"
            }`}
          >
            {failed}
          </span>
        </div>
      </div>

      {leadSourceUsed ? (
        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          <span className="font-medium text-zinc-900 dark:text-zinc-100">Lead Source: </span>
          {leadSourceUsed}
        </p>
      ) : null}

      {failed > 0 ? (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            className="text-left text-sm font-medium text-amber-900 dark:text-amber-100"
            onClick={() => setShowErrors((s) => !s)}
            aria-expanded={showErrors}
          >
            ⚠️ {failed} record{failed === 1 ? "" : "s"} failed
            <span className="ml-1 text-zinc-500">{showErrors ? "▼" : "▶"}</span>
          </button>
          {showErrors ? (
            <ul className="max-h-48 list-inside list-disc overflow-y-auto rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
              {result.errors.map((e) => (
                <li key={e.rowId} className="wrap-break-word py-0.5">
                  <span className="font-mono">{e.rowId}</span>: {e.error}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {membershipError ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
          ⚠️ List was created but some records may not have been added as members. You can manually
          add them in HubSpot.
        </p>
      ) : null}

      <div className="flex flex-col gap-2 text-sm text-zinc-800 dark:text-zinc-200">
        <p>
          HubSpot Segment Created:{" "}
          {listUrl ? (
            <a
              href={listUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-blue-600 underline hover:text-blue-800 dark:text-blue-400"
            >
              {result.listName}
            </a>
          ) : (
            <span className="font-medium">{result.listName}</span>
          )}
        </p>
        {folderUrl ? (
          <p>
            HubSpot Folder:{" "}
            <a
              href={folderUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-blue-600 underline hover:text-blue-800 dark:text-blue-400"
            >
              View Folder ↗
            </a>
          </p>
        ) : null}
        {!portalId ? (
          <span className="text-xs text-zinc-500">
            Set NEXT_PUBLIC_HUBSPOT_PORTAL_ID to enable the list link.
          </span>
        ) : null}
      </div>

      <div>
        <button type="button" onClick={onStartNew} className={PRIMARY_ACTION}>
          Start New Import
        </button>
      </div>
    </section>
  );
}
