"use client";

import { ConfidenceBadge } from "@/components/ConfidenceBadge";
import { ReasoningTooltip } from "@/components/ReasoningTooltip";
import {
  COMPANY_FIELD_LABELS,
  CONTACT_FIELD_LABELS,
  UI_FIELD_LABELS,
} from "@/lib/utils/field-labels";
import {
  sanitizeCompanyName,
  sanitizeState,
  sanitizeUnknown,
} from "@/lib/utils/sanitize";
import { expandStateAbbreviation, STATE_REGION_OPTIONS } from "@/lib/utils/states";
export { applyInitialReviewStatus } from "@/lib/utils/review-status";
import type {
  EnrichedCompany,
  EnrichedContact,
  ExclusionReason,
  LinkedInSource,
} from "@/lib/utils/types";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** Inset ring on the `tr` while `flashRowId` matches (see `scheduleAfterRowEdit`). */
const ROW_FLASH_TR_CLASS =
  "ring-inset ring-1 ring-blue-400/35 motion-reduce:ring-blue-400/40";

const ROW_FLASH_CLEAR_MS = 1350;
const ROW_FLASH_CLEAR_MS_REDUCED = 450;

export interface ReviewTableProps {
  rows: EnrichedCompany[] | EnrichedContact[];
  listType: "companies" | "contacts";
  onRowsChange: (rows: EnrichedCompany[] | EnrichedContact[]) => void;
  /** Called when the user clicks the sticky “Approve” action (does not call HubSpot). */
  onApprove?: () => void;
}

