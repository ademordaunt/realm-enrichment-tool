"use client";

import { ConfidenceBadge } from "@/components/ConfidenceBadge";
import { ReasoningTooltip } from "@/components/ReasoningTooltip";
import {
  sanitizeCompany,
  sanitizeCompanyName,
  sanitizeContact,
  sanitizeState,
  sanitizeUnknown,
} from "@/lib/utils/sanitize";
import { expandStateAbbreviation, STATE_REGION_OPTIONS } from "@/lib/utils/states";
import type { EnrichedCompany, EnrichedContact } from "@/lib/utils/types";
import { useCallback, useEffect, useMemo, useState } from "react";

export interface ReviewTableProps {
  rows: EnrichedCompany[] | EnrichedContact[];
  listType: "companies" | "contacts";
  onRowsChange: (rows: EnrichedCompany[] | EnrichedContact[]) => void;
  /** Called when the user clicks the sticky “Approve” action (does not call HubSpot). */
  onApprove?: () => void;
}

function websiteFromDomain(domain: string): string {
  const d = domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];
  return d ? `https://www.${d}` : "";
}

type FilterKey = "all" | "needs_review" | "approved" | "skipped";

const CONFIDENCE_ORDER: Record<EnrichedCompany["confidenceScore"], number> = {
  unresolved: 0,
  low: 1,
  medium: 2,
  high: 3,
};

function formatContactFullName(c: EnrichedContact): string {
  const fn = sanitizeUnknown(c.firstName);
  const ln = sanitizeUnknown(c.lastName);
  return [fn, ln].filter(Boolean).join(" ").trim();
}

/** Critical gaps → treat as unresolved for sort + badge (does not mutate stored enrichment). */
function getDisplayConfidence(
  row: EnrichedCompany | EnrichedContact,
  listType: "companies" | "contacts",
): EnrichedCompany["confidenceScore"] {
  if (listType === "companies") {
    const c = row as EnrichedCompany;
    const stateOk = sanitizeState(c.state);
    const missingCritical =
      !c.resolvedName?.trim() ||
      !c.domain?.trim() ||
      !c.linkedinUrl?.trim() ||
      c.numberOfEmployees == null ||
      !stateOk;
    if (missingCritical) return "unresolved";
    return c.confidenceScore;
  }
  const c = row as EnrichedContact;
  const emailOk = sanitizeUnknown(c.rawEmail);
  const companyOk = sanitizeCompanyName(c.resolvedCompany);
  const titleOk = sanitizeUnknown(c.title);
  const linkedinOk = sanitizeUnknown(c.linkedinUrl);
  const missingCritical =
    !emailOk || !companyOk || !titleOk || !linkedinOk;
  if (missingCritical) return "unresolved";
  return c.confidenceScore;
}

function initialCompanyReviewStatus(company: EnrichedCompany): EnrichedCompany["status"] {
  if (
    company.hubspotComplete &&
    getDisplayConfidence(company, "companies") !== "unresolved"
  ) {
    return "approved";
  }
  if (getDisplayConfidence(company, "companies") === "unresolved") {
    return "skipped";
  }
  return "approved";
}

function initialContactReviewStatus(contact: EnrichedContact): EnrichedContact["status"] {
  if (
    contact.hubspotComplete &&
    getDisplayConfidence(contact, "contacts") !== "unresolved"
  ) {
    return "approved";
  }
  return getDisplayConfidence(contact, "contacts") !== "unresolved" ? "approved" : "pending";
}

function rowKey(id: string, field: string): string {
  return `${id}:${field}`;
}

/** Matches ConfidenceBadge footprint: inline, rounded-full, px-2 py-0.5 text-xs. */
function HubSpotPrecheckBadge(props: { complete: boolean }) {
  return (
    <span
      className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-zinc-200 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
      title={props.complete ? "Complete in HubSpot" : "In HubSpot (incomplete)"}
    >
      {props.complete ? "✓ HS" : "~ HS"}
    </span>
  );
}

/** Sort: non-approved first; within approved/non-approved, tier by display confidence per spec. */
function reviewSortTier(
  row: EnrichedCompany | EnrichedContact,
  listType: "companies" | "contacts",
): number {
  const approved = row.status === "approved";
  const disp = getDisplayConfidence(row, listType);
  const unresolved = disp === "unresolved";
  if (!approved && unresolved) return 0;
  if (!approved && !unresolved) return 1;
  if (approved && unresolved) return 2;
  return 3;
}

