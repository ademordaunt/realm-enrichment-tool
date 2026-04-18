"use client";

import { ConfidenceBadge } from "@/components/ConfidenceBadge";
import type { EnrichedCompany, EnrichedContact } from "@/lib/utils/types";
import { useCallback, useEffect, useMemo, useState } from "react";

export const LEAD_SOURCE_OPTIONS = [
  "Marketing - Advertisement",
  "Marketing - CisoExecNet",
  "Marketing - CISO XC",
  "Marketing - Cyalliance",
  "Marketing - Cybersecurity Summit",
  "Marketing - ExecWeb",
  "Marketing - FutureCon",
  "Marketing - SageTap",
  "Marketing - Social Media",
  "Marketing - Trade Show",
  "Marketing - Webinar",
  "Marketing - Website",
] as const;

export type PrePushSettings = {
  listName: string;
  folderId: string;
  leadSource: string;
  leadSourceDescription: string;
  notes: string;
};

export interface PrePushScreenProps {
  listType: "companies" | "contacts";
  approvedRows: Array<EnrichedCompany | EnrichedContact>;
  defaultListName: string;
  defaultLeadSourceDescription: string;
  onBack: () => void;
  onPush: (settings: PrePushSettings) => void;
}

export function PrePushScreen({
  listType,
  approvedRows,
  defaultListName,
  defaultLeadSourceDescription,
  onBack,
  onPush,
}: PrePushScreenProps) {
  const [listName, setListName] = useState(defaultListName);
  const [leadSource, setLeadSource] = useState("");
  const [leadSourceDescription, setLeadSourceDescription] = useState(defaultLeadSourceDescription);
  const [notes, setNotes] = useState("");

  const [folders, setFolders] = useState<{ id: string; name: string }[] | null>(null);
  const [foldersLoading, setFoldersLoading] = useState(true);
  const [foldersError, setFoldersError] = useState(false);
  const [folderId, setFolderId] = useState("");
  const [folderManual, setFolderManual] = useState("");

  useEffect(() => {
    setListName(defaultListName);
  }, [defaultListName]);

  useEffect(() => {
    setLeadSourceDescription(defaultLeadSourceDescription);
  }, [defaultLeadSourceDescription]);

  useEffect(() => {
    let cancelled = false;
    setFoldersLoading(true);
    setFoldersError(false);
    void fetch("/api/hubspot/folders")
      .then(async (res) => {
        const data = (await res.json()) as { folders?: { id: string; name: string }[]; error?: string };
        if (!res.ok) throw new Error(data.error ?? "Failed to load folders");
        if (!cancelled) setFolders(data.folders ?? []);
      })
      .catch(() => {
        if (!cancelled) {
          setFoldersError(true);
          setFolders([]);
        }
      })
      .finally(() => {
        if (!cancelled) setFoldersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const folderValue = foldersError ? folderManual : folderId;

  const canPush = useMemo(() => {
    const nameOk = listName.trim().length > 0;
    const lsOk = leadSource.trim().length > 0;
    const lsdOk = leadSourceDescription.trim().length > 0;
    const folderOk = foldersError ? folderManual.trim().length > 0 : folderId.trim().length > 0;
    return nameOk && lsOk && lsdOk && folderOk;
  }, [listName, leadSource, leadSourceDescription, folderId, folderManual, foldersError]);

  const handlePush = useCallback(() => {
    if (!canPush) return;
    onPush({
      listName: listName.trim(),
      folderId: foldersError ? folderManual.trim() : folderId.trim(),
      leadSource: leadSource.trim(),
      leadSourceDescription: leadSourceDescription.trim(),
      notes: notes.trim(),
    });
  }, [canPush, listName, folderId, folderManual, foldersError, leadSource, leadSourceDescription, notes, onPush]);

  return (
    <section className="flex flex-col gap-6 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div>
        <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Ready to Import</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Review your import settings before pushing to HubSpot
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="min-w-full border-collapse text-left text-xs sm:text-sm">
          <thead className="bg-zinc-100 dark:bg-zinc-800/80">
            <tr>
              <th className="border-b border-zinc-200 px-3 py-2 font-semibold dark:border-zinc-700">
                Name
              </th>
              <th className="border-b border-zinc-200 px-3 py-2 font-semibold dark:border-zinc-700">
                Domain
              </th>
              <th className="border-b border-zinc-200 px-3 py-2 font-semibold dark:border-zinc-700">
                Confidence
              </th>
            </tr>
          </thead>
          <tbody>
            {listType === "companies"
              ? (approvedRows as EnrichedCompany[]).map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-zinc-100 dark:border-zinc-800"
                  >
                    <td className="px-3 py-2 text-zinc-800 dark:text-zinc-200">{row.resolvedName}</td>
                    <td className="max-w-48 break-all px-3 py-2 text-zinc-800 dark:text-zinc-200">
                      {row.domain}
                    </td>
                    <td className="px-3 py-2">
                      <ConfidenceBadge score={row.confidenceScore} />
                    </td>
                  </tr>
                ))
              : (approvedRows as EnrichedContact[]).map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-zinc-100 dark:border-zinc-800"
                  >
                    <td className="px-3 py-2 text-zinc-800 dark:text-zinc-200">
                      {[row.firstName, row.lastName].filter(Boolean).join(" ")}
                    </td>
                    <td className="max-w-48 break-all px-3 py-2 text-zinc-800 dark:text-zinc-200">
                      {row.companyDomain || row.resolvedCompany}
                    </td>
                    <td className="px-3 py-2">
                      <ConfidenceBadge score={row.confidenceScore} />
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          <span className="font-medium text-zinc-800 dark:text-zinc-200">
            List/Segment Name <span className="text-red-600">*</span>
          </span>
          <input
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
            value={listName}
            onChange={(e) => setListName(e.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          <span className="font-medium text-zinc-800 dark:text-zinc-200">
            List/Segment Folder <span className="text-red-600">*</span>
          </span>
          {foldersLoading ? (
            <span className="text-sm text-zinc-500">Loading folders…</span>
          ) : foldersError ? (
            <div className="flex flex-col gap-1">
              <p className="text-xs text-amber-800 dark:text-amber-200">
                Could not load folders — enter manually
              </p>
              <input
                className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
                value={folderManual}
                onChange={(e) => setFolderManual(e.target.value)}
                placeholder="Folder ID or name per HubSpot"
              />
            </div>
          ) : (
            <select
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
              value={folderId}
              onChange={(e) => setFolderId(e.target.value)}
              required
            >
              <option value="">Select a folder</option>
              {(folders ?? []).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          )}
        </label>

        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          <span className="font-medium text-zinc-800 dark:text-zinc-200">
            Lead Source <span className="text-red-600">*</span>
          </span>
          <select
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
            value={leadSource}
            onChange={(e) => setLeadSource(e.target.value)}
            required
          >
            <option value="">Select lead source</option>
            {LEAD_SOURCE_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          <span className="font-medium text-zinc-800 dark:text-zinc-200">
            Lead Source Description <span className="text-red-600">*</span>
          </span>
          <input
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
            value={leadSourceDescription}
            onChange={(e) => setLeadSourceDescription(e.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          <span className="font-medium text-zinc-800 dark:text-zinc-200">Notes</span>
          <textarea
            rows={3}
            className="resize-y rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-4 dark:border-zinc-800">
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg bg-zinc-200 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-600"
        >
          ← Back to Review
        </button>
        <button
          type="button"
          disabled={!canPush}
          onClick={handlePush}
          className={`rounded-lg px-4 py-2 text-sm font-semibold ${
            canPush
              ? "bg-blue-600 text-white hover:bg-blue-700"
              : "cursor-not-allowed bg-zinc-300 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400"
          }`}
        >
          Push to HubSpot →
        </button>
      </div>
    </section>
  );
}
