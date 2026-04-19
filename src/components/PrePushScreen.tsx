"use client";

import type {
  EnrichedCompany,
  EnrichedContact,
  HubSpotFoldersApiResponse,
} from "@/lib/utils/types";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

const CARD_PANEL =
  "rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900";

const FIELD_CONTROL =
  "rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100";

/** Collapse duplicated trailing "Mon. YYYY Mon. YYYY" when the parent string already ended with that date. */
function dedupeLeadSourceDescriptionTail(s: string): string {
  const t = s.trim();
  return t.replace(
    /\s+((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.\s*\d{4})\s+\1$/i,
    " $1",
  );
}

const SELECT_WITH_CARET =
  "w-full appearance-none rounded-lg border border-zinc-300 bg-white py-2 pl-3 pr-10 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100";

const TABLE_HEAD_CELL =
  "border-b border-zinc-200 px-3 py-2 font-semibold dark:border-zinc-700";

const TABLE_ROW = "border-b border-zinc-100 dark:border-zinc-800";

/** Mirrors `EditableCell` in ReviewTable — click to edit, Enter/blur saves. */
function PrePushEditableCell(props: {
  value: string;
  muted?: boolean;
  breakAll?: boolean;
  onSave: (next: string) => void;
}) {
  const { value, muted, breakAll, onSave } = props;
  const normalized = value == null ? "" : String(value);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(normalized);

  useEffect(() => {
    if (!editing) setDraft(value == null ? "" : String(value));
  }, [value, editing]);

  const wrap = breakAll ? "break-all whitespace-normal" : "wrap-break-word";

  if (editing) {
    return (
      <div className={`relative min-w-24 w-full max-w-50 ${wrap}`}>
        <input
          className={`w-full rounded border border-blue-500 bg-white px-1.5 py-0.5 text-xs outline-none ring-1 ring-blue-500/30 dark:bg-zinc-950 sm:text-sm ${muted ? "text-zinc-500" : ""} ${wrap}`}
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onSave(draft);
              setEditing(false);
            }
            if (e.key === "Escape") {
              setDraft(normalized);
              setEditing(false);
            }
          }}
          onBlur={() => {
            onSave(draft);
            setEditing(false);
          }}
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      className={`relative min-h-5 w-full max-w-50 rounded px-1.5 py-0.5 text-left text-xs sm:text-sm ${wrap} ${muted ? "text-zinc-500" : "text-zinc-900 dark:text-zinc-100"} hover:bg-zinc-100/80 dark:hover:bg-zinc-800/80`}
      onClick={() => setEditing(true)}
    >
      {normalized === "" ? <span className="text-zinc-400">—</span> : normalized}
    </button>
  );
}

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
  /** When set, HubSpot push uses these rows instead of parent-approved rows (contact import edits). */
  contactRowsOverride?: EnrichedContact[];
};

function SelectCaretWrap({ children }: { children: ReactNode }) {
  return (
    <div className="relative">
      {children}
      <span
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-(--text-muted)"
        aria-hidden
      >
        ▾
      </span>
    </div>
  );
}

