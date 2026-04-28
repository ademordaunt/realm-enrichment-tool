"use client";

import { ConfidenceBadge } from "@/components/ConfidenceBadge";
import { ReasoningTooltip } from "@/components/ReasoningTooltip";
import { classifyContactEmailDomain } from "@/lib/utils/contacts";
import {
  sanitizeCompany,
  sanitizeCompanyName,
  sanitizeContact,
  sanitizeState,
  sanitizeUnknown,
} from "@/lib/utils/sanitize";
import { expandStateAbbreviation, STATE_REGION_OPTIONS } from "@/lib/utils/states";
import type {
  EnrichedCompany,
  EnrichedContact,
  ExclusionReason,
  LinkedInSource,
} from "@/lib/utils/types";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

export interface ReviewTableProps {
  rows: EnrichedCompany[] | EnrichedContact[];
  listType: "companies" | "contacts";
  onRowsChange: (rows: EnrichedCompany[] | EnrichedContact[]) => void;
  /** Called when the user clicks the sticky “Approve” action (does not call HubSpot). */
  onApprove?: () => void;
}

function identityLabel(ic: string): string {
  const u = ic.charAt(0).toUpperCase() + ic.slice(1);
  return u === "Unresolved" ? "Unresolved" : u;
}

function linkedinSourceLegendLabel(s: LinkedInSource | undefined): string {
  switch (s) {
    case "hubspot":
      return "HubSpot ✓";
    case "zoominfo":
      return "ZoomInfo ✓";
    case "commonroom":
      return "Common Room ✓";
    case "ai_search":
      return "Web search ⚠️";
    case "manual":
      return "Manual edit";
    default:
      return "Unknown";
  }
}

function exclusionReasonBadgeLabel(reason: ExclusionReason | undefined): string {
  switch (reason) {
    case "international":
      return "International";
    case "government":
      return "Government";
    case "low_confidence":
      return "Low confidence";
    case "unresolved":
      return "Unresolved";
    case "personal_email":
      return "Personal email";
    case "missing_required_fields":
      return "Incomplete";
    case "duplicate":
      return "Duplicate";
    case "incomplete":
      return "Incomplete";
    default:
      return "";
  }
}

function dataSourceLine(row: EnrichedCompany | EnrichedContact): string {
  const parts: string[] = [];
  if (row.hubspotId) parts.push("HubSpot ✓");
  if (row.enrichedByZoomInfo) parts.push("ZoomInfo ✓");
  if (parts.length === 0) return "AI only";
  return parts.join(" / ");
}

