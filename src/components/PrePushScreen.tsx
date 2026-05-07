"use client";

import type {
  EnrichedCompany,
  EnrichedContact,
  HubSpotFoldersApiResponse,
} from "@/lib/utils/types";
import { normalizeDomain } from "@/lib/utils/domain";
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
const FOLDER_SELECTION_SESSION_KEY = "realm-selected-hubspot-folder";

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
      onClick={() => {
        setDraft(normalized);
        setEditing(true);
      }}
    >
      {normalized === "" ? <span className="text-zinc-400">—</span> : normalized}
    </button>
  );
}

export const LEAD_SOURCE_OPTIONS: Array<{ label: string; value: string }> = [
  { label: "Marketing - Advertisement", value: "advertisement" },
  { label: "Marketing - CisoExecNet", value: "Marketing - CisoExecNet" },
  { label: "Marketing - CISO XC", value: "Marketing - CISO XC" },
  { label: "Marketing - Cyalliance", value: "Marketing - Cyalliance" },
  { label: "Marketing - Cybersecurity Summit", value: "Marekting - Cybersecurity Summit" },
  { label: "Marketing - ExecWeb", value: "Marketing - ExecWeb" },
  { label: "Marketing - FutureCon", value: "Marketing - FutureCon" },
  { label: "Marketing - SageTap", value: "Marketing - SageTap" },
  { label: "Marketing - Social Media", value: "social_media" },
  { label: "Marketing - Trade Show", value: "trade_show" },
  { label: "Marketing - Webinar", value: "Marketing - Webinar" },
  { label: "Marketing - Website", value: "website" },
];

