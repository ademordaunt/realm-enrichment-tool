"use client";

import type { HubSpotPushDonePayload } from "@/lib/hubspot/push-result";
import { useState } from "react";

export interface SuccessScreenProps {
  result: HubSpotPushDonePayload;
  onStartNew: () => void;
}

export function SuccessScreen({ result, onStartNew }: SuccessScreenProps) {
  const [showErrors, setShowErrors] = useState(false);
  const portalId = process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID?.trim() ?? "";
  const listUrl =
    portalId && result.listId
      ? `https://app.hubspot.com/contacts/${portalId}/lists/${result.listId}`
      : null;

  const failed = result.errors.length;

  return (
    <section className="flex flex-col gap-6 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
        ✅ Import Complete
      </h2>

      <p className="text-sm text-zinc-700 dark:text-zinc-300">
        {result.totalPushed} records pushed — {result.created} created, {result.updated} updated
      </p>

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
                <li key={e.rowId} className="break-words py-0.5">
                  <span className="font-mono">{e.rowId}</span>: {e.error}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <p className="text-sm text-zinc-800 dark:text-zinc-200">
        📋 HubSpot List Created:{" "}
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
        {!portalId ? (
          <span className="mt-1 block text-xs text-zinc-500">
            Set NEXT_PUBLIC_HUBSPOT_PORTAL_ID to enable the list link.
          </span>
        ) : null}
      </p>

      <div>
        <button
          type="button"
          onClick={onStartNew}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
        >
          Start New Import
        </button>
      </div>
    </section>
  );
}