function EditableCell(props: {
  value: string;
  edited: boolean;
  muted?: boolean;
  align?: "left" | "right";
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  breakAll?: boolean;
  /** Company columns: pencil affordance on hover (LinkedIn-style). */
  pencilOnHover?: boolean;
  onSave: (next: string) => void;
}) {
  const {
    value,
    edited,
    muted,
    align = "left",
    inputMode,
    breakAll,
    pencilOnHover = false,
    onSave,
  } = props;
  const normalized = value == null ? "" : String(value);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(normalized);

  useEffect(() => {
    if (!editing) setDraft(value == null ? "" : String(value));
  }, [value, editing]);

  const wrap = breakAll ? "break-all whitespace-normal" : "wrap-break-word";

  if (editing) {
    return (
      <div className={`relative min-w-24 max-w-50 ${wrap}`}>
        <input
          className={`w-full rounded border border-blue-500 bg-white px-1.5 py-0.5 text-xs outline-none ring-1 ring-blue-500/30 dark:bg-zinc-950 sm:text-sm ${
            align === "right" ? "text-right tabular-nums" : ""
          } ${muted ? "text-zinc-500" : ""} ${wrap}`}
          value={draft}
          inputMode={inputMode}
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
        {edited ? (
          <span
            className="pointer-events-none absolute right-0 top-0 h-1.5 w-1.5 rounded-full bg-blue-500"
            aria-hidden
          />
        ) : null}
      </div>
    );
  }

  const displayEmpty = normalized.trim() === "";

  return (
    <button
      type="button"
      className={`group relative inline-flex min-h-5 w-full max-w-50 items-center ${
        pencilOnHover ? "justify-between gap-1" : ""
      } rounded px-1.5 py-0.5 text-left text-xs sm:text-sm ${wrap} ${
        align === "right" ? "text-right tabular-nums" : ""
      } ${muted ? "text-zinc-500" : "text-zinc-900 dark:text-zinc-100"} hover:bg-zinc-100/80 dark:hover:bg-zinc-800/80`}
      onClick={() => setEditing(true)}
    >
      <span className={`min-w-0 flex-1 ${align === "right" ? "text-right" : ""}`}>
        {displayEmpty ? (
          <span className="text-zinc-400">—</span>
        ) : (
          normalized
        )}
      </span>
      {pencilOnHover ? (
        <span
          className="shrink-0 text-[0.75rem] leading-none text-zinc-400 opacity-0 transition-opacity group-hover:opacity-100"
          aria-hidden
        >
          ✏️
        </span>
      ) : null}
      {edited ? (
        <span
          className="pointer-events-none absolute right-0 top-0 h-1.5 w-1.5 rounded-full bg-blue-500"
          aria-hidden
        />
      ) : null}
    </button>
  );
}

