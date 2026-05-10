"use client";

import type {
  EnrichedCompany,
  EnrichedContact,
  HubSpotFoldersApiResponse,
} from "@/lib/utils/types";
import { FieldTrustRulesSubline } from "@/components/FieldTrustRulesSubline";
import { ReasoningTooltip } from "@/components/ReasoningTooltip";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

const CARD_PANEL =
  "rounded-xl border border-(--border-default) bg-(--bg-card) p-6 shadow-(--shadow-card)";

const FIELD_CONTROL =
  "rounded-lg border border-(--border-default) bg-(--bg-card) px-3 py-2 text-(--text-primary)";

/** Collapse duplicated trailing "Mon. YYYY Mon. YYYY" when the parent string already ended with that date. */
function dedupeLeadSourceDescriptionTail(s: string): string {
  const t = s.trim();
  return t.replace(
    /\s+((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.\s*\d{4})\s+\1$/i,
    " $1",
  );
}

const SELECT_WITH_CARET =
  "w-full appearance-none rounded-lg border border-(--border-default) bg-(--bg-card) py-2 pl-3 pr-10 text-sm text-(--text-primary)";

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

const SUMMARY_TOOLTIP_OVERWRITE = "Overwrites existing HubSpot value";
const SUMMARY_TOOLTIP_FILL = "Fills empty only — existing value preserved";

type SummaryWriteRule = "overwrite" | "fill_empty";

/** Matches field trust rule HTML for contact enriched columns (tooltips only). */
const CONTACT_ENRICHED_WRITE = {
  state: "overwrite",
  city: "overwrite",
  employees: "overwrite",
  industry: "fill_empty",
  jobLevel: "fill_empty",
  jobFunction: "fill_empty",
} as const satisfies Record<string, SummaryWriteRule>;

const COMPANY_ENRICHED_WRITE = {
  state: "overwrite",
  city: "overwrite",
  employees: "overwrite",
  industry: "fill_empty",
} as const satisfies Record<string, SummaryWriteRule>;

const CONTACT_CORE_STICKY_PX = [96, 96, 132, 148, 120, 120, 128, 168, 152] as const;
const COMPANY_CORE_STICKY_PX = [148, 136, 136, 132] as const;

function coreStickyOffset(widths: readonly number[], index: number): number {
  let sum = 0;
  for (let i = 0; i < index; i++) sum += widths[i] ?? 0;
  return sum;
}

function contactCityStateDisplay(
  location: string | undefined,
): { city: string; stateRegion: string } {
  const loc = (location ?? "").trim();
  if (!loc) return { city: "", stateRegion: "" };
  const i = loc.indexOf(",");
  if (i < 0) return { city: "", stateRegion: loc };
  return {
    city: loc.slice(0, i).trim(),
    stateRegion: loc.slice(i + 1).trim(),
  };
}

function resolvedLeadSourceDisplay(
  row: EnrichedContact,
  useExisting: boolean,
  globalValue: string,
): string {
  if (useExisting) return (row.leadSource ?? "").trim() || "—";
  if (!globalValue.trim()) return "—";
  const opt = LEAD_SOURCE_OPTIONS.find((o) => o.value === globalValue);
  return opt?.label ?? globalValue;
}

function resolvedLeadSourceDescriptionDisplay(
  row: EnrichedContact,
  useExisting: boolean,
  globalDescription: string,
): string {
  if (useExisting) return (row.leadSourceDescription ?? "").trim() || "—";
  return globalDescription.trim() || "—";
}

function SummaryEmailCell({ row }: { row: EnrichedContact }) {
  const work = (row.resolvedEmail ?? "").trim();
  const personal = (row.personalEmail ?? "").trim();
  const showPersonal =
    personal.length > 0 &&
    work.length > 0 &&
    personal.toLowerCase() !== work.toLowerCase();
  const primary = work || (row.rawEmail ?? "").trim();
  if (!primary && !showPersonal) return <span className="text-zinc-400">—</span>;
  if (!showPersonal) {
    return <span className="wrap-break-word break-all">{primary}</span>;
  }
  return (
    <div className="max-w-44">
      <div className="wrap-break-word break-all">{work || primary}</div>
      <div className="wrap-break-word break-all text-xs text-(--text-secondary)">{personal}</div>
    </div>
  );
}

function CoreTh(props: {
  children: ReactNode;
  index: number;
  widths: readonly number[];
  lastCore: boolean;
}) {
  const { children, index, widths, lastCore } = props;
  const w = widths[index] ?? 96;
  const left = coreStickyOffset(widths, index);
  return (
    <th
      className={`sticky z-30 border-b border-zinc-200 bg-zinc-100 px-3 py-2 text-left text-xs font-semibold text-zinc-800 dark:border-zinc-800 dark:bg-zinc-800/80 dark:text-zinc-200 ${
        lastCore
          ? "border-r-2 border-r-zinc-300 shadow-[2px_0_6px_-2px_rgba(0,0,0,0.08)] dark:border-r-zinc-600"
          : ""
      }`}
      style={{ left, minWidth: w }}
    >
      {children}
    </th>
  );
}

function CoreTd(props: {
  children: ReactNode;
  index: number;
  widths: readonly number[];
  lastCore: boolean;
}) {
  const { children, index, widths, lastCore } = props;
  const w = widths[index] ?? 96;
  const left = coreStickyOffset(widths, index);
  return (
    <td
      className={`sticky z-10 border-b border-zinc-200 bg-(--bg-card) px-3 py-2 align-middle text-xs text-zinc-800 dark:border-zinc-800 dark:text-zinc-200 sm:text-sm ${
        lastCore
          ? "border-r-2 border-r-zinc-300 shadow-[2px_0_6px_-2px_rgba(0,0,0,0.06)] dark:border-r-zinc-600"
          : ""
      }`}
      style={{ left, minWidth: w }}
    >
      {children}
    </td>
  );
}

function EnrichedTh({ label, rule }: { label: string; rule: SummaryWriteRule }) {
  const tip = rule === "overwrite" ? SUMMARY_TOOLTIP_OVERWRITE : SUMMARY_TOOLTIP_FILL;
  return (
    <th className="border-b border-zinc-200 bg-zinc-200/95 px-3 py-2 text-left text-xs font-semibold text-zinc-800 dark:border-zinc-800 dark:bg-zinc-700/75 dark:text-zinc-100 sm:text-sm">
      <span className="inline-flex items-center gap-1">
        {label}
        <ReasoningTooltip
          content={
            <span className="whitespace-nowrap text-xs text-(--text-secondary)">{tip}</span>
          }
          trigger={
            <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border border-(--border-default) text-[9px] font-medium leading-none text-(--text-muted)">
              ⓘ
            </span>
          }
          triggerAriaLabel={tip}
        />
      </span>
    </th>
  );
}

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
            <table className="min-w-full border-separate border-spacing-0 text-left text-xs sm:text-sm">
              {listType === "companies" ? (
                <>
                  <thead>
                    <tr>
                      <CoreTh index={0} widths={COMPANY_CORE_STICKY_PX} lastCore={false}>
                        Name
                      </CoreTh>
                      <CoreTh index={1} widths={COMPANY_CORE_STICKY_PX} lastCore={false}>
                        Domain
                      </CoreTh>
                      <CoreTh index={2} widths={COMPANY_CORE_STICKY_PX} lastCore={false}>
                        Website
                      </CoreTh>
                      <CoreTh index={3} widths={COMPANY_CORE_STICKY_PX} lastCore={true}>
                        LinkedIn
                      </CoreTh>
                      <EnrichedTh label="State/Region" rule={COMPANY_ENRICHED_WRITE.state} />
                      <EnrichedTh label="City" rule={COMPANY_ENRICHED_WRITE.city} />
                      <EnrichedTh label="Employee Count" rule={COMPANY_ENRICHED_WRITE.employees} />
                      <EnrichedTh label="Industry" rule={COMPANY_ENRICHED_WRITE.industry} />
                    </tr>
                  </thead>
                  <tbody>
                    {(approvedRows as EnrichedCompany[]).map((row) => (
                      <tr key={row.id}>
                        <CoreTd index={0} widths={COMPANY_CORE_STICKY_PX} lastCore={false}>
                          {row.resolvedName}
                        </CoreTd>
                        <CoreTd index={1} widths={COMPANY_CORE_STICKY_PX} lastCore={false}>
                          <span className="break-all">{row.domain}</span>
                        </CoreTd>
                        <CoreTd index={2} widths={COMPANY_CORE_STICKY_PX} lastCore={false}>
                          <span className="break-all">{websiteFromDomain(row.domain)}</span>
                        </CoreTd>
                        <CoreTd index={3} widths={COMPANY_CORE_STICKY_PX} lastCore={true}>
                          <span className="break-all">{row.linkedinUrl || "—"}</span>
                        </CoreTd>
                        <td className="border-b border-zinc-200 bg-(--bg-card) px-3 py-2 text-zinc-800 dark:border-zinc-800 dark:text-zinc-200">
                          {row.state?.trim() || "—"}
                        </td>
                        <td className="border-b border-zinc-200 bg-(--bg-card) px-3 py-2 text-zinc-800 dark:border-zinc-800 dark:text-zinc-200">
                          {row.city?.trim() || "—"}
                        </td>
                        <td className="border-b border-zinc-200 bg-(--bg-card) px-3 py-2 text-zinc-800 dark:border-zinc-800 dark:text-zinc-200">
                          {row.numberOfEmployees != null ? String(row.numberOfEmployees) : "—"}
                        </td>
                        <td className="border-b border-zinc-200 bg-(--bg-card) px-3 py-2 text-zinc-800 dark:border-zinc-800 dark:text-zinc-200">
                          {row.industry?.trim() || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </>
              ) : (
                <>
                  <thead>
                    <tr>
                      <CoreTh index={0} widths={CONTACT_CORE_STICKY_PX} lastCore={false}>
                        First Name
                      </CoreTh>
                      <CoreTh index={1} widths={CONTACT_CORE_STICKY_PX} lastCore={false}>
                        Last Name
                      </CoreTh>
                      <CoreTh index={2} widths={CONTACT_CORE_STICKY_PX} lastCore={false}>
                        Email
                      </CoreTh>
                      <CoreTh index={3} widths={CONTACT_CORE_STICKY_PX} lastCore={false}>
                        Company Name
                      </CoreTh>
                      <CoreTh index={4} widths={CONTACT_CORE_STICKY_PX} lastCore={false}>
                        Title
                      </CoreTh>
                      <CoreTh index={5} widths={CONTACT_CORE_STICKY_PX} lastCore={false}>
                        LinkedIn
                      </CoreTh>
                      <CoreTh index={6} widths={CONTACT_CORE_STICKY_PX} lastCore={false}>
                        Lead Source
                      </CoreTh>
                      <CoreTh index={7} widths={CONTACT_CORE_STICKY_PX} lastCore={false}>
                        Lead Source Desc.
                      </CoreTh>
                      <CoreTh index={8} widths={CONTACT_CORE_STICKY_PX} lastCore={true}>
                        Membership Notes
                      </CoreTh>
                      <EnrichedTh label="State/Region" rule={CONTACT_ENRICHED_WRITE.state} />
                      <EnrichedTh label="City" rule={CONTACT_ENRICHED_WRITE.city} />
                      <EnrichedTh label="Employee Count" rule={CONTACT_ENRICHED_WRITE.employees} />
                      <EnrichedTh label="Industry" rule={CONTACT_ENRICHED_WRITE.industry} />
                      <EnrichedTh label="Job Level" rule={CONTACT_ENRICHED_WRITE.jobLevel} />
                      <EnrichedTh label="Job Function" rule={CONTACT_ENRICHED_WRITE.jobFunction} />
                    </tr>
                  </thead>
                  <tbody>
                    {contactRowsForTable.map((row) => {
                      const loc = contactCityStateDisplay(row.location);
                      return (
                        <tr key={row.id}>
                          <CoreTd index={0} widths={CONTACT_CORE_STICKY_PX} lastCore={false}>
                            {row.firstName}
                          </CoreTd>
                          <CoreTd index={1} widths={CONTACT_CORE_STICKY_PX} lastCore={false}>
                            {row.lastName}
                          </CoreTd>
                          <CoreTd index={2} widths={CONTACT_CORE_STICKY_PX} lastCore={false}>
                            <SummaryEmailCell row={row} />
                          </CoreTd>
                          <CoreTd index={3} widths={CONTACT_CORE_STICKY_PX} lastCore={false}>
                            <PrePushEditableCell
                              value={row.resolvedCompany}
                              onSave={(v) => patchContact(row.id, { resolvedCompany: v })}
                            />
                          </CoreTd>
                          <CoreTd index={4} widths={CONTACT_CORE_STICKY_PX} lastCore={false}>
                            <PrePushEditableCell
                              value={row.title}
                              onSave={(v) => patchContact(row.id, { title: v })}
                            />
                          </CoreTd>
                          <CoreTd index={5} widths={CONTACT_CORE_STICKY_PX} lastCore={false}>
                            <PrePushEditableCell
                              value={row.linkedinUrl}
                              breakAll
                              onSave={(v) =>
                                patchContact(row.id, { linkedinUrl: v, linkedinSource: "" })
                              }
                            />
                          </CoreTd>
                          <CoreTd index={6} widths={CONTACT_CORE_STICKY_PX} lastCore={false}>
                            <span className="wrap-break-word">
                              {resolvedLeadSourceDisplay(
                                row,
                                useExistingLeadSource,
                                leadSource,
                              )}
                            </span>
                          </CoreTd>
                          <CoreTd index={7} widths={CONTACT_CORE_STICKY_PX} lastCore={false}>
                            <span className="wrap-break-word">
                              {resolvedLeadSourceDescriptionDisplay(
                                row,
                                useExistingLeadSourceDescription,
                                leadSourceDescription,
                              )}
                            </span>
                          </CoreTd>
                          <CoreTd index={8} widths={CONTACT_CORE_STICKY_PX} lastCore={true}>
                            <span className="wrap-break-word">
                              {row.membershipNotes?.trim() ? row.membershipNotes : "—"}
                            </span>
                          </CoreTd>
                          <td className="border-b border-zinc-200 bg-(--bg-card) px-3 py-2 text-zinc-800 dark:border-zinc-800 dark:text-zinc-200">
                            {loc.stateRegion.trim() || "—"}
                          </td>
                          <td className="border-b border-zinc-200 bg-(--bg-card) px-3 py-2 text-zinc-800 dark:border-zinc-800 dark:text-zinc-200">
                            {loc.city.trim() || "—"}
                          </td>
                          <td className="border-b border-zinc-200 bg-(--bg-card) px-3 py-2 text-zinc-800 dark:border-zinc-800 dark:text-zinc-200">
                            {row.ziCompanyEmployeeCount?.trim() || "—"}
                          </td>
                          <td className="border-b border-zinc-200 bg-(--bg-card) px-3 py-2 text-zinc-800 dark:border-zinc-800 dark:text-zinc-200">
                            {row.ziCompanyPrimaryIndustry?.trim() || "—"}
                          </td>
                          <td className="border-b border-zinc-200 bg-(--bg-card) px-3 py-2 text-zinc-800 dark:border-zinc-800 dark:text-zinc-200">
                            {row.ziManagementLevel?.trim() || "—"}
                          </td>
                          <td className="border-b border-zinc-200 bg-(--bg-card) px-3 py-2 text-zinc-800 dark:border-zinc-800 dark:text-zinc-200">
                            {row.ziJobFunction?.trim() || "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </>
              )}
            </table>
          </div>
          <FieldTrustRulesSubline listType={listType} />
        </div>
      </section>

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

      <div className="pointer-events-none fixed bottom-0 left-0 right-0 z-50 border-t border-(--border-default) bg-(--bg-card)/95 px-4 py-4 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] backdrop-blur-sm">
        <div className="pointer-events-auto mx-auto flex w-full max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center justify-between gap-3 sm:justify-start">
            <button
              type="button"
              disabled={!canPush}
              onClick={handlePush}
              className={`rounded-lg px-4 py-2 text-sm font-semibold ${
                canPush
                  ? "bg-(--realm-purple) text-white transition-transform duration-75 hover:bg-(--realm-purple-hover) active:scale-95"
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
