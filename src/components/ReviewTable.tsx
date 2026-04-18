"use client";

import { ConfidenceBadge } from "@/components/ConfidenceBadge";
import { ReasoningTooltip } from "@/components/ReasoningTooltip";
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

function initialStatus(
  confidence: EnrichedCompany["confidenceScore"],
): EnrichedCompany["status"] {
  if (confidence === "high") return "approved";
  if (confidence === "unresolved") return "skipped";
  return "pending";
}

function rowKey(id: string, field: string): string {
  return `${id}:${field}`;
}

function EditableCell(props: {
  value: string;
  edited: boolean;
  muted?: boolean;
  align?: "left" | "right";
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  breakAll?: boolean;
  onSave: (next: string) => void;
}) {
  const { value, edited, muted, align = "left", inputMode, breakAll, onSave } = props;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (!editing) setDraft(value);
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
              setDraft(value);
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

  return (
    <button
      type="button"
      className={`relative w-full max-w-50 rounded px-1.5 py-0.5 text-left text-xs sm:text-sm ${wrap} ${
        align === "right" ? "text-right tabular-nums" : ""
      } ${muted ? "text-zinc-500" : "text-zinc-900 dark:text-zinc-100"} hover:bg-zinc-100/80 dark:hover:bg-zinc-800/80`}
      onClick={() => setEditing(true)}
    >
      {value}
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
  const [editing, setEditing] = useState(false);

  const options = useMemo(() => {
    const o = [...STATE_REGION_OPTIONS];
    if (value && !o.includes(value)) {
      return [value, ...o];
    }
    return o;
  }, [value]);

  const selectValue = options.includes(value) || value === "" ? value : value;

  if (editing) {
    return (
      <div className="relative min-w-40 max-w-56">
        <select
          className="w-full rounded border border-blue-500 bg-white px-1 py-0.5 text-xs outline-none ring-1 ring-blue-500/30 dark:bg-zinc-950 sm:text-sm"
          autoFocus
          value={selectValue}
          onChange={(e) => {
            const next = e.target.value;
            onSave(next);
            setEditing(false);
          }}
          onBlur={(e) => {
            onSave(e.target.value);
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
      className={`relative max-w-56 rounded px-1.5 py-0.5 text-left text-xs wrap-break-word sm:text-sm ${
        muted ? "text-zinc-500" : "text-zinc-900 dark:text-zinc-100"
      } hover:bg-zinc-100/80 dark:hover:bg-zinc-800/80`}
      onClick={() => setEditing(true)}
    >
      {value}
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
          type="text"
          inputMode="numeric"
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

  return (
    <button
      type="button"
      className={`relative w-full rounded px-1.5 py-0.5 text-right text-xs tabular-nums sm:text-sm ${
        muted ? "text-zinc-500" : "text-zinc-900 dark:text-zinc-100"
      } hover:bg-zinc-100/80 dark:hover:bg-zinc-800/80`}
      onClick={() => setEditing(true)}
    >
      {value === null || Number.isNaN(value) ? "" : value}
      {edited ? (
        <span
          className="pointer-events-none absolute right-0 top-0 h-1.5 w-1.5 rounded-full bg-blue-500"
          aria-hidden
        />
      ) : null}
    </button>
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
        const oa = CONFIDENCE_ORDER[a.confidenceScore] ?? 99;
        const ob = CONFIDENCE_ORDER[b.confidenceScore] ?? 99;
        if (oa !== ob) return oa - ob;
        return (a.resolvedName || "").localeCompare(b.resolvedName || "", undefined, {
          sensitivity: "base",
        });
      });
    }
    return [...(rows as EnrichedContact[])].sort((a, b) => {
      const oa = CONFIDENCE_ORDER[a.confidenceScore] ?? 99;
      const ob = CONFIDENCE_ORDER[b.confidenceScore] ?? 99;
      if (oa !== ob) return oa - ob;
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
      rows.filter((r) => r.status === "approved" && r.confidenceScore === "unresolved")
        .length,
    [rows],
  );

  const rowShellClass = (r: EnrichedCompany | EnrichedContact, rowIndex: number) => {
    const conf = r.confidenceScore;
    let borderClass = "border-l-transparent";
    if (conf === "unresolved") {
      borderClass = "border-l-(--conf-unresolved)";
    } else if (conf === "low") {
      borderClass = "border-l-(--conf-low)";
    } else if (conf === "medium") {
      borderClass = "border-l-(--conf-medium)";
    }

    const base = `border-b border-(--border-default) border-l-4 ${borderClass}`;

    if (r.status === "approved") {
      return `${base} bg-(--conf-high-bg)`;
    }
    if (r.status === "skipped") {
      return `${base} bg-(--bg-muted) opacity-70`;
    }
    const stripe = rowIndex % 2 === 0 ? "bg-(--bg-card)" : "bg-(--bg-page)";
    return `${base} ${stripe}`;
  };

  return (
    <div className="flex flex-col gap-4 pb-24">
      <h2 className="text-lg font-semibold text-(--realm-navy)">Review &amp; Edit</h2>

      <p className="text-sm text-(--text-muted) bg-(--bg-muted) rounded-lg px-4 py-2">
        ℹ️ ZoomInfo verification: pending API access · 0 credits estimated for this import
      </p>

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
          <select
            id="rt-filter"
            className="rounded-lg border border-(--border-default) bg-(--bg-card) px-2 py-1 text-xs text-(--text-primary)"
            value={filter}
            onChange={(e) => setFilter(e.target.value as FilterKey)}
          >
            <option value="all">All</option>
            <option value="needs_review">Needs Review</option>
            <option value="approved">Approved</option>
            <option value="skipped">Skipped</option>
          </select>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-(--border-default)">
        <table className="min-w-full border-collapse text-left text-xs sm:text-sm">
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
                <th className="border-b border-(--border-default) px-2 py-2">Confidence</th>
                <th className="border-b border-(--border-default) px-2 py-2">Reasoning</th>
              </tr>
            ) : (
              <tr>
                <th className="border-b border-(--border-default) px-2 py-2">Approve</th>
                <th className="border-b border-(--border-default) px-2 py-2">Name</th>
                <th className="border-b border-(--border-default) px-2 py-2">Raw Email</th>
                <th className="border-b border-(--border-default) px-2 py-2">Resolved Email</th>
                <th className="border-b border-(--border-default) px-2 py-2">Company</th>
                <th className="border-b border-(--border-default) px-2 py-2">Title</th>
                <th className="border-b border-(--border-default) px-2 py-2">State / Region</th>
                <th className="border-b border-(--border-default) px-2 py-2">
                  LinkedIn Profile
                </th>
                <th className="border-b border-(--border-default) px-2 py-2">Confidence</th>
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
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-zinc-300"
                          checked={checked}
                          onChange={(e) => toggleApprove(row.id, e.target.checked)}
                          aria-label="Approve row"
                        />
                      </td>
                      <td className={`max-w-48 px-2 py-1.5 align-top wrap-break-word ${muted ? "text-zinc-500" : ""}`}>
                        {row.rawInput}
                      </td>
                      <td className="max-w-48 px-2 py-1.5 align-top wrap-break-word">
                        <EditableCell
                          value={row.resolvedName}
                          edited={editedKeys.has(rowKey(row.id, "resolvedName"))}
                          muted={muted}
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
                      <td className="max-w-48 px-2 py-1.5 align-top wrap-break-word">
                        <EditableCell
                          value={row.domain}
                          edited={editedKeys.has(rowKey(row.id, "domain"))}
                          muted={muted}
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
                      <td className="max-w-56 px-2 py-1.5 align-top">
                        <StateRegionCell
                          value={row.state}
                          edited={editedKeys.has(rowKey(row.id, "state"))}
                          muted={muted}
                          onSave={(v) => {
                            markEdited(row.id, "state");
                            const full = expandStateAbbreviation(v);
                            setRows(
                              (rows as EnrichedCompany[]).map((r) =>
                                r.id === row.id ? { ...r, state: full } : r,
                              ),
                            );
                          }}
                        />
                      </td>
                      <td className="px-2 py-1.5 align-top">
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
                      <td className="min-w-[180px] max-w-[220px] px-2 py-1.5 align-top break-all whitespace-normal">
                        <div className="flex flex-wrap items-start gap-1">
                          <EditableCell
                            value={row.linkedinUrl}
                            edited={editedKeys.has(rowKey(row.id, "linkedinUrl"))}
                            muted={muted}
                            breakAll
                            onSave={(v) => {
                              markEdited(row.id, "linkedinUrl");
                              setRows(
                                (rows as EnrichedCompany[]).map((r) =>
                                  r.id === row.id ? { ...r, linkedinUrl: v.trim() } : r,
                                ),
                              );
                            }}
                          />
                          {row.linkedinUrl.trim() ? (
                            <a
                              href={
                                row.linkedinUrl.startsWith("http")
                                  ? row.linkedinUrl
                                  : `https://${row.linkedinUrl}`
                              }
                              target="_blank"
                              rel="noopener noreferrer"
                              title={
                                row.linkedinUrl.startsWith("http")
                                  ? row.linkedinUrl
                                  : `https://${row.linkedinUrl}`
                              }
                              className="inline-flex max-w-48 shrink-0 truncate text-blue-600 hover:text-blue-800 dark:text-blue-400"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <span className="truncate">Open profile</span>
                              <span aria-hidden className="ml-0.5 text-base leading-none">
                                ↗
                              </span>
                            </a>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-2 py-1.5 align-middle">
                        <ConfidenceBadge score={row.confidenceScore} />
                      </td>
                      <td className="max-w-56 px-2 py-1.5 align-middle wrap-break-word">
                        <ReasoningTooltip text={row.aiReasoning} />
                      </td>
                    </tr>
                  );
                })
              : (visibleRows as EnrichedContact[]).map((row, ri) => {
                  const muted = row.status === "skipped";
                  const checked = row.status === "approved";
                  const fullName = [row.firstName, row.lastName].filter(Boolean).join(" ");
                  return (
                    <tr key={row.id} className={rowShellClass(row, ri)}>
                      <td className="px-2 py-1.5 align-middle">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-zinc-300"
                          checked={checked}
                          onChange={(e) => toggleApprove(row.id, e.target.checked)}
                          aria-label="Approve row"
                        />
                      </td>
                      <td className="max-w-48 px-2 py-1.5 align-top wrap-break-word">
                        <EditableCell
                          value={fullName}
                          edited={editedKeys.has(rowKey(row.id, "name"))}
                          muted={muted}
                          onSave={(v) => {
                            markEdited(row.id, "name");
                            const parts = v.trim().split(/\s+/);
                            const firstName = parts[0] ?? "";
                            const lastName = parts.slice(1).join(" ");
                            setRows(
                              (rows as EnrichedContact[]).map((r) =>
                                r.id === row.id ? { ...r, firstName, lastName } : r,
                              ),
                            );
                          }}
                        />
                      </td>
                      <td className={`max-w-48 break-all px-2 py-1.5 align-top ${muted ? "text-zinc-500" : ""}`}>
                        {row.rawEmail}
                      </td>
                      <td className="max-w-48 px-2 py-1.5 align-top wrap-break-word">
                        <EditableCell
                          value={row.resolvedEmail}
                          edited={editedKeys.has(rowKey(row.id, "resolvedEmail"))}
                          muted={muted}
                          onSave={(v) => {
                            markEdited(row.id, "resolvedEmail");
                            setRows(
                              (rows as EnrichedContact[]).map((r) =>
                                r.id === row.id ? { ...r, resolvedEmail: v.trim() } : r,
                              ),
                            );
                          }}
                        />
                      </td>
                      <td className="max-w-48 px-2 py-1.5 align-top wrap-break-word">
                        <EditableCell
                          value={row.resolvedCompany}
                          edited={editedKeys.has(rowKey(row.id, "resolvedCompany"))}
                          muted={muted}
                          onSave={(v) => {
                            markEdited(row.id, "resolvedCompany");
                            setRows(
                              (rows as EnrichedContact[]).map((r) =>
                                r.id === row.id ? { ...r, resolvedCompany: v } : r,
                              ),
                            );
                          }}
                        />
                      </td>
                      <td className="max-w-48 px-2 py-1.5 align-top wrap-break-word">
                        <EditableCell
                          value={row.title}
                          edited={editedKeys.has(rowKey(row.id, "title"))}
                          muted={muted}
                          onSave={(v) => {
                            markEdited(row.id, "title");
                            setRows(
                              (rows as EnrichedContact[]).map((r) =>
                                r.id === row.id ? { ...r, title: v } : r,
                              ),
                            );
                          }}
                        />
                      </td>
                      <td className="max-w-56 px-2 py-1.5 align-top">
                        <StateRegionCell
                          value={row.location}
                          edited={editedKeys.has(rowKey(row.id, "location"))}
                          muted={muted}
                          onSave={(v) => {
                            markEdited(row.id, "location");
                            const full = expandStateAbbreviation(v);
                            setRows(
                              (rows as EnrichedContact[]).map((r) =>
                                r.id === row.id ? { ...r, location: full } : r,
                              ),
                            );
                          }}
                        />
                      </td>
                      <td className="min-w-[180px] max-w-[220px] px-2 py-1.5 align-top break-all whitespace-normal">
                        <div className="flex flex-wrap items-start gap-1">
                          <EditableCell
                            value={row.linkedinUrl}
                            edited={editedKeys.has(rowKey(row.id, "linkedinUrl"))}
                            muted={muted}
                            breakAll
                            onSave={(v) => {
                              markEdited(row.id, "linkedinUrl");
                              setRows(
                                (rows as EnrichedContact[]).map((r) =>
                                  r.id === row.id ? { ...r, linkedinUrl: v.trim() } : r,
                                ),
                              );
                            }}
                          />
                          {row.linkedinUrl.trim() ? (
                            <a
                              href={
                                row.linkedinUrl.startsWith("http")
                                  ? row.linkedinUrl
                                  : `https://${row.linkedinUrl}`
                              }
                              target="_blank"
                              rel="noopener noreferrer"
                              title={
                                row.linkedinUrl.startsWith("http")
                                  ? row.linkedinUrl
                                  : `https://${row.linkedinUrl}`
                              }
                              className="inline-flex max-w-48 shrink-0 truncate text-blue-600 hover:text-blue-800 dark:text-blue-400"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <span className="truncate">Open profile</span>
                              <span aria-hidden className="ml-0.5 text-base leading-none">
                                ↗
                              </span>
                            </a>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-2 py-1.5 align-middle">
                        <ConfidenceBadge score={row.confidenceScore} />
                      </td>
                      <td className="max-w-56 px-2 py-1.5 align-middle wrap-break-word">
                        <ReasoningTooltip text={row.aiReasoning} />
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
                {unresolvedApprovedCount === 1 ? "" : "s"} included — consider reviewing before
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
    const status = initialStatus(r.confidenceScore);
    if ("rawInput" in r) {
      const c = r as EnrichedCompany;
      return {
        ...c,
        status,
        state: expandStateAbbreviation(c.state),
      };
    }
    const c = r as EnrichedContact;
    return {
      ...c,
      status,
      location: expandStateAbbreviation(c.location),
    };
  }) as EnrichedCompany[] | EnrichedContact[];
}