function StateRegionCell(props: {
  value: string;
  edited: boolean;
  muted?: boolean;
  onSave: (next: string) => void;
}) {
  const { value, edited, muted, onSave } = props;
  const normalized = sanitizeState(value);
  const [editing, setEditing] = useState(false);

  const options = useMemo(() => {
    const o = [...STATE_REGION_OPTIONS];
    if (normalized && !o.includes(normalized)) {
      return [normalized, ...o];
    }
    return o;
  }, [normalized]);

  const selectValue = options.includes(normalized) || normalized === "" ? normalized : normalized;

  if (editing) {
    return (
      <div className="relative min-w-40 max-w-56">
        <select
          className="w-full rounded border border-blue-500 bg-white px-1 py-0.5 text-xs outline-none ring-1 ring-blue-500/30 dark:bg-zinc-950 sm:text-sm"
          autoFocus
          value={selectValue}
          onChange={(e) => {
            const next = e.target.value;
            onSave(sanitizeState(next));
            setEditing(false);
          }}
          onBlur={(e) => {
            onSave(sanitizeState(e.target.value));
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setEditing(false);
          }}
        >
          <option value="">—</option>
          {options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
        {edited ? (
          <span
            className="pointer-events-none absolute right-1 top-0 h-1.5 w-1.5 rounded-full bg-blue-500"
            aria-hidden
          />
        ) : null}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={`group relative inline-flex min-h-5 w-full max-w-56 items-center justify-between gap-1 rounded px-1.5 py-0.5 text-left text-xs wrap-break-word sm:text-sm ${
        muted ? "text-zinc-500" : "text-zinc-900 dark:text-zinc-100"
      } hover:bg-zinc-100/80 dark:hover:bg-zinc-800/80`}
      onClick={() => setEditing(true)}
    >
      <span className="min-w-0 flex-1">
        {normalized === "" ? (
          <span className="text-zinc-400">—</span>
        ) : (
          normalized
        )}
      </span>
      <span
        className="shrink-0 text-[0.75rem] leading-none text-zinc-400 opacity-0 transition-opacity group-hover:opacity-100"
        aria-hidden
      >
        ✏️
      </span>
      {edited ? (
        <span
          className="pointer-events-none absolute right-0 top-0 h-1.5 w-1.5 rounded-full bg-blue-500"
          aria-hidden
        />
      ) : null}
    </button>
  );
}

function EmployeesCell(props: {
  value: number | null;
  edited: boolean;
  muted?: boolean;
  onSave: (next: number | null) => void;
}) {
  const { value, edited, muted, onSave } = props;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value === null ? "" : String(value));

  useEffect(() => {
    if (!editing) setDraft(value === null ? "" : String(value));
  }, [value, editing]);

  if (editing) {
    return (
      <div className="relative min-w-16">
        <input
          type="number"
          inputMode="numeric"
          min={0}
          className="w-full rounded border border-blue-500 bg-white px-1.5 py-0.5 text-right text-xs tabular-nums outline-none ring-1 ring-blue-500/30 dark:bg-zinc-950 sm:text-sm"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const t = draft.trim();
              if (t === "") onSave(null);
              else {
                const n = Number.parseInt(t, 10);
                onSave(Number.isFinite(n) ? n : null);
              }
              setEditing(false);
            }
            if (e.key === "Escape") {
              setDraft(value === null ? "" : String(value));
              setEditing(false);
            }
          }}
          onBlur={() => {
            const t = draft.trim();
            if (t === "") onSave(null);
            else {
              const n = Number.parseInt(t, 10);
              onSave(Number.isFinite(n) ? n : null);
            }
            setEditing(false);
          }}
        />
        {edited ? (
          <span
            className="pointer-events-none absolute right-0 top-0 h-1.5 w-1.5 rounded-full bg-blue-500"
            aria-hidden
          />
        ) : null}
      </div>
    );
  }

  const displayEmpty = value == null;

  return (
    <button
      type="button"
      className={`group relative inline-flex min-h-5 w-full items-center justify-end gap-1 rounded px-1.5 py-0.5 text-right text-xs tabular-nums sm:text-sm ${
        muted ? "text-zinc-500" : "text-zinc-900 dark:text-zinc-100"
      } hover:bg-zinc-100/80 dark:hover:bg-zinc-800/80`}
      onClick={() => setEditing(true)}
    >
      <span className="min-w-0 flex-1 text-right">
        {displayEmpty ? (
          <span className="text-zinc-400">—</span>
        ) : (
          value
        )}
      </span>
      <span
        className="shrink-0 text-[0.75rem] leading-none text-zinc-400 opacity-0 transition-opacity group-hover:opacity-100"
        aria-hidden
      >
        ✏️
      </span>
      {edited ? (
        <span
          className="pointer-events-none absolute right-0 top-0 h-1.5 w-1.5 rounded-full bg-blue-500"
          aria-hidden
        />
      ) : null}
    </button>
  );
}

function LinkedInProfileCell(props: {
  value: string;
  edited: boolean;
  muted?: boolean;
  breakAll?: boolean;
  missingSearchUrl?: string;
  onSave: (next: string) => void;
}) {
  const { value, edited, muted, breakAll, missingSearchUrl, onSave } = props;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => (value == null ? "" : String(value)));

  useEffect(() => {
    if (!editing) setDraft(value == null ? "" : String(value));
  }, [value, editing]);

  const wrap = breakAll ? "break-all whitespace-normal" : "wrap-break-word";

  if (editing) {
    return (
      <div className={`relative min-w-24 max-w-50 ${wrap}`}>
        <input
          className={`w-full rounded border border-blue-500 bg-white px-1.5 py-0.5 text-xs outline-none ring-1 ring-blue-500/30 dark:bg-zinc-950 sm:text-sm ${
            muted ? "text-zinc-500" : ""
          } ${wrap}`}
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onSave(draft.trim());
              setEditing(false);
            }
            if (e.key === "Escape") {
              setDraft(value == null ? "" : String(value));
              setEditing(false);
            }
          }}
          onBlur={() => {
            onSave(draft.trim());
            setEditing(false);
          }}
        />
        {edited ? (
          <span
            className="pointer-events-none absolute right-0 top-0 h-1.5 w-1.5 rounded-full bg-blue-500"
            aria-hidden
          />
        ) : null}
      </div>
    );
  }

  const t = (value == null ? "" : String(value)).trim();
  if (!t) {
    return (
      <div className={`relative flex min-w-0 max-w-full items-center gap-1 ${wrap}`}>
        <span className={`min-w-0 flex-1 text-xs sm:text-sm ${muted ? "text-zinc-500" : "text-zinc-400"}`}>
          —
        </span>
        {missingSearchUrl ? (
          <a
            href={missingSearchUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Search LinkedIn on Google"
            className="shrink-0 text-xs text-(--realm-purple) hover:underline"
          >
            🔍
          </a>
        ) : null}
        <button
          type="button"
          className="shrink-0 rounded p-0.5 text-sm text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          aria-label="Edit LinkedIn URL"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setEditing(true);
          }}
        >
          ✏️
        </button>
        {edited ? (
          <span
            className="pointer-events-none absolute right-0 top-0 h-1.5 w-1.5 rounded-full bg-blue-500"
            aria-hidden
          />
        ) : null}
      </div>
    );
  }

  const href = t.startsWith("http") ? t : `https://${t}`;

  return (
    <div className={`relative flex min-w-0 max-w-full items-center gap-1 ${wrap}`}>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        title={t}
        className="flex min-w-0 flex-1 items-center gap-0.5 truncate text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 sm:text-sm"
      >
        <span className="min-w-0 truncate">{t}</span>
        <span className="shrink-0 text-[0.65rem] leading-none opacity-80" aria-hidden>
          ↗
        </span>
      </a>
      <button
        type="button"
        className="shrink-0 rounded p-0.5 text-sm text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        aria-label="Edit LinkedIn URL"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setEditing(true);
        }}
      >
        ✏️
      </button>
      {edited ? (
        <span
          className="pointer-events-none absolute right-6 top-0 h-1.5 w-1.5 rounded-full bg-blue-500"
          aria-hidden
        />
      ) : null}
    </div>
  );
}