function buildReasoningTooltipContent(
  row: EnrichedCompany | EnrichedContact,
  listType: "companies" | "contacts",
): ReactNode {
  const identity = row.identityConfidence ?? row.confidenceScore;
  const confidenceText = `${identityLabel(identity)} confidence`;
  const bucket = row.reviewBucket ?? "needs_review";
  const linkedInValue = row.linkedinUrl?.trim() ?? "";
  const linkedInLabel = linkedInValue ? linkedinSourceLegendLabel(row.linkedinSource) : "Not found ⚠️";
  const identitySource = row.hubspotId ? "HubSpot ✓" : row.enrichedByZoomInfo ? "ZoomInfo ✓" : "Unknown";
  const otherData = dataSourceLine(row);

  const company = listType === "companies" ? (row as EnrichedCompany) : null;
  const contact = listType === "contacts" ? (row as EnrichedContact) : null;
  const companyMissingDomain = Boolean(company && !company.domain?.trim());
  const contactMissingCompany = Boolean(contact && !sanitizeCompanyName(contact.resolvedCompany));

  const displayName =
    listType === "companies"
      ? sanitizeUnknown(company?.resolvedName || company?.rawInput) || "Record"
      : formatContactFullName(contact as EnrichedContact) || "Record";

  const identityTarget =
    listType === "companies"
      ? company?.domain?.trim() || "—"
      : sanitizeCompanyName(contact?.resolvedCompany) || "—";
  const identityLine =
    identity === "high"
      ? `Verified as ${displayName} (${identityTarget})`
      : `Identified as ${displayName} (${identityTarget}) — ${confidenceText}`;

  const sourceBlock = (
    <div>
      <p className="font-semibold">Sources:</p>
      <p>Identity    {identitySource}</p>
      <p>LinkedIn    {linkedInLabel}</p>
      <p>Other data  {otherData}</p>
    </div>
  );

  const missingLines: string[] = [];
  if (contactMissingCompany) missingLines.push("⚠️ Company name — search LinkedIn or Google");
  if (companyMissingDomain) missingLines.push("⚠️ Domain — needed for HubSpot matching");

  const needsReviewLines: string[] = [];
  if (row.linkedinSource === "ai_search") {
    needsReviewLines.push("⚠️ LinkedIn — came from web search, verify before trusting");
  }
  if (!row.hubspotId && !row.enrichedByZoomInfo) {
    needsReviewLines.push("⚠️ Not verified by HubSpot or ZoomInfo");
  }

  const excludedLines: string[] = [];
  if (row.exclusionReason === "personal_email" && contact) {
    const email = (contact.resolvedEmail ?? "").trim();
    const domain = email.includes("@") ? email.split("@")[1]?.toLowerCase() ?? "" : "";
    const kind = classifyContactEmailDomain(email);
    excludedLines.push(
      kind === "ISP"
        ? `⚠️ Personal email — flagged as ISP address, ${domain || "unknown domain"}`
        : `⚠️ Personal email — flagged as personal address, ${domain || "unknown domain"}`,
    );
  }
  if (row.exclusionReason === "international") {
    excludedLines.push("⚠️ International company — outside ICP");
  }
  if (row.exclusionReason === "government") {
    excludedLines.push("⚠️ Government entity — outside ICP");
  }
  if (row.exclusionReason === "low_confidence") {
    excludedLines.push("⚠️ Low confidence");
  }
  if (row.exclusionReason === "unresolved") {
    excludedLines.push("⚠️ Unresolved — AI could not identify this record");
  }
  if (row.exclusionReason === "missing_required_fields") {
    const missing: string[] = [];
    if (contact) {
      if (!sanitizeCompanyName(contact.resolvedCompany)) missing.push("company");
      if (!sanitizeUnknown(contact.title)) missing.push("title");
      if (!sanitizeUnknown(contact.linkedinUrl)) missing.push("LinkedIn profile");
    } else if (company) {
      if (!sanitizeUnknown(company.resolvedName)) missing.push("company name");
      if (!sanitizeUnknown(company.domain)) missing.push("domain");
    }
    excludedLines.push(`⚠️ Missing required fields — ${missing.join(", ") || "required fields"}`);
  }
  if (row.linkedinSource === "ai_search") {
    excludedLines.push("⚠️ LinkedIn — came from web search, verify before trusting");
  }

  if (bucket === "excluded") {
    return (
      <div className="space-y-2">
        <p className="font-semibold">✗ {displayName} — Excluded</p>
        <p>{identityLine}</p>
        {excludedLines.map((line, idx) => (
          <p key={idx}>{line}</p>
        ))}
        {sourceBlock}
      </div>
    );
  }

  if (bucket === "needs_review") {
    return (
      <div className="space-y-2">
        <p className="font-semibold">⚠️ {displayName} — Needs Review</p>
        <p>{identityLine}</p>
        {needsReviewLines.map((line, idx) => (
          <p key={idx}>{line}</p>
        ))}
        {sourceBlock}
      </div>
    );
  }

  if (missingLines.length > 0) {
    return (
      <div className="space-y-2">
        <p className="font-semibold">~ {displayName} — Trusted but missing data</p>
        <p>{identityLine}</p>
        {row.linkedinSource === "ai_search" && (
          <p>⚠️ LinkedIn came from web search — worth a quick check</p>
        )}
        {missingLines.map((line, idx) => (
          <p key={idx}>{line}</p>
        ))}
        {sourceBlock}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="font-semibold">✓ {displayName} — Trusted</p>
      <p>{identityLine}</p>
      {row.linkedinSource === "ai_search" && (
        <p>⚠️ LinkedIn came from web search — worth a quick check</p>
      )}
      {sourceBlock}
    </div>
  );
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

type FilterKey = "all" | "needs_review" | "trusted" | "excluded";

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
      c.numberOfEmployees == null ||
      !stateOk;
    if (missingCritical) return "unresolved";
    return c.identityConfidence ?? c.confidenceScore;
  }
  const c = row as EnrichedContact;
  const emailOk = sanitizeUnknown(c.rawEmail);
  const companyOk = sanitizeCompanyName(c.resolvedCompany);
  const missingCritical = !emailOk || !companyOk;
  if (missingCritical) return "unresolved";
  return c.identityConfidence ?? c.confidenceScore;
}