function websiteFromDomain(domain: string): string {
  const d = domain.trim().replace(/^www\./i, "");
  return d ? `https://www.${d}` : "";
}

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
  const [leadSourceDescription, setLeadSourceDescription] = useState(() =>
    dedupeLeadSourceDescriptionTail(defaultLeadSourceDescription),
  );

  const [folders, setFolders] = useState<{ id: string; name: string }[] | null>(null);
  const [foldersLoading, setFoldersLoading] = useState(true);
  const [foldersError, setFoldersError] = useState(false);
  const [folderId, setFolderId] = useState("");
  const [folderManual, setFolderManual] = useState("");

  const [contactEditRows, setContactEditRows] = useState<EnrichedContact[] | null>(null);

  useEffect(() => {
    setListName(defaultListName);
  }, [defaultListName]);

  useEffect(() => {
    setLeadSourceDescription(dedupeLeadSourceDescriptionTail(defaultLeadSourceDescription));
  }, [defaultLeadSourceDescription]);

  useEffect(() => {
    if (listType !== "contacts") {
      setContactEditRows(null);
      return;
    }
    setContactEditRows((approvedRows as EnrichedContact[]).map((r) => ({ ...r })));
  }, [listType, approvedRows]);

  useEffect(() => {
    let cancelled = false;
    setFoldersLoading(true);
    setFoldersError(false);
    void fetch("/api/hubspot/folders")
      .then(async (res) => {
        const data = (await res.json()) as HubSpotFoldersApiResponse;
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

  const canPush = useMemo(() => {
    const nameOk = listName.trim().length > 0;
    if (listType === "companies") {
      return nameOk;
    }
    const lsOk = leadSource.trim().length > 0;
    const lsdOk = leadSourceDescription.trim().length > 0;
    return nameOk && lsOk && lsdOk;
  }, [listName, leadSource, leadSourceDescription, listType]);

  const handlePush = useCallback(() => {
    if (!canPush) return;
    onPush({
      listName: listName.trim(),
      folderId: foldersError ? folderManual.trim() : folderId.trim(),
      leadSource: listType === "contacts" ? leadSource.trim() : "",
      leadSourceDescription: listType === "contacts" ? leadSourceDescription.trim() : "",
      notes: "",
      contactRowsOverride:
        listType === "contacts" && contactEditRows ? contactEditRows : undefined,
    });
  }, [
    canPush,
    listName,
    folderId,
    folderManual,
    foldersError,
    leadSource,
    leadSourceDescription,
    listType,
    contactEditRows,
    onPush,
  ]);

  const patchContact = useCallback((id: string, partial: Partial<EnrichedContact>) => {
    setContactEditRows((prev) =>
      prev ? prev.map((r) => (r.id === id ? { ...r, ...partial } : r)) : prev,
    );
  }, []);

  const contactRowsForTable = contactEditRows ?? (approvedRows as EnrichedContact[]);

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Ready to Import</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Review your import settings before pushing to HubSpot.
        </p>
      </div>

      <div className={CARD_PANEL}>
        <h3 className="mb-3 text-sm font-semibold text-zinc-800 dark:text-zinc-200">Summary</h3>
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="min-w-full border-collapse text-left text-xs sm:text-sm">
            {listType === "companies" ? (
              <>
                <thead className="bg-zinc-100 dark:bg-zinc-800/80">
                  <tr>
                    <th className={TABLE_HEAD_CELL}>Name</th>
                    <th className={TABLE_HEAD_CELL}>Domain</th>
                    <th className={TABLE_HEAD_CELL}>Website</th>
                    <th className={TABLE_HEAD_CELL}>LinkedIn</th>
                    <th className={TABLE_HEAD_CELL}>State/Region</th>
                    <th className={TABLE_HEAD_CELL}>Number of Employees</th>
                  </tr>
                </thead>
                <tbody>
                  {(approvedRows as EnrichedCompany[]).map((row) => (
                    <tr key={row.id} className={TABLE_ROW}>
                      <td className="px-3 py-2 text-zinc-800 dark:text-zinc-200">{row.resolvedName}</td>
                      <td className="max-w-48 break-all px-3 py-2 text-zinc-800 dark:text-zinc-200">
                        {row.domain}
                      </td>
                      <td className="max-w-48 break-all px-3 py-2 text-zinc-800 dark:text-zinc-200">
                        {websiteFromDomain(row.domain)}
                      </td>
                      <td className="max-w-40 break-all px-3 py-2 text-zinc-800 dark:text-zinc-200">
                        {row.linkedinUrl || "—"}
                      </td>
                      <td className="px-3 py-2 text-zinc-800 dark:text-zinc-200">{row.state || "—"}</td>
                      <td className="px-3 py-2 text-zinc-800 dark:text-zinc-200">
                        {row.numberOfEmployees != null ? String(row.numberOfEmployees) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </>
            ) : (
              <>
                <thead className="bg-zinc-100 dark:bg-zinc-800/80">
                  <tr>
                    <th className={TABLE_HEAD_CELL}>First Name</th>
                    <th className={TABLE_HEAD_CELL}>Last Name</th>
                    <th className={TABLE_HEAD_CELL}>Email</th>
                    <th className={TABLE_HEAD_CELL}>Company Name</th>
                    <th className={TABLE_HEAD_CELL}>Title</th>
                    <th className={TABLE_HEAD_CELL}>LinkedIn</th>
                    <th className={TABLE_HEAD_CELL}>Membership Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {contactRowsForTable.map((row) => (
                    <tr key={row.id} className={TABLE_ROW}>
                      <td className="px-3 py-2 text-zinc-800 dark:text-zinc-200">{row.firstName}</td>
                      <td className="px-3 py-2 text-zinc-800 dark:text-zinc-200">{row.lastName}</td>
                      <td className="max-w-44 break-all px-3 py-2 text-zinc-800 dark:text-zinc-200">
                        {row.rawEmail}
                      </td>
                      <td className="max-w-40 px-3 py-2 align-middle text-zinc-800 dark:text-zinc-200">
                        <PrePushEditableCell
                          value={row.resolvedCompany}
                          onSave={(v) => patchContact(row.id, { resolvedCompany: v })}
                        />
                      </td>
                      <td className="max-w-36 px-3 py-2 align-middle text-zinc-800 dark:text-zinc-200">
                        <PrePushEditableCell
                          value={row.title}
                          onSave={(v) => patchContact(row.id, { title: v })}
                        />
                      </td>
                      <td className="max-w-36 px-3 py-2 align-middle text-zinc-800 dark:text-zinc-200">
                        <PrePushEditableCell
                          value={row.linkedinUrl}
                          breakAll
                          onSave={(v) => patchContact(row.id, { linkedinUrl: v })}
                        />
                      </td>
                      <td className="align-middle px-3 py-2 text-zinc-800 dark:text-zinc-200">
                        <div className="flex min-h-9 w-full items-center">
                          <div className="w-full min-w-0">
                            <PrePushEditableCell
                              value={row.membershipNotes ?? ""}
                              onSave={(v) => patchContact(row.id, { membershipNotes: v })}
                            />
                          </div>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </>
            )}
          </table>
        </div>
      </div>

      <div className={`${CARD_PANEL} grid gap-4 sm:grid-cols-2`}>
        <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 sm:col-span-2">
          Import Settings
        </h3>

        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          <span className="font-medium text-zinc-800 dark:text-zinc-200">
            List Name <span className="text-red-600">*</span>
          </span>
          <input
            className={FIELD_CONTROL}
            value={listName}
            onChange={(e) => setListName(e.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          <span className="font-medium text-zinc-800 dark:text-zinc-200">HubSpot Folder</span>
          {foldersLoading ? (
            <span className="text-sm text-zinc-500">Loading folders…</span>
          ) : foldersError ? (
            <div className="flex flex-col gap-1">
              <p className="text-xs text-amber-800 dark:text-amber-200">
                Could not load folders — enter manually
              </p>
              <input
                className={FIELD_CONTROL}
                value={folderManual}
                onChange={(e) => setFolderManual(e.target.value)}
                placeholder="Folder ID or name per HubSpot"
              />
            </div>
          ) : (
            <SelectCaretWrap>
              <select
                className={SELECT_WITH_CARET}
                value={folderId}
                onChange={(e) => setFolderId(e.target.value)}
              >
                <option value="">Select Folder</option>
                {(folders ?? []).map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </SelectCaretWrap>
          )}
        </label>

        {listType === "contacts" ? (
          <>
            <label className="flex flex-col gap-1 text-sm sm:col-span-2">
              <span className="font-medium text-zinc-800 dark:text-zinc-200">
                Lead Source <span className="text-red-600">*</span>
              </span>
              <SelectCaretWrap>
                <select
                  className={SELECT_WITH_CARET}
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
              </SelectCaretWrap>
            </label>

            <label className="flex flex-col gap-1 text-sm sm:col-span-2">
              <span className="font-medium text-zinc-800 dark:text-zinc-200">
                Lead Source Description <span className="text-red-600">*</span>
              </span>
              <input
                className={FIELD_CONTROL}
                value={leadSourceDescription}
                onChange={(e) => setLeadSourceDescription(e.target.value)}
              />
            </label>
          </>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 border-t border-zinc-100 pt-4 dark:border-zinc-800">
        <div className="flex items-center justify-between">
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
        <div className="ml-auto max-w-xs text-right text-sm text-(--text-muted)">
          💡 After pushing, open the HubSpot list
          <br />
          and click &quot;Enrich&quot; to run native data enrichment.
        </div>
      </div>
    </section>
  );
}