export function ReviewTable({ rows, listType, onRowsChange, onApprove }: ReviewTableProps) {
  const [editedKeys, setEditedKeys] = useState<Set<string>>(() => new Set());
  const [filter, setFilter] = useState<FilterKey>("all");

  useEffect(() => {
    setEditedKeys(new Set());
    setFilter("all");
  }, [rows, listType]);

  const markEdited = useCallback((id: string, field: string) => {
    setEditedKeys((prev) => {
      const next = new Set(prev);
      next.add(rowKey(id, field));
      return next;
    });
  }, []);

  const setRows = useCallback(
    (next: EnrichedCompany[] | EnrichedContact[]) => {
      onRowsChange(next);
    },
    [onRowsChange],
  );

  const sortedRows = useMemo(() => {
    if (listType === "companies") {
      return [...(rows as EnrichedCompany[])].sort((a, b) => {
        const ta = reviewSortTier(a, "companies");
        const tb = reviewSortTier(b, "companies");
        if (ta !== tb) return ta - tb;
        const da = getDisplayConfidence(a, "companies");
        const db = getDisplayConfidence(b, "companies");
        const oa = CONFIDENCE_ORDER[da] ?? 99;
        const ob = CONFIDENCE_ORDER[db] ?? 99;
        if (oa !== ob) return oa - ob;
        if (da === "unresolved" && db === "unresolved") {
          const ka = (a.resolvedName || a.rawInput || "").toLowerCase();
          const kb = (b.resolvedName || b.rawInput || "").toLowerCase();
          return ka.localeCompare(kb, undefined, { sensitivity: "base" });
        }
        return (a.resolvedName || "").localeCompare(b.resolvedName || "", undefined, {
          sensitivity: "base",
        });
      });
    }
    return [...(rows as EnrichedContact[])].sort((a, b) => {
      const ta = reviewSortTier(a, "contacts");
      const tb = reviewSortTier(b, "contacts");
      if (ta !== tb) return ta - tb;
      const da = getDisplayConfidence(a, "contacts");
      const db = getDisplayConfidence(b, "contacts");
      const oa = CONFIDENCE_ORDER[da] ?? 99;
      const ob = CONFIDENCE_ORDER[db] ?? 99;
      if (oa !== ob) return oa - ob;
      if (da === "unresolved" && db === "unresolved") {
        const ka = (a.resolvedCompany || a.rawEmail || "").toLowerCase();
        const kb = (b.resolvedCompany || b.rawEmail || "").toLowerCase();
        return ka.localeCompare(kb, undefined, { sensitivity: "base" });
      }
      const aMissingLinkedIn = !a.linkedinUrl?.trim();
      const bMissingLinkedIn = !b.linkedinUrl?.trim();
      if (aMissingLinkedIn !== bMissingLinkedIn) return aMissingLinkedIn ? -1 : 1;
      return (a.resolvedCompany || "").localeCompare(b.resolvedCompany || "", undefined, {
        sensitivity: "base",
      });
    });
  }, [rows, listType]);

  const approveAllHigh = useCallback(() => {
    if (listType === "companies") {
      setRows(
        (rows as EnrichedCompany[]).map((r) =>
          r.confidenceScore === "high" ? { ...r, status: "approved" as const } : r,
        ),
      );
    } else {
      setRows(
        (rows as EnrichedContact[]).map((r) =>
          r.confidenceScore === "high" ? { ...r, status: "approved" as const } : r,
        ),
      );
    }
  }, [listType, rows, setRows]);

  const selectAll = useCallback(() => {
    if (listType === "companies") {
      setRows((rows as EnrichedCompany[]).map((r) => ({ ...r, status: "approved" as const })));
    } else {
      setRows((rows as EnrichedContact[]).map((r) => ({ ...r, status: "approved" as const })));
    }
  }, [listType, rows, setRows]);

  const deselectAll = useCallback(() => {
    if (listType === "companies") {
      setRows((rows as EnrichedCompany[]).map((r) => ({ ...r, status: "skipped" as const })));
    } else {
      setRows((rows as EnrichedContact[]).map((r) => ({ ...r, status: "skipped" as const })));
    }
  }, [listType, rows, setRows]);

  const toggleApprove = useCallback(
    (id: string, checked: boolean) => {
      if (listType === "companies") {
        setRows(
          (rows as EnrichedCompany[]).map((r) =>
            r.id === id
              ? { ...r, status: checked ? ("approved" as const) : ("skipped" as const) }
              : r,
          ),
        );
      } else {
        setRows(
          (rows as EnrichedContact[]).map((r) =>
            r.id === id
              ? { ...r, status: checked ? ("approved" as const) : ("skipped" as const) }
              : r,
          ),
        );
      }
    },
    [listType, rows, setRows],
  );

  const visibleRows = useMemo(() => {
    const f = filter;
    if (f === "all") return sortedRows;
    return sortedRows.filter((r) => {
      if (f === "approved") return r.status === "approved";
      if (f === "skipped") return r.status === "skipped";
      return r.status === "pending";
    });
  }, [sortedRows, filter]);

  const { approvedCount, needsReviewCount, skippedCount } = useMemo(() => {
    let a = 0;
    let n = 0;
    let s = 0;
    for (const r of rows) {
      if (r.status === "approved") a++;
      else if (r.status === "pending") n++;
      else s++;
    }
    return { approvedCount: a, needsReviewCount: n, skippedCount: s };
  }, [rows]);

  const unresolvedApprovedCount = useMemo(
    () =>
      rows.filter(
        (r) => r.status === "approved" && getDisplayConfidence(r, listType) === "unresolved",
      ).length,
    [rows, listType],
  );

  const rowShellClass = (r: EnrichedCompany | EnrichedContact, rowIndex: number) => {
    if (r.status === "approved") {
      return "border-b border-(--border-default) bg-(--conf-high-bg)";
    }

    const conf = getDisplayConfidence(r, listType);
    let borderClass = "border-l-transparent";
    if (conf === "unresolved") {
      borderClass = "border-l-[var(--conf-unresolved)]";
    } else if (conf === "low") {
      borderClass = "border-l-[var(--conf-low)]";
    }

    const base = `border-b border-(--border-default) border-l-4 ${borderClass}`;
    if (r.status === "skipped") {
      return `${base} bg-(--bg-muted) opacity-70`;
    }
    const stripe = rowIndex % 2 === 0 ? "bg-(--bg-card)" : "bg-(--bg-page)";
    return `${base} ${stripe}`;
  };

  return (
    <div className="flex flex-col gap-4 pb-24">
      <h2 className="text-lg font-semibold text-(--realm-navy)">Review &amp; Edit</h2>

      <p className="text-sm font-medium text-(--text-secondary)">
        <span>{approvedCount} Approved</span>
        {" · "}
        <span>{needsReviewCount} Need Review</span>
        {" · "}
        <span>{skippedCount} Skipped</span>
      </p>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg border border-(--border-default) bg-white px-3 py-1.5 text-xs font-medium text-(--text-primary) transition-colors hover:bg-(--bg-muted)"
            onClick={approveAllHigh}
          >
            Approve All High Confidence
          </button>
          <button
            type="button"
            className="rounded-lg border border-(--border-default) bg-white px-3 py-1.5 text-xs font-medium text-(--text-primary) transition-colors hover:bg-(--bg-muted)"
            onClick={selectAll}
          >
            Select All
          </button>
          <button
            type="button"
            className="rounded-lg border border-(--border-default) bg-white px-3 py-1.5 text-xs font-medium text-(--text-primary) transition-colors hover:bg-(--bg-muted)"
            onClick={deselectAll}
          >
            Deselect All
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs font-medium text-(--text-secondary)" htmlFor="rt-filter">
            Show
          </label>
          <div className="relative">
            <select
              id="rt-filter"
              className="appearance-none rounded-lg border border-(--border-default) bg-(--bg-card) py-1 pl-2 pr-8 text-xs text-(--text-primary)"
              value={filter}
              onChange={(e) => setFilter(e.target.value as FilterKey)}
            >
              <option value="all">All</option>
              <option value="needs_review">Needs Review</option>
              <option value="approved">Approved</option>
              <option value="skipped">Skipped</option>
            </select>
            <span
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-(--text-muted)"
              aria-hidden
            >
              ▾
            </span>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-(--border-default)">
        <table className="min-w-full border-separate border-spacing-0 text-left text-xs sm:text-sm">
          <thead className="bg-(--bg-muted) text-(--text-secondary) text-sm font-semibold">
            {listType === "companies" ? (
              <tr>
                <th className="border-b border-(--border-default) px-2 py-2">Approve</th>
                <th className="border-b border-(--border-default) px-2 py-2">Raw Input</th>
                <th className="border-b border-(--border-default) px-2 py-2">Company Name</th>
                <th className="border-b border-(--border-default) px-2 py-2">
                  Company Domain Name
                </th>
                <th className="border-b border-(--border-default) px-2 py-2">State / Region</th>
                <th className="border-b border-(--border-default) px-2 py-2">
                  Number Of Employees
                </th>
                <th className="border-b border-(--border-default) px-2 py-2">
                  LinkedIn Profile
                </th>
                <th className="min-w-[120px] border-b border-(--border-default) px-2 py-2">
                  Confidence
                </th>
                <th className="border-b border-(--border-default) px-2 py-2">Reasoning</th>
              </tr>
            ) : (
              <tr>
                <th className="border-b border-(--border-default) px-2 py-2">Approve</th>
                <th className="border-b border-(--border-default) px-2 py-2">Name</th>
                <th className="border-b border-(--border-default) px-2 py-2">Email</th>
                <th className="border-b border-(--border-default) px-2 py-2">Company</th>
                <th className="border-b border-(--border-default) px-2 py-2">Title</th>
                <th className="border-b border-(--border-default) px-2 py-2">
                  LinkedIn Profile
                </th>
                <th className="min-w-[120px] border-b border-(--border-default) px-2 py-2">
                  Confidence
                </th>
                <th className="border-b border-(--border-default) px-2 py-2">Reasoning</th>
              </tr>
            )}
          </thead>
          <tbody>
            {listType === "companies"
              ? (visibleRows as EnrichedCompany[]).map((row, ri) => {
                  const muted = row.status === "skipped";
                  const checked = row.status === "approved";
                  return (
                    <tr key={row.id} className={rowShellClass(row, ri)}>
                      <td className="px-2 py-1.5 align-middle">
                        <div className="flex items-center justify-center">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-zinc-300"
                            checked={checked}
                            onChange={(e) => toggleApprove(row.id, e.target.checked)}
                            aria-label="Approve row"
                          />
                        </div>
                      </td>
                      <td
                        className={`max-w-48 px-2 py-1.5 align-middle wrap-break-word ${muted ? "text-zinc-500" : ""}`}
                      >
                        {row.rawInput}
                      </td>
                      <td className="max-w-48 px-2 py-1.5 align-middle wrap-break-word">
                        <EditableCell
                          value={row.resolvedName}
                          edited={editedKeys.has(rowKey(row.id, "resolvedName"))}
                          muted={muted}
                          pencilOnHover
                          onSave={(v) => {
                            markEdited(row.id, "resolvedName");
                            setRows(
                              (rows as EnrichedCompany[]).map((r) =>
                                r.id === row.id ? { ...r, resolvedName: v } : r,
                              ),
                            );
                          }}
                        />
                      </td>
                      <td className="max-w-48 px-2 py-1.5 align-middle wrap-break-word">
                        <EditableCell
                          value={row.domain}
                          edited={editedKeys.has(rowKey(row.id, "domain"))}
                          muted={muted}
                          pencilOnHover
                          onSave={(v) => {
                            markEdited(row.id, "domain");
                            const domain = v.trim();
                            setRows(
                              (rows as EnrichedCompany[]).map((r) =>
                                r.id === row.id
                                  ? { ...r, domain, website: websiteFromDomain(domain) }
                                  : r,
                              ),
                            );
                          }}
                        />
                      </td>
                      <td className="max-w-56 px-2 py-1.5 align-middle">
                        <StateRegionCell
                          value={row.state}
                          edited={editedKeys.has(rowKey(row.id, "state"))}
                          muted={muted}
                          onSave={(v) => {
                            markEdited(row.id, "state");
                            const full = expandStateAbbreviation(sanitizeState(v));
                            setRows(
                              (rows as EnrichedCompany[]).map((r) =>
                                r.id === row.id ? { ...r, state: full } : r,
                              ),
                            );
                          }}
                        />
                      </td>
                      <td className="px-2 py-1.5 align-middle">
                        <EmployeesCell
                          value={row.numberOfEmployees}
                          edited={editedKeys.has(rowKey(row.id, "numberOfEmployees"))}
                          muted={muted}
                          onSave={(n) => {
                            markEdited(row.id, "numberOfEmployees");
                            setRows(
                              (rows as EnrichedCompany[]).map((r) =>
                                r.id === row.id ? { ...r, numberOfEmployees: n } : r,
                              ),
                            );
                          }}
                        />
                      </td>
                      <td className="min-w-[180px] max-w-[220px] px-2 py-1.5 align-middle break-all whitespace-normal">
                        <LinkedInProfileCell
                          value={row.linkedinUrl}
                          edited={editedKeys.has(rowKey(row.id, "linkedinUrl"))}
                          muted={muted}
                          breakAll
                          onSave={(v) => {
                            markEdited(row.id, "linkedinUrl");
                            setRows(
                              (rows as EnrichedCompany[]).map((r) =>
                                r.id === row.id ? { ...r, linkedinUrl: v } : r,
                              ),
                            );
                          }}
                        />
                      </td>
                      <td className="min-w-[120px] px-2 py-1.5 align-middle">
                        <div className="flex flex-nowrap items-center gap-1.5">
                          <ConfidenceBadge score={getDisplayConfidence(row, "companies")} />
                          {row.hubspotId ? (
                            <HubSpotPrecheckBadge complete={row.hubspotComplete === true} />
                          ) : null}
                        </div>
                      </td>
                      <td className="max-w-56 px-2 py-1.5 align-middle wrap-break-word">
                        <div className="flex items-center justify-center">
                          <ReasoningTooltip text={row.aiReasoning} />
                        </div>
                      </td>
                    </tr>
                  );
                })
              : (visibleRows as EnrichedContact[]).map((row, ri) => {
                  const muted = row.status === "skipped";
                  const checked = row.status === "approved";
                  const fullName = formatContactFullName(row);
                  const companyForSearch =
                    sanitizeCompanyName(row.resolvedCompany) ||
                    sanitizeUnknown(row.rawCompany);
                  const searchLinkedInUrl = `https://www.google.com/search?q=${encodeURIComponent(
                    `"${fullName}" "${companyForSearch}" LinkedIn`,
                  )}`;
                  return (
                    <tr key={row.id} className={rowShellClass(row, ri)}>
                      <td className="px-2 py-1.5 align-middle">
                        <div className="flex items-center justify-center">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-zinc-300"
                            checked={checked}
                            onChange={(e) => toggleApprove(row.id, e.target.checked)}
                            aria-label="Approve row"
                          />
                        </div>
                      </td>
                      <td className="max-w-48 px-2 py-1.5 align-middle wrap-break-word">
                        <EditableCell
                          value={fullName}
                          edited={editedKeys.has(rowKey(row.id, "name"))}
                          muted={muted}
                          pencilOnHover
                          onSave={(v) => {
                            markEdited(row.id, "name");
                            const clean = sanitizeUnknown(v);
                            const parts = clean.split(/\s+/).filter(Boolean);
                            const firstName = sanitizeUnknown(parts[0] ?? "");
                            const lastName = sanitizeUnknown(parts.slice(1).join(" "));
                            setRows(
                              (rows as EnrichedContact[]).map((r) =>
                                r.id === row.id ? { ...r, firstName, lastName } : r,
                              ),
                            );
                          }}
                        />
                      </td>
                      <td className="min-w-0 max-w-48 break-all px-2 py-1.5 align-middle">
                        <EditableCell
                          value={sanitizeUnknown(row.rawEmail)}
                          edited={editedKeys.has(rowKey(row.id, "rawEmail"))}
                          muted={muted}
                          breakAll
                          pencilOnHover
                          onSave={(v) => {
                            markEdited(row.id, "rawEmail");
                            const next = sanitizeUnknown(v);
                            setRows(
                              (rows as EnrichedContact[]).map((r) =>
                                r.id === row.id ? { ...r, rawEmail: next, resolvedEmail: next } : r,
                              ),
                            );
                          }}
                        />
                      </td>
                      <td className="max-w-48 px-2 py-1.5 align-middle wrap-break-word">
                        <EditableCell
                          value={sanitizeCompanyName(row.resolvedCompany)}
                          edited={editedKeys.has(rowKey(row.id, "resolvedCompany"))}
                          muted={muted}
                          pencilOnHover
                          onSave={(v) => {
                            markEdited(row.id, "resolvedCompany");
                            const next = sanitizeCompanyName(v);
                            setRows(
                              (rows as EnrichedContact[]).map((r) =>
                                r.id === row.id ? { ...r, resolvedCompany: next } : r,
                              ),
                            );
                          }}
                        />
                      </td>
                      <td className="max-w-48 px-2 py-1.5 align-middle wrap-break-word">
                        <EditableCell
                          value={sanitizeUnknown(row.title)}
                          edited={editedKeys.has(rowKey(row.id, "title"))}
                          muted={muted}
                          pencilOnHover
                          onSave={(v) => {
                            markEdited(row.id, "title");
                            const next = sanitizeUnknown(v);
                            setRows(
                              (rows as EnrichedContact[]).map((r) =>
                                r.id === row.id ? { ...r, title: next } : r,
                              ),
                            );
                          }}
                        />
                      </td>
                      <td className="min-w-[180px] max-w-[220px] px-2 py-1.5 align-middle break-all whitespace-normal">
                        <LinkedInProfileCell
                          value={sanitizeUnknown(row.linkedinUrl)}
                          edited={editedKeys.has(rowKey(row.id, "linkedinUrl"))}
                          muted={muted}
                          breakAll
                          missingSearchUrl={searchLinkedInUrl}
                          onSave={(v) => {
                            markEdited(row.id, "linkedinUrl");
                            const next = sanitizeUnknown(v);
                            setRows(
                              (rows as EnrichedContact[]).map((r) =>
                                r.id === row.id ? { ...r, linkedinUrl: next } : r,
                              ),
                            );
                          }}
                        />
                      </td>
                      <td className="min-w-[120px] px-2 py-1.5 align-middle">
                        <div className="flex flex-nowrap items-center gap-1.5">
                          <ConfidenceBadge score={getDisplayConfidence(row, "contacts")} />
                          {row.hubspotId ? (
                            <HubSpotPrecheckBadge complete={row.hubspotComplete === true} />
                          ) : null}
                        </div>
                      </td>
                      <td className="max-w-56 px-2 py-1.5 align-middle wrap-break-word">
                        <div className="flex items-center justify-center">
                          <ReasoningTooltip text={row.aiReasoning} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
          </tbody>
        </table>
      </div>

      <div className="pointer-events-none fixed bottom-0 left-0 right-0 z-50 flex justify-center border-t border-(--border-default) bg-(--bg-card) px-6 py-4">
        <div className="pointer-events-auto flex w-full max-w-7xl items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm text-(--text-muted)">
              {approvedCount} {approvedCount === 1 ? "record" : "records"} selected
            </p>
            {unresolvedApprovedCount > 0 ? (
              <p className="mt-1 text-xs text-(--color-warning)">
                ⚠️ {unresolvedApprovedCount} unresolved record
                {unresolvedApprovedCount === 1 ? "" : "s"} selected — make sure you review before
                pushing
              </p>
            ) : null}
          </div>
          <button
            type="button"
            disabled={approvedCount === 0}
            onClick={() => onApprove?.()}
            className={`shrink-0 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
              approvedCount > 0
                ? "bg-(--realm-purple) text-white hover:bg-(--realm-purple-hover)"
                : "cursor-not-allowed bg-(--bg-muted) text-(--text-muted)"
            }`}
          >
            Approve {approvedCount} Records →
          </button>
        </div>
      </div>
    </div>
  );
}

/** Apply default review statuses from enrichment confidence scores. */
export function applyInitialReviewStatus(
  rows: EnrichedCompany[] | EnrichedContact[],
): EnrichedCompany[] | EnrichedContact[] {
  return rows.map((r) => {
    if ("rawInput" in r) {
      const c = r as EnrichedCompany;
      const base = sanitizeCompany(c);
      return {
        ...base,
        status: initialCompanyReviewStatus(base),
        state: expandStateAbbreviation(base.state),
      };
    }
    const c = r as EnrichedContact;
    const ingested = sanitizeContact(c);
    const rawEmail = sanitizeUnknown(ingested.rawEmail);
    const resolvedEmail = sanitizeUnknown(ingested.resolvedEmail) || rawEmail;
    const merged: EnrichedContact = {
      ...ingested,
      firstName: sanitizeUnknown(ingested.firstName),
      lastName: sanitizeUnknown(ingested.lastName),
      rawEmail,
      resolvedEmail,
      resolvedCompany: sanitizeCompanyName(ingested.resolvedCompany),
      title: sanitizeUnknown(ingested.title),
      linkedinUrl: sanitizeUnknown(ingested.linkedinUrl),
      location: expandStateAbbreviation(sanitizeUnknown(ingested.location)),
    };
    return {
      ...merged,
      status: initialContactReviewStatus(merged),
    };
  }) as EnrichedCompany[] | EnrichedContact[];
}