function linkedInHeaderLegendContent(): ReactNode {
  return (
    <div className="space-y-1.5">
      <p className="border-b-[0.5px] border-(--border-default) pb-1.5 font-medium text-(--text-primary)">
        LinkedIn Source
      </p>
      <p className="flex items-center gap-1.5 font-normal text-(--text-secondary)">
        <span className="inline-block h-2 w-2 rounded-full bg-violet-600" aria-hidden />
        HubSpot verified
      </p>
      <p className="flex items-center gap-1.5 font-normal text-(--text-secondary)">
        <span className="inline-block h-2 w-2 rounded-full bg-blue-600" aria-hidden />
        ZoomInfo verified
      </p>
      <p className="flex items-center gap-1.5 font-normal text-(--text-secondary)">
        <span className="inline-block h-2 w-2 rounded-full bg-teal-600" aria-hidden />
        Common Room verified
      </p>
      <p className="flex items-center gap-1.5 font-normal text-(--text-secondary)">
        <span className="inline-block h-2 w-2 rounded-full bg-amber-500" aria-hidden />
        AI web search
      </p>
      <p className="flex items-center gap-1.5 font-normal text-(--text-secondary)">
        <span className="inline-block h-2 w-2 rounded-full bg-zinc-800 dark:bg-black" aria-hidden />
        Manually entered
      </p>
      <p className="pt-1 text-xs font-normal text-(--text-muted)">
        Web search note: amber rows should be spot-checked before push.
      </p>
    </div>
  );
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
    case "no_email":
      return "No email";
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

function buildReasoningTooltipContent(
  row: EnrichedCompany | EnrichedContact,
  listType: "companies" | "contacts",
): ReactNode {
  const bucket = row.reviewBucket ?? "needs_review";
  const entityLabel = listType === "companies" ? "company" : "contact";
  const company = listType === "companies" ? (row as EnrichedCompany) : null;
  const contact = listType === "contacts" ? (row as EnrichedContact) : null;
  const trustedSource = row.enrichedByZoomInfo && row.hubspotId
    ? "ZoomInfo and your CRM"
    : row.enrichedByZoomInfo
      ? "ZoomInfo"
      : row.hubspotId
        ? "your CRM"
        : "ZoomInfo";
  if (bucket === "trusted") {
    if (row.linkedinAmberFlag === true) {
      return "Data verified. LinkedIn was sourced from web search — click to confirm it's correct.";
    }
    return `Data verified by ${trustedSource}. No action needed.`;
  }

  if (bucket === "excluded") {
    if (row.exclusionReason === "international") {
      return `International ${entityLabel}. Click 'Include anyway' if they have significant US operations.`;
    }
    if (row.exclusionReason === "government") {
      return "Government or public institution. Excluded by default.";
    }
    return `Could not identify this ${entityLabel}: too little information to enrich reliably.`;
  }

  const companyDomainConflict = Boolean(
    company &&
      company.domainSource === "zoominfo_verified" &&
      company.domain?.trim() &&
      company.existingData?.domain?.trim() &&
      company.domain.trim().toLowerCase() !== company.existingData.domain.trim().toLowerCase(),
  );
  const contactEmailConflict = Boolean(
    contact &&
      contact.rawEmail?.trim() &&
      contact.existingData?.email?.trim() &&
      contact.rawEmail.trim().toLowerCase() !== contact.existingData.email.trim().toLowerCase(),
  );

  if (companyDomainConflict) {
    return "Domain conflict with your CRM. Verify this is the right company before pushing.";
  }
  if ((company && !company.domain?.trim()) || (contact && !contact.companyDomain?.trim())) {
    return "No domain found. Search for their website and enter it here.";
  }
  if (!row.enrichedByZoomInfo) {
    return "Not found in ZoomInfo. Review and fill in missing fields manually.";
  }
  if (contact && typeof contact.ziContactAccuracyScore === "number" && contact.ziContactAccuracyScore < 50) {
    return "ZoomInfo match confidence is low. Verify the data looks correct.";
  }
  if (contactEmailConflict) {
    return "Email differs from your CRM record. Confirm which is correct.";
  }
  if (!row.linkedinUrl?.trim()) {
    return "No LinkedIn found. Add it manually if you have it.";
  }
  if ((company && !company.state?.trim()) || (contact && !contact.location?.trim())) {
    return "No state/region found. Add it to ensure correct owner assignment.";
  }
  if (contact && !contact.title?.trim()) {
    return "No job title found. Add it manually if you have it.";
  }
  if (company && company.numberOfEmployees == null) {
    return "No employee count found. ZoomInfo may not have this company.";
  }
  return "Review this record and confirm the core fields before pushing.";
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
const APPROVE_ALL_STAGGER_MS = 20;

const CONTACT_REVIEW_NAME_HEADER = `${CONTACT_FIELD_LABELS.firstName} / ${CONTACT_FIELD_LABELS.lastName}`;

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
      onClick={() => {
        setDraft(normalized);
        setEditing(true);
      }}
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
          className="shrink-0 text-xs leading-none text-zinc-400 opacity-0 transition-opacity group-hover:opacity-100"
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
        className="shrink-0 text-xs leading-none text-zinc-400 opacity-0 transition-opacity group-hover:opacity-100"
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
      onClick={() => {
        setDraft(value === null ? "" : String(value));
        setEditing(true);
      }}
    >
      <span className="min-w-0 flex-1 text-right">
        {displayEmpty ? (
          <span className="text-zinc-400">—</span>
        ) : (
          value
        )}
      </span>
      <span
        className="shrink-0 text-xs leading-none text-zinc-400 opacity-0 transition-opacity group-hover:opacity-100"
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

function LinkedInSourceDot(props: {
  source: LinkedInSource;
  showAmberFlag?: boolean;
  amberTooltip?: string;
}) {
  const { source, showAmberFlag = false, amberTooltip } = props;
  if (!source) return null;
  const map: Record<string, { className: string; title: string }> = {
    hubspot: { className: "bg-violet-600", title: "From HubSpot" },
    zoominfo: { className: "bg-blue-600", title: "From ZoomInfo" },
    commonroom: { className: "bg-teal-600", title: "From Common Room" },
    ai_search: { className: "bg-amber-500", title: amberTooltip ?? "From web search — verify" },
    manual: { className: "bg-zinc-800 dark:bg-black", title: "Manually edited" },
  };
  if (source === "ai_search" && !showAmberFlag) return null;
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
  linkedinAmberFlag?: boolean;
  amberTooltip?: string;
  onSave: (next: string) => void;
}) {
  const { value, edited, muted, breakAll, linkedinSource, linkedinAmberFlag, amberTooltip, onSave } = props;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => (value == null ? "" : String(value)));

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
            setDraft(value == null ? "" : String(value));
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
      {linkedinSource ? (
        <LinkedInSourceDot
          source={linkedinSource}
          showAmberFlag={linkedinAmberFlag === true}
          amberTooltip={amberTooltip}
        />
      ) : null}
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        title={t}
        className="flex min-w-0 flex-1 items-center gap-0.5 truncate text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 sm:text-sm"
      >
        <span className="min-w-0 truncate">{t}</span>
        <span className="shrink-0 text-xs leading-none opacity-80" aria-hidden>
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
          setDraft(value == null ? "" : String(value));
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
  const [statusSortSnapshot, setStatusSortSnapshot] = useState<{
    listType: "companies" | "contacts";
    byId: Map<string, EnrichedCompany["status"]>;
  }>(
    () => ({
      listType,
      byId: new Map(rows.map((row) => [row.id, row.status])),
    }),
  );
  const [linkedInSortSnapshot, setLinkedInSortSnapshot] = useState<{
    listType: "companies" | "contacts";
    byId: Map<string, boolean>;
  }>(
    () => ({
      listType,
      byId: new Map(rows.map((row) => [row.id, Boolean(row.linkedinUrl?.trim())])),
    }),
  );
  const approveAllTimerIdsRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const [showScrollHint, setShowScrollHint] = useState(true);
  const handleTableScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    setShowScrollHint(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);
  const editSessionKey = useMemo(
    () => `${listType}:${rows.map((r) => r.id).join("|")}`,
    [listType, rows],
  );
  const getSessionFieldKey = useCallback(
    (id: string, field: string) => `${editSessionKey}|${rowKey(id, field)}`,
    [editSessionKey],
  );

  const markEdited = useCallback((id: string, field: string) => {
    setEditedKeys((prev) => {
      const next = new Set(prev);
      next.add(getSessionFieldKey(id, field));
      return next;
    });
  }, [getSessionFieldKey]);

  const [flashRowId, setFlashRowId] = useState<string | null>(null);
  const flashClearTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const afterEditRafOuterRef = useRef<number | null>(null);
  const afterEditRafInnerRef = useRef<number | null>(null);
  const afterEditTokenRef = useRef(0);

  const flashRow = useCallback((id: string) => {
    if (flashClearTimeoutRef.current != null) {
      clearTimeout(flashClearTimeoutRef.current);
      flashClearTimeoutRef.current = null;
    }
    setFlashRowId(id);
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ms = reduced ? ROW_FLASH_CLEAR_MS_REDUCED : ROW_FLASH_CLEAR_MS;
    flashClearTimeoutRef.current = setTimeout(() => {
      flashClearTimeoutRef.current = null;
      setFlashRowId((current) => (current === id ? null : current));
    }, ms);
  }, []);

  /**
   * Stable wrapper — impl lives in `useEffect` so eslint-plugin-react-hooks does not treat rAF
   * ref reads as happening during render (via inline save handlers).
   */
  const scheduleAfterEditImplRef = useRef<(id: string) => void>(() => {});
  function scheduleAfterRowEdit(id: string) {
    scheduleAfterEditImplRef.current(id);
  }

  useEffect(() => {
    const cancelPendingAfterRowEditRaf = () => {
      if (afterEditRafOuterRef.current != null) {
        cancelAnimationFrame(afterEditRafOuterRef.current);
        afterEditRafOuterRef.current = null;
      }
      if (afterEditRafInnerRef.current != null) {
        cancelAnimationFrame(afterEditRafInnerRef.current);
        afterEditRafInnerRef.current = null;
      }
    };

    scheduleAfterEditImplRef.current = (id: string) => {
      cancelPendingAfterRowEditRaf();
      afterEditTokenRef.current += 1;
      const scheduleToken = afterEditTokenRef.current;

      // Double rAF: defer until after React commit + paint so `<tr>` order matches sorted rows.
      afterEditRafOuterRef.current = requestAnimationFrame(() => {
        afterEditRafOuterRef.current = null;
        afterEditRafInnerRef.current = requestAnimationFrame(() => {
          afterEditRafInnerRef.current = null;
          if (scheduleToken !== afterEditTokenRef.current) return;
          const tr = document.querySelector<HTMLTableRowElement>(
            `tr[data-row-id="${CSS.escape(id)}"]`,
          );
          if (!tr) return;
          tr.scrollIntoView({ behavior: "auto", block: "nearest" });
          flashRow(id);
        });
      });
    };

    return () => {
      cancelPendingAfterRowEditRaf();
      scheduleAfterEditImplRef.current = () => {};
      if (flashClearTimeoutRef.current != null) {
        clearTimeout(flashClearTimeoutRef.current);
        flashClearTimeoutRef.current = null;
      }
    };
  }, [flashRow]);

  const setRows = useCallback(
    (next: EnrichedCompany[] | EnrichedContact[]) => {
      onRowsChange(next);
    },
    [onRowsChange],
  );

  const persistManualEdit = useCallback(
    (stableKey: string, field: string, value: unknown) => {
      const normalizedStableKey = stableKey.trim().toLowerCase();
      if (!normalizedStableKey) return;
      void fetch("/api/manual-edits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stableKey: normalizedStableKey,
          listType,
          field,
          value,
        }),
      }).catch(() => {});
    },
    [listType],
  );

  const includeInternationalAnyway = useCallback(
    (rowId: string) => {
      if (listType !== "companies") return;
      const current = rows as EnrichedCompany[];
      const target = current.find((r) => r.id === rowId);
      if (!target) return;
      setRows(
        current.map((r) =>
          r.id === rowId
            ? {
                ...r,
                reviewBucket: "needs_review" as const,
                exclusionReason: undefined,
                status: "pending" as const,
                manuallyIncluded: true,
              }
            : r,
        ),
      );
      const stableKey = target.domain?.trim().toLowerCase() ?? "";
      persistManualEdit(stableKey, "manuallyIncluded", true);
    },
    [listType, rows, persistManualEdit, setRows],
  );

  const statusSortSnapshotById = useMemo(
    () =>
      statusSortSnapshot.listType === listType
        ? statusSortSnapshot.byId
        : new Map(rows.map((row) => [row.id, row.status])),
    [listType, rows, statusSortSnapshot],
  );
  const linkedInSortSnapshotById = useMemo(
    () =>
      linkedInSortSnapshot.listType === listType
        ? linkedInSortSnapshot.byId
        : new Map(rows.map((row) => [row.id, Boolean(row.linkedinUrl?.trim())])),
    [listType, rows, linkedInSortSnapshot],
  );

  const sortedRows = useMemo(() => {
    const statusForSort = (row: EnrichedCompany | EnrichedContact) =>
      statusSortSnapshotById.get(row.id) ?? row.status;
    const sortTier = (row: EnrichedCompany | EnrichedContact) =>
      reviewSortTier({ ...row, status: statusForSort(row) }, listType);

    if (listType === "companies") {
      return [...(rows as EnrichedCompany[])].sort((a, b) => {
        const ta = sortTier(a);
        const tb = sortTier(b);
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
      const ta = sortTier(a);
      const tb = sortTier(b);
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
      const aMissingLinkedIn = !linkedInSortSnapshotById.get(a.id);
      const bMissingLinkedIn = !linkedInSortSnapshotById.get(b.id);
      if (aMissingLinkedIn !== bMissingLinkedIn) return aMissingLinkedIn ? -1 : 1;
      return (a.resolvedCompany || "").localeCompare(b.resolvedCompany || "", undefined, {
        sensitivity: "base",
      });
    });
  }, [rows, listType, statusSortSnapshotById, linkedInSortSnapshotById]);

  const isEdited = useCallback(
    (id: string, field: string) => editedKeys.has(getSessionFieldKey(id, field)),
    [editedKeys, getSessionFieldKey],
  );

  const displayRows = useMemo(() => sortedRows, [sortedRows]);

  const filteredByShowFilter = useMemo(() => {
    const trustedTier = (r: EnrichedCompany | EnrichedContact) =>
      r.trustedSortTier ?? (r.linkedinAmberFlag ? 1 : 2);
    const bucketRank = (r: EnrichedCompany | EnrichedContact) => {
      const b = r.reviewBucket ?? "needs_review";
      if (b === "needs_review") return 0;
      if (b === "trusted") return 1;
      return 2;
    };
    const displayIndexById = new Map(displayRows.map((r, idx) => [r.id, idx]));

    if (filter === "all") {
      return [...displayRows].sort((a, b) => {
        const aBucket = bucketRank(a);
        const bBucket = bucketRank(b);
        if (aBucket !== bBucket) return aBucket - bBucket;
        if ((a.reviewBucket ?? "needs_review") === "trusted" && (b.reviewBucket ?? "needs_review") === "trusted") {
          const aTier = trustedTier(a);
          const bTier = trustedTier(b);
          if (aTier !== bTier) return aTier - bTier;
        }
        return (displayIndexById.get(a.id) ?? 0) - (displayIndexById.get(b.id) ?? 0);
      });
    }

    const list = displayRows.filter((r) => (r.reviewBucket ?? "needs_review") === filter);
    if (filter === "trusted") {
      return [...list].sort((a, b) => {
        const aTier = trustedTier(a);
        const bTier = trustedTier(b);
        if (aTier !== bTier) return aTier - bTier;
        return (displayIndexById.get(a.id) ?? 0) - (displayIndexById.get(b.id) ?? 0);
      });
    }
    return list;
  }, [displayRows, filter]);
  const filteredRowIds = useMemo(
    () => new Set(filteredByShowFilter.map((r) => r.id)),
    [filteredByShowFilter],
  );

  const clearApproveAllTimers = useCallback(() => {
    for (const timerId of approveAllTimerIdsRef.current) {
      clearTimeout(timerId);
    }
    approveAllTimerIdsRef.current = [];
  }, []);

  const selectAll = useCallback(() => {
    const approvableIds = filteredByShowFilter
      .filter((r) => r.reviewBucket !== "excluded")
      .map((r) => r.id);
    if (approvableIds.length === 0) return;

    clearApproveAllTimers();

    const approvedIds = new Set<string>();
    const baseRows = rows;
    for (let i = 0; i < approvableIds.length; i++) {
      const rowId = approvableIds[i]!;
      const timerId = setTimeout(() => {
        approvedIds.add(rowId);
        if (listType === "companies") {
          setRows(
            (baseRows as EnrichedCompany[]).map((r) =>
              approvedIds.has(r.id) ? { ...r, status: "approved" as const } : r,
            ),
          );
        } else {
          setRows(
            (baseRows as EnrichedContact[]).map((r) =>
              approvedIds.has(r.id) ? { ...r, status: "approved" as const } : r,
            ),
          );
        }
      }, i * APPROVE_ALL_STAGGER_MS);
      approveAllTimerIdsRef.current.push(timerId);
    }
  }, [filteredByShowFilter, clearApproveAllTimers, listType, rows, setRows]);

  const deselectAll = useCallback(() => {
    clearApproveAllTimers();
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
  }, [clearApproveAllTimers, filteredRowIds, listType, rows, setRows]);

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

  useEffect(() => () => clearApproveAllTimers(), [clearApproveAllTimers]);

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
      return `${base} bg-zinc-100/80 dark:bg-zinc-900/50`;
    }
    if (r.status === "skipped") {
      return `${base} bg-(--bg-muted)`;
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
    if (r.status === "skipped") return "bg-(--bg-muted)";
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
          <p className="text-xs text-(--text-muted)">These records need a check before pushing.</p>
        </div>
        <div>
          <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
            ✓ Trusted — {trustedCount} records
          </p>
          <p className="text-xs text-(--text-muted)">Verified and ready to push — no action needed.</p>
        </div>
        <div>
          <p className="text-sm font-semibold text-zinc-600 dark:text-zinc-400">
            ✗ Excluded — {excludedCount} records
          </p>
          <p className="text-xs text-(--text-muted)">
            Not being pushed — check a row to override and include.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg border border-(--border-default) bg-(--bg-card) px-3 py-1.5 text-xs font-medium text-(--text-primary) transition-colors hover:bg-(--bg-muted)"
            onClick={selectAll}
          >
            Select All
          </button>
          <button
            type="button"
            className="rounded-lg border border-(--border-default) bg-(--bg-card) px-3 py-1.5 text-xs font-medium text-(--text-primary) transition-colors hover:bg-(--bg-muted)"
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
              onChange={(e) => {
                setFilter(e.target.value as FilterKey);
                setStatusSortSnapshot({
                  listType,
                  byId: new Map(rows.map((row) => [row.id, row.status])),
                });
                setLinkedInSortSnapshot({
                  listType,
                  byId: new Map(rows.map((row) => [row.id, Boolean(row.linkedinUrl?.trim())])),
                });
              }}
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

      <div className="relative">
        <div
          className="min-w-0 overflow-x-auto rounded-lg border border-(--border-default)"
          onScroll={handleTableScroll}
        >
        <table className="min-w-full border-separate border-spacing-0 text-left text-xs sm:text-sm">
          <thead className="bg-(--bg-muted) text-(--text-secondary) text-sm font-semibold">
            {listType === "companies" ? (
              <tr>
                <th className="sticky left-0 z-20 w-16 min-w-16 max-w-16 border-b border-r border-(--border-default) bg-(--bg-muted) px-2 py-2 text-center shadow-[2px_0_6px_-2px_rgba(0,0,0,0.08)]">
                  ✓
                </th>
                <th className="sticky left-[64px] z-21 w-40 min-w-40 max-w-48 border-b border-r border-(--border-default) bg-(--bg-muted) px-2 py-2 shadow-[2px_0_6px_-2px_rgba(0,0,0,0.08)]">
                  {UI_FIELD_LABELS.rawInput}
                </th>
                <th className="border-b border-(--border-default) px-2 py-2">{COMPANY_FIELD_LABELS.rawName}</th>
                <th className="border-b border-(--border-default) px-2 py-2">
                  {COMPANY_FIELD_LABELS.domain}
                </th>
                <th className="border-b border-(--border-default) px-2 py-2">{COMPANY_FIELD_LABELS.state}</th>
                <th className="border-b border-(--border-default) px-2 py-2">
                  {COMPANY_FIELD_LABELS.employees}
                </th>
                <th className="border-b border-(--border-default) px-2 py-2">
                  <span className="inline-flex items-center gap-1">
                    {COMPANY_FIELD_LABELS.linkedinUrl}
                    <ReasoningTooltip
                      content={linkedInHeaderLegendContent()}
                      trigger={
                        <span className="ml-1 inline-flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full border border-(--border-default) text-[10px] text-(--text-muted)">
                          ?
                        </span>
                      }
                      triggerAriaLabel="LinkedIn source legend"
                    />
                  </span>
                </th>
                <th className="min-w-[120px] border-b border-(--border-default) px-2 py-2">
                  {UI_FIELD_LABELS.confidence}
                </th>
                <th className="min-w-[120px] border-b border-(--border-default) px-2 py-2">{UI_FIELD_LABELS.reasoning}</th>
              </tr>
            ) : (
              <tr>
                <th className="sticky left-0 z-20 w-16 min-w-16 max-w-16 border-b border-r border-(--border-default) bg-(--bg-muted) px-2 py-2 text-center shadow-[2px_0_6px_-2px_rgba(0,0,0,0.08)]">
                  ✓
                </th>
                <th className="sticky left-[64px] z-21 w-40 min-w-40 max-w-48 border-b border-r border-(--border-default) bg-(--bg-muted) px-2 py-2 shadow-[2px_0_6px_-2px_rgba(0,0,0,0.08)]">
                  {CONTACT_REVIEW_NAME_HEADER}
                </th>
                <th className="min-w-[200px] border-b border-(--border-default) px-2 py-2">{CONTACT_FIELD_LABELS.email}</th>
                <th className="border-b border-(--border-default) px-2 py-2">{CONTACT_FIELD_LABELS.company}</th>
                <th className="border-b border-(--border-default) px-2 py-2">{CONTACT_FIELD_LABELS.title}</th>
                <th className="border-b border-(--border-default) px-2 py-2">
                  <span className="inline-flex items-center gap-1">
                    {CONTACT_FIELD_LABELS.linkedinUrl}
                    <ReasoningTooltip
                      content={linkedInHeaderLegendContent()}
                      trigger={
                        <span className="ml-1 inline-flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full border border-(--border-default) text-[10px] text-(--text-muted)">
                          ?
                        </span>
                      }
                      triggerAriaLabel="LinkedIn source legend"
                    />
                  </span>
                </th>
                <th className="min-w-[220px] max-w-56 border-b border-(--border-default) px-2 py-2">
                  {CONTACT_FIELD_LABELS.membershipNotes}
                </th>
                <th className="min-w-[120px] border-b border-(--border-default) px-2 py-2">
                  {UI_FIELD_LABELS.confidence}
                </th>
                <th className="min-w-[120px] border-b border-(--border-default) px-2 py-2">{UI_FIELD_LABELS.reasoning}</th>
              </tr>
            )}
          </thead>
          <tbody>
            {orderedReviewRows.length === 0 ? (
              <tr>
                <td
                  colSpan={999}
                  className="px-6 py-10 text-center text-sm text-(--text-muted)"
                >
                  No records match the current filter.
                </td>
              </tr>
            ) : null}
            {listType === "companies"
              ? (orderedReviewRows as EnrichedCompany[]).map((row, ri) => {
                  const muted = row.status === "skipped";
                  const mutedCellTextClass = muted ? "text-zinc-500 dark:text-zinc-400" : "";
                  const checked = row.status === "approved";
                  const flashTail = flashRowId === row.id ? ` ${ROW_FLASH_TR_CLASS}` : "";
                  return (
                    <tr
                      key={row.id}
                      data-row-id={row.id}
                      className={`${rowShellClass(row, ri)} transition duration-150${flashTail}`}
                    >
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
                      <td className={`max-w-48 px-2 py-1.5 align-middle wrap-break-word ${mutedCellTextClass}`}>
                        <EditableCell
                          value={row.resolvedName}
                          edited={isEdited(row.id, "resolvedName")}
                          muted={muted}
                          pencilOnHover
                          onSave={(v) => {
                            markEdited(row.id, "resolvedName");
                            setRows(
                              (rows as EnrichedCompany[]).map((r) =>
                                r.id === row.id ? { ...r, resolvedName: v } : r,
                              ),
                            );
                            persistManualEdit(
                              (row as EnrichedCompany).domain?.trim().toLowerCase() ?? "",
                              "resolvedName",
                              v,
                            );
                            scheduleAfterRowEdit(row.id);
                          }}
                        />
                      </td>
                      <td className={`max-w-48 px-2 py-1.5 align-middle wrap-break-word ${mutedCellTextClass}`}>
                        <EditableCell
                          value={row.domain}
                          edited={isEdited(row.id, "domain")}
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
                            persistManualEdit(
                              (row as EnrichedCompany).domain?.trim().toLowerCase() ?? "",
                              "domain",
                              domain,
                            );
                            scheduleAfterRowEdit(row.id);
                          }}
                        />
                      </td>
                      <td className={`max-w-56 px-2 py-1.5 align-middle ${mutedCellTextClass}`}>
                        <StateRegionCell
                          value={row.state}
                          edited={isEdited(row.id, "state")}
                          muted={muted}
                          onSave={(v) => {
                            markEdited(row.id, "state");
                            const full = expandStateAbbreviation(sanitizeState(v));
                            setRows(
                              (rows as EnrichedCompany[]).map((r) =>
                                r.id === row.id ? { ...r, state: full } : r,
                              ),
                            );
                            persistManualEdit(
                              (row as EnrichedCompany).domain?.trim().toLowerCase() ?? "",
                              "state",
                              full,
                            );
                            scheduleAfterRowEdit(row.id);
                          }}
                        />
                      </td>
                      <td className={`px-2 py-1.5 align-middle ${mutedCellTextClass}`}>
                        <EmployeesCell
                          value={row.numberOfEmployees}
                          edited={isEdited(row.id, "numberOfEmployees")}
                          muted={muted}
                          onSave={(n) => {
                            markEdited(row.id, "numberOfEmployees");
                            setRows(
                              (rows as EnrichedCompany[]).map((r) =>
                                r.id === row.id ? { ...r, numberOfEmployees: n } : r,
                              ),
                            );
                            persistManualEdit(
                              (row as EnrichedCompany).domain?.trim().toLowerCase() ?? "",
                              "numberOfEmployees",
                              n,
                            );
                            scheduleAfterRowEdit(row.id);
                          }}
                        />
                      </td>
                      <td className={`min-w-[180px] max-w-[220px] px-2 py-1.5 align-middle break-all whitespace-normal ${mutedCellTextClass}`}>
                        <LinkedInProfileCell
                          value={row.linkedinUrl}
                          edited={isEdited(row.id, "linkedinUrl")}
                          muted={muted}
                          breakAll
                          linkedinSource={row.linkedinSource}
                          linkedinAmberFlag={row.linkedinAmberFlag}
                          amberTooltip="LinkedIn sourced from web search. Verify before trusting."
                          onSave={(v) => {
                            markEdited(row.id, "linkedinUrl");
                            setRows(
                              (rows as EnrichedCompany[]).map((r) =>
                                r.id === row.id
                                  ? { ...r, linkedinUrl: v, linkedinSource: "manual" }
                                  : r,
                              ),
                            );
                            persistManualEdit(
                              (row as EnrichedCompany).domain?.trim().toLowerCase() ?? "",
                              "linkedinUrl",
                              v,
                            );
                            scheduleAfterRowEdit(row.id);
                          }}
                        />
                      </td>
                      <td className={`min-w-[120px] px-2 py-1.5 align-middle ${mutedCellTextClass}`}>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <ConfidenceBadge score={getDisplayConfidence(row, "companies")} />
                          {row.hubspotId ? (
                            <HubSpotPrecheckBadge complete={row.hubspotComplete === true} />
                          ) : null}
                          {row.reviewBucket === "excluded" && row.exclusionReason ? (
                            <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">
                              {exclusionReasonBadgeLabel(row.exclusionReason)}
                            </span>
                          ) : null}
                          {filter === "excluded" && row.exclusionReason === "international" ? (
                            <button
                              type="button"
                              onClick={() => includeInternationalAnyway(row.id)}
                              className="rounded border border-(--border-default) bg-(--bg-card) px-2 py-0.5 text-xs font-medium text-(--text-primary) transition-colors hover:bg-(--bg-muted)"
                            >
                              Include anyway
                            </button>
                          ) : null}
                        </div>
                      </td>
                      <td className={`min-w-[120px] max-w-56 px-2 py-1.5 align-middle wrap-break-word ${mutedCellTextClass}`}>
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
                  const mutedCellTextClass = muted ? "text-zinc-500 dark:text-zinc-400" : "";
                  const checked = row.status === "approved";
                  const fullName = formatContactFullName(row);
                  const flashTail = flashRowId === row.id ? ` ${ROW_FLASH_TR_CLASS}` : "";
                  return (
                    <tr
                      key={row.id}
                      data-row-id={row.id}
                      className={`${rowShellClass(row, ri)} transition duration-150${flashTail}`}
                    >
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
                          edited={isEdited(row.id, "name")}
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
                            persistManualEdit(
                              (row as EnrichedContact).resolvedEmail?.trim().toLowerCase() ?? "",
                              "name",
                              clean,
                            );
                            scheduleAfterRowEdit(row.id);
                          }}
                        />
                      </td>
                      <td className={`min-w-[200px] max-w-48 break-all px-2 py-1.5 align-middle ${mutedCellTextClass}`}>
                        <div className="flex items-center gap-1.5">
                          <EditableCell
                            value={sanitizeUnknown(row.rawEmail)}
                            edited={isEdited(row.id, "rawEmail")}
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
                              persistManualEdit(
                                (row as EnrichedContact).resolvedEmail?.trim().toLowerCase() ?? "",
                                "rawEmail",
                                next,
                              );
                              scheduleAfterRowEdit(row.id);
                            }}
                          />
                        </div>
                      </td>
                      <td className={`max-w-48 px-2 py-1.5 align-middle wrap-break-word ${mutedCellTextClass}`}>
                        <EditableCell
                          value={sanitizeCompanyName(row.resolvedCompany)}
                          edited={isEdited(row.id, "resolvedCompany")}
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
                            persistManualEdit(
                              (row as EnrichedContact).resolvedEmail?.trim().toLowerCase() ?? "",
                              "resolvedCompany",
                              next,
                            );
                            scheduleAfterRowEdit(row.id);
                          }}
                        />
                      </td>
                      <td className={`max-w-48 px-2 py-1.5 align-middle wrap-break-word ${mutedCellTextClass}`}>
                        <EditableCell
                          value={sanitizeUnknown(row.title)}
                          edited={isEdited(row.id, "title")}
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
                            persistManualEdit(
                              (row as EnrichedContact).resolvedEmail?.trim().toLowerCase() ?? "",
                              "title",
                              next,
                            );
                            scheduleAfterRowEdit(row.id);
                          }}
                        />
                      </td>
                      <td className={`min-w-[180px] max-w-[220px] px-2 py-1.5 align-middle break-all whitespace-normal ${mutedCellTextClass}`}>
                        <LinkedInProfileCell
                          value={sanitizeUnknown(row.linkedinUrl)}
                          edited={isEdited(row.id, "linkedinUrl")}
                          muted={muted}
                          breakAll
                          linkedinSource={row.linkedinSource}
                          linkedinAmberFlag={row.linkedinAmberFlag}
                          amberTooltip="All data verified, but LinkedIn was sourced from AI web search — do a quick check to confirm it's correct."
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
                            persistManualEdit(
                              (row as EnrichedContact).resolvedEmail?.trim().toLowerCase() ?? "",
                              "linkedinUrl",
                              next,
                            );
                            scheduleAfterRowEdit(row.id);
                          }}
                        />
                      </td>
                      <td
                        className={`max-w-56 min-w-[220px] px-2 py-1.5 align-middle wrap-break-word ${mutedCellTextClass}`}
                      >
                        <EditableCell
                          value={row.membershipNotes ?? ""}
                          edited={isEdited(row.id, "membershipNotes")}
                          muted={muted}
                          pencilOnHover
                          onSave={(v) => {
                            markEdited(row.id, "membershipNotes");
                            const next = v.trim();
                            setRows(
                              (rows as EnrichedContact[]).map((r) =>
                                r.id === row.id ? { ...r, membershipNotes: next } : r,
                              ),
                            );
                            persistManualEdit(
                              (row as EnrichedContact).resolvedEmail?.trim().toLowerCase() ?? "",
                              "membershipNotes",
                              next,
                            );
                            scheduleAfterRowEdit(row.id);
                          }}
                        />
                      </td>
                      <td className={`min-w-[120px] px-2 py-1.5 align-middle ${mutedCellTextClass}`}>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <ConfidenceBadge score={getDisplayConfidence(row, "contacts")} />
                          {row.hubspotId ? (
                            <HubSpotPrecheckBadge complete={row.hubspotComplete === true} />
                          ) : null}
                          {row.reviewBucket === "excluded" && row.exclusionReason ? (
                            <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">
                              {exclusionReasonBadgeLabel(row.exclusionReason)}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className={`min-w-[120px] max-w-56 px-2 py-1.5 align-middle wrap-break-word ${mutedCellTextClass}`}>
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
        {showScrollHint ? (
          <div
            className="pointer-events-none absolute right-0 top-0 h-full w-8 rounded-r-lg bg-linear-to-l from-(--bg-page) to-transparent"
            aria-hidden
          />
        ) : null}
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
            className={`shrink-0 rounded-lg px-4 py-2 text-sm font-semibold transition-[background-color,transform] duration-75 ${
              approvedCount > 0
                ? "bg-(--realm-purple) text-white hover:bg-(--realm-purple-hover) active:scale-95"
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