function initialCompanyReviewStatus(company: EnrichedCompany): EnrichedCompany["status"] {
  if (company.reviewBucket === "trusted") return "approved";
  if (company.reviewBucket === "needs_review") return "pending";
  return "skipped";
}

function initialContactReviewStatus(contact: EnrichedContact): EnrichedContact["status"] {
  if (contact.reviewBucket === "trusted") return "approved";
  if (contact.reviewBucket === "needs_review") return "pending";
  return "skipped";
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

function LinkedInSourceDot(props: { source: LinkedInSource }) {
  const { source } = props;
  if (!source) return null;
  const map: Record<string, { className: string; title: string }> = {
    hubspot: { className: "bg-violet-600", title: "From HubSpot" },
    zoominfo: { className: "bg-blue-600", title: "From ZoomInfo" },
    commonroom: { className: "bg-teal-600", title: "From Common Room" },
    ai_search: { className: "bg-amber-500", title: "From web search — verify" },
    manual: { className: "bg-zinc-800 dark:bg-black", title: "Manually edited" },
  };
  const cfg = map[source];
  if (!cfg) return null;
  return (
    <span
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${cfg.className}`}
      title={cfg.title}
      aria-label={cfg.title}
    />
  );
}

function LinkedInProfileCell(props: {
  value: string;
  edited: boolean;
  muted?: boolean;
  breakAll?: boolean;
  linkedinSource?: LinkedInSource;
  onSave: (next: string) => void;
}) {
  const { value, edited, muted, breakAll, linkedinSource, onSave } = props;
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
      {linkedinSource ? <LinkedInSourceDot source={linkedinSource} /> : null}
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
  const [stableRowOrder, setStableRowOrder] = useState<string[]>([]);

  useEffect(() => {
    setEditedKeys(new Set());
  }, [rows, listType]);

  const rowsById = useMemo(() => {
    const m: Record<string, EnrichedCompany | EnrichedContact> = {};
    for (const r of rows) {
      m[r.id] = r;
    }
    return m;
  }, [rows]);

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

  useEffect(() => {
    if (rows.length === 0) {
      setStableRowOrder([]);
      return;
    }
    setStableRowOrder((prev) => {
      if (prev.length === 0) {
        return sortedRows.map((r) => r.id);
      }
      const rowIdSet = new Set(rows.map((r) => r.id));
      const stale = prev.some((id) => !rowIdSet.has(id));
      if (stale || prev.length !== rows.length) {
        return sortedRows.map((r) => r.id);
      }
      return prev;
    });
  }, [rows, sortedRows, listType]);

  const displayRows = useMemo(() => {
    if (stableRowOrder.length === 0) return sortedRows;
    const out: (EnrichedCompany | EnrichedContact)[] = [];
    for (const id of stableRowOrder) {
      const r = rowsById[id];
      if (r) out.push(r);
    }
    return out.length > 0 ? out : sortedRows;
  }, [stableRowOrder, rowsById, sortedRows]);

  const filteredByShowFilter = useMemo(() => {
    if (filter === "all") return displayRows;
    const list = displayRows.filter((r) => (r.reviewBucket ?? "needs_review") === filter);
    if (filter === "trusted") {
      return [...list].sort((a, b) => {
        const tier = (r: typeof a) => {
          if (!r.linkedinUrl?.trim()) return 0;
          if (r.linkedinSource === "ai_search") return 1;
          return 2;
        };
        return tier(a) - tier(b);
      });
    }
    return list;
  }, [displayRows, filter]);
  const filteredRowIds = useMemo(
    () => new Set(filteredByShowFilter.map((r) => r.id)),
    [filteredByShowFilter],
  );

  const selectAll = useCallback(() => {
    if (listType === "companies") {
      setRows(
        (rows as EnrichedCompany[]).map((r) =>
          filteredRowIds.has(r.id) && r.reviewBucket !== "excluded"
            ? { ...r, status: "approved" as const }
            : r,
        ),
      );
    } else {
      setRows(
        (rows as EnrichedContact[]).map((r) =>
          filteredRowIds.has(r.id) && r.reviewBucket !== "excluded"
            ? { ...r, status: "approved" as const }
            : r,
        ),
      );
    }
  }, [filteredRowIds, listType, rows, setRows]);

  const deselectAll = useCallback(() => {
    if (listType === "companies") {
      setRows(
        (rows as EnrichedCompany[]).map((r) =>
          filteredRowIds.has(r.id) ? { ...r, status: "skipped" as const } : r,
        ),
      );
    } else {
      setRows(
        (rows as EnrichedContact[]).map((r) =>
          filteredRowIds.has(r.id) ? { ...r, status: "skipped" as const } : r,
        ),
      );
    }
  }, [filteredRowIds, listType, rows, setRows]);

  const toggleApprove = useCallback(
    (id: string, checked: boolean) => {
      if (listType === "companies") {
        setRows(
          (rows as EnrichedCompany[]).map((r) =>
            r.id === id
              ? {
                  ...r,
                  status: checked
                    ? ("approved" as const)
                    : (r.reviewBucket === "needs_review" ? "pending" : "skipped"),
                }
              : r,
          ),
        );
      } else {
        setRows(
          (rows as EnrichedContact[]).map((r) =>
            r.id === id
              ? {
                  ...r,
                  status: checked
                    ? ("approved" as const)
                    : (r.reviewBucket === "needs_review" ? "pending" : "skipped"),
                }
              : r,
          ),
        );
      }
    },
    [listType, rows, setRows],
  );

  const needsRows = useMemo(
    () => filteredByShowFilter.filter((r) => (r.reviewBucket ?? "needs_review") === "needs_review"),
    [filteredByShowFilter],
  );
  const trustedRows = useMemo(
    () => filteredByShowFilter.filter((r) => r.reviewBucket === "trusted"),
    [filteredByShowFilter],
  );
  const excludedRows = useMemo(
    () => filteredByShowFilter.filter((r) => r.reviewBucket === "excluded"),
    [filteredByShowFilter],
  );

  const orderedReviewRows = useMemo(
    () => [...needsRows, ...trustedRows, ...excludedRows],
    [needsRows, trustedRows, excludedRows],
  );

  const { trustedCount, needsReviewCount, excludedCount } = useMemo(() => {
    let approved = 0;
    let pending = 0;
    let skipped = 0;
    for (const r of rows) {
      if (r.status === "approved") approved += 1;
      else if (r.status === "pending") pending += 1;
      else if (r.status === "skipped") skipped += 1;
    }
    return {
      trustedCount: approved,
      needsReviewCount: pending,
      excludedCount: skipped,
    };
  }, [rows]);

  const approvedCount = useMemo(
    () => rows.filter((r) => r.status === "approved").length,
    [rows],
  );

  const unresolvedApprovedCount = useMemo(
    () =>
      rows.filter(
        (r) => r.status === "approved" && getDisplayConfidence(r, listType) === "unresolved",
      ).length,
    [rows, listType],
  );

  const rowShellClass = (r: EnrichedCompany | EnrichedContact, rowIndex: number) => {
    const bucket = r.reviewBucket ?? "needs_review";
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
    if (bucket === "excluded" && r.status === "skipped") {
      return `${base} bg-zinc-100/80 text-zinc-600 opacity-90 dark:bg-zinc-900/50 dark:text-zinc-300`;
    }
    if (r.status === "skipped") {
      return `${base} bg-(--bg-muted) opacity-70`;
    }
    const stripe = rowIndex % 2 === 0 ? "bg-(--bg-card)" : "bg-(--bg-page)";
    return `${base} ${stripe}`;
  };

  const rowStickyBgClass = (r: EnrichedCompany | EnrichedContact, rowIndex: number) => {
    const bucket = r.reviewBucket ?? "needs_review";
    if (r.status === "approved") return "bg-(--conf-high-bg)";
    if (bucket === "excluded" && r.status === "skipped") {
      return "bg-zinc-100/90 dark:bg-zinc-900/55";
    }
    if (r.status === "skipped") return "bg-(--bg-muted) opacity-70";
    return rowIndex % 2 === 0 ? "bg-(--bg-card)" : "bg-(--bg-page)";
  };

  return (
    <div className="flex flex-col gap-4 pb-24">
      <h2 className="text-lg font-semibold text-(--realm-navy)">Review &amp; Edit</h2>

      <div className="flex flex-col gap-3 rounded-lg border border-(--border-default) bg-(--bg-card) p-4 shadow-(--shadow-card)">
        <div>
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
            ⚠️ Needs Review — {needsReviewCount} records
          </p>
          <p className="text-xs text-(--text-muted)">These records need a quick check before pushing</p>
        </div>
        <div>
          <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
            ✓ Trusted — {trustedCount} records
          </p>
          <p className="text-xs text-(--text-muted)">Verified by HubSpot or ZoomInfo</p>
        </div>
        <div>
          <p className="text-sm font-semibold text-zinc-600 dark:text-zinc-400">
            ✗ Excluded — {excludedCount} records
          </p>
          <p className="text-xs text-(--text-muted)">
            Not being pushed to HubSpot — check a row to override and include it
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
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
              <option value="trusted">Trusted</option>
              <option value="excluded">Excluded</option>
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

      <div className="min-w-0 overflow-x-auto rounded-lg border border-(--border-default)">
        <table className="min-w-full border-separate border-spacing-0 text-left text-xs sm:text-sm">
          <thead className="bg-(--bg-muted) text-(--text-secondary) text-sm font-semibold">
            {listType === "companies" ? (
              <tr>
                <th className="sticky left-0 z-20 w-16 min-w-16 max-w-16 border-b border-r border-(--border-default) bg-(--bg-muted) px-2 py-2 text-center shadow-[2px_0_6px_-2px_rgba(0,0,0,0.08)]">
                  ✓
                </th>
                <th className="sticky left-[64px] z-21 w-40 min-w-40 max-w-48 border-b border-r border-(--border-default) bg-(--bg-muted) px-2 py-2 shadow-[2px_0_6px_-2px_rgba(0,0,0,0.08)]">
                  Raw Input
                </th>
                <th className="border-b border-(--border-default) px-2 py-2">Company Name</th>
                <th className="border-b border-(--border-default) px-2 py-2">
                  Company Domain Name
                </th>
                <th className="border-b border-(--border-default) px-2 py-2">State / Region</th>
                <th className="border-b border-(--border-default) px-2 py-2">
                  Number Of Employees
                </th>
                <th className="border-b border-(--border-default) px-2 py-2">
                  <span className="inline-flex items-center gap-1">
                    LinkedIn Profile
                    <ReasoningTooltip
                      content={
                        <div className="space-y-1.5 text-xs font-normal">
                          <p>
                            <span className="inline-block h-2 w-2 rounded-full bg-violet-600" /> HubSpot — verified, your
                            source of truth
                          </p>
                          <p>
                            <span className="inline-block h-2 w-2 rounded-full bg-blue-600" /> ZoomInfo — verified third-party
                            data
                          </p>
                          <p>
                            <span className="inline-block h-2 w-2 rounded-full bg-teal-600" /> Common Room — verified
                            third-party data
                          </p>
                          <p>
                            <span className="inline-block h-2 w-2 rounded-full bg-amber-500" /> Web search — searched but
                            unverified, review recommended
                          </p>
                          <p>
                            <span className="inline-block h-2 w-2 rounded-full bg-zinc-800 dark:bg-black" /> Manual entry —
                            added by you during review
                          </p>
                        </div>
                      }
                      trigger={
                        <span className="ml-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-gray-400 text-[9px] text-gray-500 cursor-help">
                          ?
                        </span>
                      }
                      triggerAriaLabel="LinkedIn source legend"
                    />
                  </span>
                </th>
                <th className="min-w-[120px] border-b border-(--border-default) px-2 py-2">
                  Confidence
                </th>
                <th className="border-b border-(--border-default) px-2 py-2">Reasoning</th>
              </tr>
            ) : (
              <tr>
                <th className="sticky left-0 z-20 w-16 min-w-16 max-w-16 border-b border-r border-(--border-default) bg-(--bg-muted) px-2 py-2 text-center shadow-[2px_0_6px_-2px_rgba(0,0,0,0.08)]">
                  ✓
                </th>
                <th className="sticky left-[64px] z-21 w-40 min-w-40 max-w-48 border-b border-r border-(--border-default) bg-(--bg-muted) px-2 py-2 shadow-[2px_0_6px_-2px_rgba(0,0,0,0.08)]">
                  Name
                </th>
                <th className="border-b border-(--border-default) px-2 py-2">Email</th>
                <th className="border-b border-(--border-default) px-2 py-2">Company</th>
                <th className="border-b border-(--border-default) px-2 py-2">Title</th>
                <th className="border-b border-(--border-default) px-2 py-2">
                  <span className="inline-flex items-center gap-1">
                    LinkedIn Profile
                    <ReasoningTooltip
                      content={
                        <div className="space-y-1.5 text-xs font-normal">
                          <p>
                            <span className="inline-block h-2 w-2 rounded-full bg-violet-600" /> HubSpot — verified, your
                            source of truth
                          </p>
                          <p>
                            <span className="inline-block h-2 w-2 rounded-full bg-blue-600" /> ZoomInfo — verified third-party
                            data
                          </p>
                          <p>
                            <span className="inline-block h-2 w-2 rounded-full bg-teal-600" /> Common Room — verified
                            third-party data
                          </p>
                          <p>
                            <span className="inline-block h-2 w-2 rounded-full bg-amber-500" /> Web search — searched but
                            unverified, review recommended
                          </p>
                          <p>
                            <span className="inline-block h-2 w-2 rounded-full bg-zinc-800 dark:bg-black" /> Manual entry —
                            added by you during review
                          </p>
                        </div>
                      }
                      trigger={
                        <span className="ml-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-gray-400 text-[9px] text-gray-500 cursor-help">
                          ?
                        </span>
                      }
                      triggerAriaLabel="LinkedIn source legend"
                    />
                  </span>
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
              ? (orderedReviewRows as EnrichedCompany[]).map((row, ri) => {
                  const muted = row.status === "skipped";
                  const checked = row.status === "approved";
                  return (
                    <tr key={row.id} className={rowShellClass(row, ri)}>
                      <td
                        className={`sticky left-0 z-10 w-16 min-w-16 max-w-16 border-r border-(--border-default) px-2 py-1.5 align-middle shadow-[2px_0_6px_-2px_rgba(0,0,0,0.06)] ${rowStickyBgClass(row, ri)}`}
                      >
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
                        className={`sticky left-[64px] z-11 max-w-48 border-r border-(--border-default) px-2 py-1.5 align-middle wrap-break-word shadow-[2px_0_6px_-2px_rgba(0,0,0,0.06)] ${rowStickyBgClass(row, ri)} ${muted ? "text-zinc-500" : ""}`}
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
                          linkedinSource={row.linkedinSource}
                          onSave={(v) => {
                            markEdited(row.id, "linkedinUrl");
                            setRows(
                              (rows as EnrichedCompany[]).map((r) =>
                                r.id === row.id
                                  ? { ...r, linkedinUrl: v, linkedinSource: "manual" }
                                  : r,
                              ),
                            );
                          }}
                        />
                      </td>
                      <td className="min-w-[120px] px-2 py-1.5 align-middle">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <ConfidenceBadge score={getDisplayConfidence(row, "companies")} />
                          {row.hubspotId ? (
                            <HubSpotPrecheckBadge complete={row.hubspotComplete === true} />
                          ) : null}
                          {row.reviewBucket === "excluded" && row.exclusionReason ? (
                            <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-[0.65rem] font-medium text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">
                              {exclusionReasonBadgeLabel(row.exclusionReason)}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="max-w-56 px-2 py-1.5 align-middle wrap-break-word">
                        <div className="flex items-center justify-center">
                          <ReasoningTooltip
                            content={buildReasoningTooltipContent(row, "companies")}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })
              : (orderedReviewRows as EnrichedContact[]).map((row, ri) => {
                  const muted = row.status === "skipped";
                  const checked = row.status === "approved";
                  const fullName = formatContactFullName(row);
                  return (
                    <tr key={row.id} className={rowShellClass(row, ri)}>
                      <td
                        className={`sticky left-0 z-10 w-16 min-w-16 max-w-16 border-r border-(--border-default) px-2 py-1.5 align-middle shadow-[2px_0_6px_-2px_rgba(0,0,0,0.06)] ${rowStickyBgClass(row, ri)}`}
                      >
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
                        className={`sticky left-[64px] z-11 max-w-48 border-r border-(--border-default) px-2 py-1.5 align-middle wrap-break-word shadow-[2px_0_6px_-2px_rgba(0,0,0,0.06)] ${rowStickyBgClass(row, ri)}`}
                      >
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
                          linkedinSource={row.linkedinSource}
                          onSave={(v) => {
                            markEdited(row.id, "linkedinUrl");
                            const next = sanitizeUnknown(v);
                            setRows(
                              (rows as EnrichedContact[]).map((r) =>
                                r.id === row.id
                                  ? { ...r, linkedinUrl: next, linkedinSource: "manual" }
                                  : r,
                              ),
                            );
                          }}
                        />
                      </td>
                      <td className="min-w-[120px] px-2 py-1.5 align-middle">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <ConfidenceBadge score={getDisplayConfidence(row, "contacts")} />
                          {row.hubspotId ? (
                            <HubSpotPrecheckBadge complete={row.hubspotComplete === true} />
                          ) : null}
                          {row.reviewBucket === "excluded" && row.exclusionReason ? (
                            <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-[0.65rem] font-medium text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">
                              {exclusionReasonBadgeLabel(row.exclusionReason)}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="max-w-56 px-2 py-1.5 align-middle wrap-break-word">
                        <div className="flex items-center justify-center">
                          <ReasoningTooltip
                            content={buildReasoningTooltipContent(row, "contacts")}
                          />
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