export type PrePushSettings = {
  listName: string;
  folderId?: string;
  leadSource: string;
  leadSourceDescription: string;
  useExistingLeadSource: boolean;
  useExistingLeadSourceDescription: boolean;
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

type FieldPreviewEntry = { key: string; label: string; value: string };
type FieldPreviewResult = {
  written: FieldPreviewEntry[];
  skipped: Array<{ key: string; label: string; hsValue: string }>;
};

function isEmpty(v: string | null | undefined): boolean {
  return v == null || String(v).trim() === "";
}

function previewCompanyFields(
  company: EnrichedCompany,
  isUpdate: boolean,
): FieldPreviewResult {
  const ex: Record<string, string> = isUpdate ? (company.existingData ?? {}) : {};
  const written: FieldPreviewEntry[] = [];
  const skipped: Array<{ key: string; label: string; hsValue: string }> = [];

  const check = (key: string, label: string, value: string | undefined | null, overwrite = false) => {
    const v = value?.trim() ?? "";
    if (!v) return;
    if (!overwrite && !isEmpty(ex[key])) {
      skipped.push({ key, label, hsValue: ex[key] ?? "" });
    } else {
      written.push({ key, label, value: v });
    }
  };

  const domain = normalizeDomain(company.domain ?? "");
  check("name", "Name", company.resolvedName?.trim() || company.rawInput?.trim() || "Unknown");
  check("domain", "Domain", domain);
  check("website", "Website", domain ? `https://www.${domain}` : "");
  check("linkedin_company_page", "LinkedIn Page", company.linkedinUrl?.trim());
  check("industry", "Industry", company.industry?.trim());
  check("description", "Description", company.description?.trim());
  check("phone", "Phone", company.phone?.trim());
  check("state", "State/Region", company.state?.trim(), true);
  if (company.numberOfEmployees != null && !Number.isNaN(company.numberOfEmployees)) {
    check("numberofemployees", "Employees", String(company.numberOfEmployees), true);
  }
  if (company.revenue != null && !Number.isNaN(Number(company.revenue))) {
    check("annualrevenue", "Annual Revenue", String(company.revenue * 1000), true);
  }
  check("city", "City", company.city?.trim(), true);

  return { written, skipped };
}

function previewContactFields(
  contact: EnrichedContact,
  isUpdate: boolean,
): FieldPreviewResult {
  const ex: Record<string, string> = isUpdate ? (contact.existingData ?? {}) : {};
  const written: FieldPreviewEntry[] = [];
  const skipped: Array<{ key: string; label: string; hsValue: string }> = [];

  const check = (key: string, label: string, value: string | undefined | null, overwrite = false) => {
    const v = value?.trim() ?? "";
    if (!v) return;
    if (!overwrite && !isEmpty(ex[key])) {
      skipped.push({ key, label, hsValue: ex[key] ?? "" });
    } else {
      written.push({ key, label, value: v });
    }
  };

  check("firstname", "First Name", contact.firstName?.trim());
  check("lastname", "Last Name", contact.lastName?.trim());
  if (!isUpdate) {
    const email = contact.resolvedEmail?.trim();
    if (email) written.push({ key: "email", label: "Email", value: email });
  } else if (contact.resolvedEmail?.trim()) {
    skipped.push({ key: "email", label: "Email", hsValue: "(never overwritten)" });
  }
  check("jobtitle", "Job Title", contact.title?.trim());
  check("company", "Company Name", contact.resolvedCompany?.trim());
  check("ds_liprofile", "LinkedIn Profile", contact.linkedinUrl?.trim());
  check("state", "State/Region", contact.location?.trim(), true);
  check("phone", "Phone", contact.phone?.trim());
  check("job_level", "Job Level", contact.ziManagementLevel?.trim());
  check("job_function", "Job Function", contact.ziJobFunction?.trim());
  check("industry", "Industry", contact.ziCompanyPrimaryIndustry?.trim());
  if (contact.ziCompanyEmployeeCount?.trim()) {
    check("numemployees", "Employees (Company)", contact.ziCompanyEmployeeCount.trim(), true);
  }
  if (!contact.companyDomain?.trim() && contact.ziCompanyWebsite?.trim()) {
    check("website", "Company Website", contact.ziCompanyWebsite.trim());
  }

  return { written, skipped };
}

export interface PrePushScreenProps {
  listType: "companies" | "contacts";
  approvedRows: Array<EnrichedCompany | EnrichedContact>;
  defaultListName: string;
  defaultLeadSourceDescription: string;
  onPush: (settings: PrePushSettings) => void;
}

export function PrePushScreen({
  listType,
  approvedRows,
  defaultListName,
  defaultLeadSourceDescription,
  onPush,
}: PrePushScreenProps) {
  const [listName, setListName] = useState(defaultListName);
  const [leadSource, setLeadSource] = useState("");
  const [leadSourceDescription, setLeadSourceDescription] = useState(() =>
    dedupeLeadSourceDescriptionTail(defaultLeadSourceDescription),
  );
  const [useExistingLeadSource, setUseExistingLeadSource] = useState(false);
  const [useExistingLeadSourceDescription, setUseExistingLeadSourceDescription] = useState(false);

  const [folders, setFolders] = useState<{ id: string; name: string }[] | null>(null);
  const [foldersLoading, setFoldersLoading] = useState(true);
  const [foldersError, setFoldersError] = useState(false);
  const [folderId, setFolderId] = useState("");

  const [contactEditRows, setContactEditRows] = useState<EnrichedContact[] | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [expandedPreviewRows, setExpandedPreviewRows] = useState<Set<string>>(new Set());

  useEffect(() => {
    queueMicrotask(() => {
      setListName(defaultListName);
    });
  }, [defaultListName]);

  useEffect(() => {
    queueMicrotask(() => {
      setLeadSourceDescription(dedupeLeadSourceDescriptionTail(defaultLeadSourceDescription));
    });
  }, [defaultLeadSourceDescription]);

  useEffect(() => {
    queueMicrotask(() => {
      if (listType !== "contacts") {
        setContactEditRows(null);
        return;
      }
      setContactEditRows((approvedRows as EnrichedContact[]).map((r) => ({ ...r })));
    });
  }, [listType, approvedRows]);

  const loadFolders = useCallback(() => {
    let cancelled = false;
    setFoldersLoading(true);
    setFoldersError(false);
    void fetch("/api/hubspot/folders")
      .then(async (res) => {
        const data = (await res.json()) as HubSpotFoldersApiResponse;
        if (!res.ok) throw new Error(data.error ?? "Failed to load folders");
        const liveFolders = Array.isArray(data.folders)
          ? [...data.folders].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
          : [];
        if (!cancelled) {
          setFolders(liveFolders);
          setFoldersError(liveFolders.length === 0);
        }
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

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    const timer = setTimeout(() => {
      cleanup = loadFolders();
    }, 0);
    return () => {
      clearTimeout(timer);
      cleanup?.();
    };
  }, [loadFolders]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.sessionStorage.getItem(FOLDER_SELECTION_SESSION_KEY);
    if (saved) {
      queueMicrotask(() => {
        setFolderId(saved);
      });
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(FOLDER_SELECTION_SESSION_KEY, folderId);
  }, [folderId]);

  const contactRowsForTable = contactEditRows ?? (approvedRows as EnrichedContact[]);
  const hasExistingLeadSourceValues = useMemo(
    () =>
      listType === "contacts"
        ? contactRowsForTable.some((r) => (r.leadSource ?? "").trim().length > 0)
        : false,
    [listType, contactRowsForTable],
  );
  const hasExistingLeadSourceDescriptionValues = useMemo(
    () =>
      listType === "contacts"
        ? contactRowsForTable.some((r) => (r.leadSourceDescription ?? "").trim().length > 0)
        : false,
    [listType, contactRowsForTable],
  );
  const needsSharedLeadSourceDescriptionFallback = useMemo(
    () =>
      listType === "contacts" &&
      useExistingLeadSourceDescription &&
      contactRowsForTable.some((r) => (r.leadSourceDescription ?? "").trim().length === 0),
    [listType, useExistingLeadSourceDescription, contactRowsForTable],
  );

  useEffect(() => {
    queueMicrotask(() => {
      if (listType !== "contacts") {
        setUseExistingLeadSource(false);
        setUseExistingLeadSourceDescription(false);
        return;
      }
      setUseExistingLeadSource(hasExistingLeadSourceValues);
      setUseExistingLeadSourceDescription(hasExistingLeadSourceDescriptionValues);
    });
  }, [listType, hasExistingLeadSourceValues, hasExistingLeadSourceDescriptionValues]);

  const canPush = useMemo(() => {
    const nameOk = listName.trim().length > 0;
    if (listType === "companies") {
      return nameOk;
    }
    const lsOk = useExistingLeadSource ? true : leadSource.trim().length > 0;
    const lsdOk = useExistingLeadSourceDescription
      ? !needsSharedLeadSourceDescriptionFallback || leadSourceDescription.trim().length > 0
      : leadSourceDescription.trim().length > 0;
    return nameOk && lsOk && lsdOk;
  }, [
    listName,
    leadSource,
    leadSourceDescription,
    listType,
    useExistingLeadSource,
    useExistingLeadSourceDescription,
    needsSharedLeadSourceDescriptionFallback,
  ]);

  const handlePush = useCallback(() => {
    if (!canPush) return;
    onPush({
      listName: listName.trim(),
      folderId: folderId.trim() || undefined,
      leadSource: listType === "contacts" ? leadSource.trim() : "",
      leadSourceDescription: listType === "contacts" ? leadSourceDescription.trim() : "",
      useExistingLeadSource: listType === "contacts" ? useExistingLeadSource : false,
      useExistingLeadSourceDescription:
        listType === "contacts" ? useExistingLeadSourceDescription : false,
      notes: "",
      contactRowsOverride:
        listType === "contacts" && contactEditRows ? contactEditRows : undefined,
    });
  }, [
    canPush,
    listName,
    folderId,
    leadSource,
    leadSourceDescription,
    useExistingLeadSource,
    useExistingLeadSourceDescription,
    listType,
    contactEditRows,
    onPush,
  ]);

  const patchContact = useCallback((id: string, partial: Partial<EnrichedContact>) => {
    setContactEditRows((prev) =>
      prev ? prev.map((r) => (r.id === id ? { ...r, ...partial } : r)) : prev,
    );
  }, []);

  const fieldPreviewRows = useMemo(() => {
    const rows = listType === "contacts"
      ? (contactRowsForTable as Array<EnrichedCompany | EnrichedContact>)
      : (approvedRows as Array<EnrichedCompany | EnrichedContact>);
    return rows.map((row) => {
      const isUpdate = typeof (row as EnrichedCompany).hubspotId === "string" && (row as EnrichedCompany).hubspotId !== null && (row as EnrichedCompany).hubspotId !== "";
      const preview = listType === "companies"
        ? previewCompanyFields(row as EnrichedCompany, isUpdate)
        : previewContactFields(row as EnrichedContact, isUpdate);
      const name = listType === "companies"
        ? ((row as EnrichedCompany).resolvedName?.trim() || (row as EnrichedCompany).rawInput?.trim() || "—")
        : `${(row as EnrichedContact).firstName ?? ""} ${(row as EnrichedContact).lastName ?? ""}`.trim() || "—";
      return { id: row.id, name, ...preview };
    });
  }, [listType, approvedRows, contactRowsForTable]);

  const ownershipCompaniesNoState = useMemo(() => {
    if (listType !== "companies") return 0;
    return (approvedRows as EnrichedCompany[]).filter((r) => !r.state?.trim()).length;
  }, [listType, approvedRows]);

  const ownershipContactsNoDomain = useMemo(() => {
    if (listType !== "contacts") return 0;
    return (contactRowsForTable as EnrichedContact[]).filter(
      (r) => !r.companyDomain?.trim() && !r.ziCompanyWebsite?.trim(),
    ).length;
  }, [listType, contactRowsForTable]);

  return (
    <>
      <section className="flex flex-col gap-6 pb-32">
        <div>
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Ready to Import</h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Review your import settings before pushing to HubSpot.
          </p>
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
              <span className="text-sm text-zinc-500">Loading folders...</span>
            ) : foldersError ? (
              <div className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 dark:border-amber-800 dark:bg-amber-950/30">
                <p className="text-xs text-amber-800 dark:text-amber-200">
                  Could not load folders from HubSpot. You can push without a folder and organize in HubSpot after.
                </p>
                <button
                  type="button"
                  onClick={loadFolders}
                  className="self-start rounded border border-amber-300 px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-100 dark:hover:bg-amber-900/50"
                >
                  Retry
                </button>
              </div>
            ) : (
              <SelectCaretWrap>
                <select
                  className={SELECT_WITH_CARET}
                  value={folderId}
                  onChange={(e) => setFolderId(e.target.value)}
                >
                  <option value="">No folder</option>
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
                {hasExistingLeadSourceValues ? (
                  <label className="mb-1 inline-flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                    <input
                      type="checkbox"
                      checked={useExistingLeadSource}
                      onChange={(e) => setUseExistingLeadSource(e.target.checked)}
                    />
                    Use existing Lead Source values from CSV
                  </label>
                ) : null}
                <SelectCaretWrap>
                  <select
                    className={`${SELECT_WITH_CARET} ${useExistingLeadSource ? "opacity-60" : ""}`}
                    value={leadSource}
                    onChange={(e) => setLeadSource(e.target.value)}
                    disabled={useExistingLeadSource}
                    required
                  >
                    <option value="">Select lead source</option>
                    {LEAD_SOURCE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </SelectCaretWrap>
              </label>

              <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                <span className="font-medium text-zinc-800 dark:text-zinc-200">
                  Lead Source Description <span className="text-red-600">*</span>
                </span>
                {hasExistingLeadSourceDescriptionValues ? (
                  <label className="mb-1 inline-flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                    <input
                      type="checkbox"
                      checked={useExistingLeadSourceDescription}
                      onChange={(e) => setUseExistingLeadSourceDescription(e.target.checked)}
                    />
                    Use existing values from CSV (varies per contact)
                  </label>
                ) : null}
                <input
                  className={`${FIELD_CONTROL} ${useExistingLeadSourceDescription ? "opacity-60" : ""}`}
                  value={leadSourceDescription}
                  onChange={(e) => setLeadSourceDescription(e.target.value)}
                  disabled={useExistingLeadSourceDescription}
                />
              </label>
            </>
          ) : null}
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
                            onSave={(v) => patchContact(row.id, { linkedinUrl: v, linkedinSource: "" })}
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
      </section>

      {/* Section 10a: Collapsible field preview */}
      <div className={CARD_PANEL}>
        <button
          type="button"
          className="flex w-full items-center justify-between text-sm font-semibold text-zinc-800 dark:text-zinc-200"
          onClick={() => setPreviewOpen((o) => !o)}
          aria-expanded={previewOpen}
        >
          <span>Preview fields being pushed to HubSpot</span>
          <span className="text-zinc-500">{previewOpen ? "▼" : "▶"}</span>
        </button>

        {previewOpen ? (
          <div className="mt-3 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="min-w-full border-collapse text-left text-xs sm:text-sm">
              <thead className="bg-zinc-100 dark:bg-zinc-800/80">
                <tr>
                  <th className={TABLE_HEAD_CELL}>Record</th>
                  <th className={TABLE_HEAD_CELL}>Fields being written</th>
                  <th className={TABLE_HEAD_CELL}>Fields skipped (HubSpot has value)</th>
                  <th className={TABLE_HEAD_CELL}></th>
                </tr>
              </thead>
              <tbody>
                {fieldPreviewRows.map((row) => {
                  const isExpanded = expandedPreviewRows.has(row.id);
                  return (
                    <>
                      <tr key={row.id} className={TABLE_ROW}>
                        <td className="max-w-40 wrap-break-word px-3 py-2 font-medium text-zinc-800 dark:text-zinc-200">
                          {row.name}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-zinc-800 dark:text-zinc-200">
                          <span className="font-medium text-emerald-700 dark:text-emerald-400">{row.written.length}</span>
                        </td>
                        <td className="px-3 py-2 tabular-nums text-zinc-600 dark:text-zinc-400">
                          {row.skipped.length > 0 ? (
                            <span className="text-amber-700 dark:text-amber-400">{row.skipped.length}</span>
                          ) : "—"}
                        </td>
                        <td className="px-3 py-2">
                          {(row.written.length > 0 || row.skipped.length > 0) ? (
                            <button
                              type="button"
                              className="text-xs text-blue-600 underline hover:text-blue-800 dark:text-blue-400"
                              onClick={() =>
                                setExpandedPreviewRows((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(row.id)) next.delete(row.id);
                                  else next.add(row.id);
                                  return next;
                                })
                              }
                            >
                              {isExpanded ? "Hide" : "Details"}
                            </button>
                          ) : null}
                        </td>
                      </tr>
                      {isExpanded ? (
                        <tr key={`${row.id}-detail`} className="bg-zinc-50 dark:bg-zinc-900/50">
                          <td colSpan={4} className="px-4 pb-3 pt-1">
                            <div className="flex flex-wrap gap-6">
                              {row.written.length > 0 ? (
                                <div className="min-w-48">
                                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                                    Will write ({row.written.length})
                                  </p>
                                  <ul className="space-y-0.5">
                                    {row.written.map((f) => (
                                      <li key={f.key} className="flex items-baseline gap-1.5 text-xs text-zinc-700 dark:text-zinc-300">
                                        <span className="font-medium text-zinc-900 dark:text-zinc-100 shrink-0">{f.label}:</span>
                                        <span className="break-all">{f.value}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              ) : null}
                              {row.skipped.length > 0 ? (
                                <div className="min-w-48">
                                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                                    Skipped — HubSpot has value ({row.skipped.length})
                                  </p>
                                  <ul className="space-y-0.5">
                                    {row.skipped.map((f) => (
                                      <li key={f.key} className="flex items-baseline gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                                        <span className="font-medium shrink-0">{f.label}:</span>
                                        <span className="break-all italic">{f.hsValue}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      {/* Section 10b: Ownership failure preview */}
      {(ownershipCompaniesNoState > 0 || ownershipContactsNoDomain > 0) ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-4 dark:border-amber-800 dark:bg-amber-950/30">
          <p className="mb-2 text-sm font-semibold text-amber-900 dark:text-amber-100">
            After this push, the following records may not have an owner assigned automatically:
          </p>
          <ul className="space-y-1 text-sm text-amber-800 dark:text-amber-200">
            {ownershipCompaniesNoState > 0 ? (
              <li>• {ownershipCompaniesNoState} {ownershipCompaniesNoState === 1 ? "company" : "companies"} with no state/region</li>
            ) : null}
            {ownershipContactsNoDomain > 0 ? (
              <li>• {ownershipContactsNoDomain} {ownershipContactsNoDomain === 1 ? "contact" : "contacts"} with no company domain (no HubSpot company association possible)</li>
            ) : null}
          </ul>
        </div>
      ) : null}

      <div className="pointer-events-none fixed bottom-0 left-0 right-0 z-50 border-t border-zinc-200 bg-white/95 px-4 py-4 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-900/95">
        <div className="pointer-events-auto mx-auto flex w-full max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center justify-between gap-3 sm:justify-start">
            <button
              type="button"
              disabled={!canPush}
              onClick={handlePush}
              className={`rounded-lg px-4 py-2 text-sm font-semibold ${
                canPush
                  ? "bg-(--realm-purple) text-white hover:bg-(--realm-purple-hover)"
                  : "cursor-not-allowed bg-zinc-300 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400"
              }`}
            >
              Push to HubSpot →
            </button>
          </div>
          <p className="max-w-md text-right text-sm text-(--text-muted) sm:text-left">
            💡 After pushing, open the HubSpot list and click &quot;Enrich&quot; to run native data
            enrichment.
          </p>
        </div>
      </div>
    </>
  );
}
