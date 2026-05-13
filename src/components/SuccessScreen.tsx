"use client";

import type { HubSpotPushDonePayload } from "@/lib/hubspot/push-result";
import { motion } from "framer-motion";
import { useState } from "react";

const STAT_CARD =
  "flex flex-col gap-1 rounded-xl border border-(--border-default) bg-(--bg-muted) p-4 shadow-(--shadow-card)";

const PRIMARY_ACTION =
  "rounded-lg bg-(--realm-purple) px-4 py-2 text-sm font-semibold text-white transition-[background-color,transform] duration-75 hover:bg-(--realm-purple-hover) active:scale-95";

export interface SuccessScreenProps {
  result: HubSpotPushDonePayload;
  onStartNew: () => void;
  /** Lead source selected on the pre-push screen. */
  leadSourceUsed?: string;
  rowsById?: Map<string, { displayName: string }>;
}

export function SuccessScreen({ result, onStartNew, leadSourceUsed, rowsById }: SuccessScreenProps) {
  const [showErrors, setShowErrors] = useState(false);
  const portalId = process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID?.trim() ?? "";
  const listUrl =
    portalId && result.listId
      ? `https://app.hubspot.com/contacts/${portalId}/objectLists/${result.listId}/filters`
      : null;
  const folderId = result.folderId?.trim() ?? "";
  const folderUrl =
    portalId && folderId
      ? `https://app.hubspot.com/contacts/${portalId}/objectLists/folders?folderId=${encodeURIComponent(folderId)}`
      : null;

  const isContactsPush = result.contactsAssociated !== undefined;

  const failed = result.errors.length;
  const membershipError = result.errors.some((e) => e.rowId === "membership");
  const stats = [
    { label: "Created", value: result.created, valueClassName: "text-zinc-900 dark:text-zinc-50" },
    { label: "Updated", value: result.updated, valueClassName: "text-zinc-900 dark:text-zinc-50" },
    {
      label: "Errors",
      value: failed,
      valueClassName:
        failed > 0 ? "text-amber-800 dark:text-amber-200" : "text-zinc-900 dark:text-zinc-50",
    },
  ] as const;

  return (
    <section className="flex flex-col gap-6 rounded-xl border border-(--border-default) bg-(--bg-card) p-6 shadow-(--shadow-card)">
      <motion.h2
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        className="text-xl font-semibold text-(--text-primary)"
      >
        ✅ Import Complete
      </motion.h2>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {stats.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06, duration: 0.18, ease: "easeOut" }}
            className={STAT_CARD}
          >
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              {stat.label}
            </span>
            <span className={`text-3xl font-bold tabular-nums ${stat.valueClassName}`}>
              {stat.value}
            </span>
          </motion.div>
        ))}
      </div>

      {leadSourceUsed ? (
        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          <span className="font-medium text-zinc-900 dark:text-zinc-100">Lead Source: </span>
          {leadSourceUsed}
        </p>
      ) : null}

      {/* Association summary — contacts push only */}
      {isContactsPush ? (
        <div className="flex flex-col gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm dark:border-zinc-800 dark:bg-zinc-950/40">
          <p className="font-semibold text-zinc-800 dark:text-zinc-200">Company Associations</p>
          <p className={(result.contactsAssociated ?? 0) > 0 ? "text-zinc-700 dark:text-zinc-300" : "text-zinc-500 dark:text-zinc-500"}>
            ✓ {result.contactsAssociated ?? 0} contact{(result.contactsAssociated ?? 0) === 1 ? "" : "s"} associated to a company
          </p>
          <p className={(result.contactsDomainNotFound ?? 0) > 0 ? "text-zinc-600 dark:text-zinc-400" : "text-zinc-500 dark:text-zinc-500"}>
            {result.contactsDomainNotFound ?? 0} contact{(result.contactsDomainNotFound ?? 0) === 1 ? "" : "s"}: company domain present but not found in HubSpot
          </p>
          <p className={(result.contactsNoDomain ?? 0) > 0 ? "text-zinc-600 dark:text-zinc-400" : "text-zinc-500 dark:text-zinc-500"}>
            {result.contactsNoDomain ?? 0} contact{(result.contactsNoDomain ?? 0) === 1 ? "" : "s"}: no company domain available
          </p>
        </div>
      ) : null}

      {/* Ownership failure warnings */}
      {(isContactsPush || (result.companiesNoState != null && result.companiesNoState > 0)) ? (
        <div className={`flex flex-col gap-1.5 rounded-lg border px-4 py-3 text-sm ${
          (result.companiesNoState != null && result.companiesNoState > 0) || (result.contactsNoCompanyAssociation ?? 0) > 0
            ? "border-amber-200 bg-amber-50/80 dark:border-amber-800 dark:bg-amber-950/30"
            : "border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950/40"
        }`}>
          <p className={`font-semibold ${
            (result.companiesNoState != null && result.companiesNoState > 0) || (result.contactsNoCompanyAssociation ?? 0) > 0
              ? "text-amber-900 dark:text-amber-100"
              : "text-zinc-800 dark:text-zinc-200"
          }`}>Ownership Assignment</p>
          {result.companiesNoState != null && result.companiesNoState > 0 ? (
            <>
              <p className="text-xs text-amber-800 dark:text-amber-200">
                The following records may not receive an owner assigned automatically:
              </p>
              <p className="text-amber-800 dark:text-amber-200">
                • {result.companiesNoState} {result.companiesNoState === 1 ? "company has" : "companies have"} no state/region
              </p>
            </>
          ) : null}
          {isContactsPush ? (
            (result.contactsNoCompanyAssociation ?? 0) > 0 ? (
              <p className="text-amber-800 dark:text-amber-200">
                ⚠ {result.contactsNoCompanyAssociation} {(result.contactsNoCompanyAssociation ?? 0) === 1 ? "contact has" : "contacts have"} no company association in HubSpot — {(result.contactsNoCompanyAssociation ?? 0) === 1 ? "this contact" : "these contacts"} will not get an owner assigned automatically
              </p>
            ) : (
              <p className="text-emerald-700 dark:text-emerald-400">
                ✓ All contacts have a company association
              </p>
            )
          ) : null}
        </div>
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
                  <span className="font-mono">{rowsById?.get(e.rowId)?.displayName || e.rowId}</span>: {e.error}
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

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.24, duration: 0.18, ease: "easeOut" }}
        className="flex flex-col gap-2 text-sm text-zinc-800 dark:text-zinc-200"
      >
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
      </motion.div>

      <div>
        <button type="button" onClick={onStartNew} className={PRIMARY_ACTION}>
          Start New Import
        </button>
      </div>
    </section>
  );
}
