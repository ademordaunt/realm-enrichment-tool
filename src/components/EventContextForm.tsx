"use client";

import { STATE_REGION_OPTIONS } from "@/lib/utils/states";
import type { EventContext } from "@/lib/utils/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const DEFAULT_AUDIENCE = "CISOs, SOC team leaders, security leaders";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const cardClass =
  "rounded-xl border border-(--border-default) bg-(--bg-card) p-6 shadow-(--shadow-card) space-y-5";

const inputClass =
  "w-full rounded-lg border border-(--border-default) bg-(--bg-card) px-3 py-2 text-(--text-primary) focus:border-transparent focus:outline-none focus:ring-2 focus:ring-(--realm-purple)";

const inputWithTrailingIconClass = `${inputClass} pr-10`;

const selectClass = `${inputClass} appearance-none pr-10`;

/** 50 states + DC, A–Z (excludes National / International from shared list). */
const US_STATE_OPTIONS = STATE_REGION_OPTIONS.filter(
  (x) => x !== "National" && x !== "International",
);

const MACRO_REGION_OPTIONS = [
  "Northeast",
  "Mid-Atlantic",
  "Southeast",
  "Midwest",
  "Southwest",
  "Northwest",
  "TOLA",
] as const;

const REGION_VALUES = [
  "Northeast",
  "Mid-Atlantic",
  "Southeast",
  "Midwest",
  "Southwest",
  "Northwest",
  "TOLA",
] as const;


function eventNameFromFileName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/i, "");
  const parts = base.split(/_+/).map((p) => p.trim()).filter(Boolean);
  return parts.join(" ");
}

function parseMonthYearString(s: string): { month: string; year: number } | null {
  const t = s.trim();
  if (!t) return null;
  const parts = t.split(/\s+/);
  if (parts.length < 2) return null;
  const year = Number(parts[parts.length - 1]);
  const monthStr = parts.slice(0, -1).join(" ");
  if (!monthStr || Number.isNaN(year)) return null;
  if (!MONTH_NAMES.includes(monthStr as (typeof MONTH_NAMES)[number])) return null;
  return { month: monthStr, year };
}

/** All searchable options for the state/region combobox. */
const ALL_COMBO_OPTIONS = [
  ...US_STATE_OPTIONS.map((s) => ({ label: s, group: "States" as const })),
  ...MACRO_REGION_OPTIONS.map((r) => ({ label: r, group: "Regions" as const })),
];

export interface EventContextFormProps {
  listType: "companies" | "contacts";
  onSubmit: (context: EventContext) => void;
  disabled?: boolean;
  /** When set (e.g. after cancelling enrichment), rehydrates the form. */
  initialValues?: EventContext | null;
  onBackToUpload?: () => void;
  /** Original upload file name — used to pre-fill Event Name once. */
  sourceFileName?: string | null;
  /** From starter screen; stored on submitted EventContext. */
  importMode?: "event" | "bulk";
}

export function EventContextForm({
  listType,
  onSubmit,
  disabled = false,
  initialValues = null,
  onBackToUpload,
  sourceFileName = null,
  importMode = "event",
}: EventContextFormProps) {
  const [eventName, setEventName] = useState("");
  const [monthName, setMonthName] = useState<string>("");
  const [year, setYear] = useState<string>(new Date().getFullYear().toString());
  const [region, setRegion] = useState("");
  /** Text currently shown in the combobox input (may differ from `region` while typing). */
  const [comboInputValue, setComboInputValue] = useState("");
  const [comboOpen, setComboOpen] = useState(false);
  const [comboHighlight, setComboHighlight] = useState(-1);
  const [audienceLevel, setAudienceLevel] = useState(DEFAULT_AUDIENCE);
  const [audienceTouched, setAudienceTouched] = useState(false);

  const nameFromFileApplied = useRef(false);
  const regionManuallySelected = useRef(false);
  const monthManuallySelected = useRef(false);
  const yearManuallySelected = useRef(false);
  const comboContainerRef = useRef<HTMLDivElement>(null);

  const years = useMemo(() => {
    const y = new Date().getFullYear();
    return [y - 2, y - 1, y, y + 1];
  }, []);

  const monthYearForPrompt =
    monthName && year !== "" ? `${monthName} ${year}` : "";

  const filteredComboOptions = useMemo(() =>
    comboInputValue.trim()
      ? ALL_COMBO_OPTIONS.filter((o) =>
          o.label.toLowerCase().includes(comboInputValue.toLowerCase().trim()),
        )
      : ALL_COMBO_OPTIONS,
    [comboInputValue],
  );

  useEffect(() => {
    if (!initialValues) return;
    setEventName(initialValues.eventName);
    const r = initialValues.region;
    const normalized = String(r ?? "").trim();
    if (
      US_STATE_OPTIONS.includes(normalized) ||
      REGION_VALUES.includes(normalized as (typeof REGION_VALUES)[number])
    ) {
      setRegion(normalized);
      setComboInputValue(normalized);
    } else {
      setRegion("");
      setComboInputValue("");
    }
    regionManuallySelected.current = Boolean(normalized);
    setAudienceLevel(initialValues.audienceLevel || DEFAULT_AUDIENCE);
    const parsed = parseMonthYearString(initialValues.eventDate);
    if (parsed) {
      setMonthName(parsed.month);
      setYear(parsed.year.toString());
    }
  }, [initialValues]);

  useEffect(() => {
    if (initialValues || !sourceFileName || nameFromFileApplied.current) return;
    setEventName(eventNameFromFileName(sourceFileName));
    nameFromFileApplied.current = true;
  }, [initialValues, sourceFileName]);

  useEffect(() => {
    if (importMode === "bulk") return;
    const normalized = eventName
      .toLowerCase()
      .replace(/-/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!normalized) return;

    if (!monthManuallySelected.current) {
      const monthTokens: Array<{ token: string; month: (typeof MONTH_NAMES)[number] }> = [
        { token: "january", month: "January" },
        { token: "jan", month: "January" },
        { token: "february", month: "February" },
        { token: "feb", month: "February" },
        { token: "march", month: "March" },
        { token: "mar", month: "March" },
        { token: "april", month: "April" },
        { token: "apr", month: "April" },
        { token: "may", month: "May" },
        { token: "june", month: "June" },
        { token: "jun", month: "June" },
        { token: "july", month: "July" },
        { token: "jul", month: "July" },
        { token: "august", month: "August" },
        { token: "aug", month: "August" },
        { token: "september", month: "September" },
        { token: "sep", month: "September" },
        { token: "october", month: "October" },
        { token: "oct", month: "October" },
        { token: "november", month: "November" },
        { token: "nov", month: "November" },
        { token: "december", month: "December" },
        { token: "dec", month: "December" },
      ];

      for (const { token, month } of monthTokens) {
        const monthBoundary = new RegExp(`(?<![a-z])${token}(?![a-z])`);
        if (monthBoundary.test(normalized)) {
          setMonthName(month);
          break;
        }
      }
    }

    if (!yearManuallySelected.current) {
      const yearMatch = normalized.match(/(?<!\d)(20[2-3]\d)(?!\d)/);
      if (yearMatch) {
        const yearNum = Number(yearMatch[1]);
        if (yearNum >= 2020 && yearNum <= 2035) {
          setYear(String(yearNum));
        }
      }
    }
  }, [importMode, eventName]);

  const selectComboOption = useCallback((label: string) => {
    regionManuallySelected.current = true;
    setRegion(label);
    setComboInputValue(label);
    setComboOpen(false);
    setComboHighlight(-1);
  }, []);

  const clearComboSelection = useCallback(() => {
    regionManuallySelected.current = true;
    setRegion("");
    setComboInputValue("");
    setComboOpen(false);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventName.trim()) return;
    const effectiveRegion = region.trim();
    const eventDateForSubmit =
      importMode === "bulk" && !monthYearForPrompt.trim() ? "" : monthYearForPrompt.trim();
    onSubmit({
      eventName: eventName.trim(),
      eventDate: eventDateForSubmit,
      region: effectiveRegion,
      audienceLevel: listType === "contacts" ? audienceLevel.trim() : "",
      listType,
      importMode,
    });
  };

  const stateOptions = filteredComboOptions.filter((o) => o.group === "States");
  const regionOptions = filteredComboOptions.filter((o) => o.group === "Regions");

  return (
    <>
      {onBackToUpload ? (
        <button
          type="button"
          onClick={onBackToUpload}
          className="mt-6 mb-2 self-start text-sm text-(--text-muted) transition-colors hover:text-(--text-primary) hover:underline"
        >
          ← Back to Upload
        </button>
      ) : null}

      <form onSubmit={handleSubmit} className={`flex flex-col ${cardClass}`}>
        <div>
          <h2 className="text-lg font-semibold text-(--realm-navy)">
            {importMode === "bulk" ? "List Context" : "Event Context"}
          </h2>
          <p className="mt-1 text-sm text-(--text-muted)">
            {importMode === "bulk"
              ? "Describe the list so AI can resolve company names accurately."
              : "Describe the event so AI enrichment can resolve names accurately."}
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-(--text-primary)">
              {importMode === "bulk" ? "List Name" : "Event Name"}{" "}
              <span className="text-(--color-error)">*</span>
            </span>
            <div className="relative">
              <input
                required
                className={inputWithTrailingIconClass}
                placeholder="CISOExecNet Midwest"
                value={eventName}
                onChange={(e) => setEventName(e.target.value)}
                disabled={disabled}
              />
              <span
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-(--text-muted) opacity-40"
                aria-hidden
              >
                ✏️
              </span>
            </div>
          </label>

          <div className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium text-(--text-primary)">
              Event Date{" "}
              <span className="font-normal text-(--text-muted)">(optional)</span>
            </span>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="relative">
                <select
                  className={selectClass}
                  value={monthName}
                  onChange={(e) => {
                    monthManuallySelected.current = true;
                    setMonthName(e.target.value);
                  }}
                  disabled={disabled}
                >
                  <option value="">Select Month</option>
                  {MONTH_NAMES.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <span
                  className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-(--text-muted)"
                  aria-hidden
                >
                  ▾
                </span>
              </div>
              <div className="relative">
                <select
                  className={selectClass}
                  value={year}
                  onChange={(e) => {
                    yearManuallySelected.current = true;
                    setYear(e.target.value);
                  }}
                  disabled={disabled}
                >
                  <option value="">Select Year</option>
                  {years.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
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

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-(--text-primary)">
              State / Region{" "}
              <span className="font-normal text-(--text-muted)">(optional)</span>
            </span>
            <div className="relative" ref={comboContainerRef}>
              <input
                type="text"
                className={`${inputClass} pr-8`}
                placeholder="Search states or regions…"
                value={comboInputValue}
                autoComplete="off"
                disabled={disabled}
                onChange={(e) => {
                  setComboInputValue(e.target.value);
                  setComboOpen(true);
                  setComboHighlight(-1);
                }}
                onFocus={() => setComboOpen(true)}
                onBlur={() => {
                  setTimeout(() => {
                    setComboOpen(false);
                    setComboInputValue(region);
                    setComboHighlight(-1);
                  }, 120);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setComboOpen(true);
                    setComboHighlight((h) =>
                      Math.min(h + 1, filteredComboOptions.length - 1),
                    );
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setComboHighlight((h) => Math.max(h - 1, -1));
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    const sel = filteredComboOptions[comboHighlight];
                    if (sel) selectComboOption(sel.label);
                  } else if (e.key === "Escape") {
                    setComboOpen(false);
                    setComboInputValue(region);
                    setComboHighlight(-1);
                  }
                }}
              />
              {region ? (
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label="Clear selection"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-base leading-none text-(--text-muted) hover:text-(--text-primary)"
                  onClick={clearComboSelection}
                >
                  ×
                </button>
              ) : (
                <span
                  className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-(--text-muted)"
                  aria-hidden
                >
                  ▾
                </span>
              )}

              {comboOpen && filteredComboOptions.length > 0 ? (
                <ul
                  className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-(--border-default) bg-(--bg-card) py-1 shadow-lg"
                  role="listbox"
                >
                  {stateOptions.length > 0 ? (
                    <>
                      <li className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-(--text-muted)">
                        States
                      </li>
                      {stateOptions.map((o) => {
                        const flatIdx = filteredComboOptions.indexOf(o);
                        const isHighlighted = flatIdx === comboHighlight;
                        return (
                          <li
                            key={o.label}
                            role="option"
                            aria-selected={region === o.label}
                            className={`cursor-pointer px-3 py-1.5 text-sm ${
                              isHighlighted
                                ? "bg-(--realm-purple) text-white"
                                : region === o.label
                                  ? "bg-(--bg-muted) text-(--text-primary)"
                                  : "text-(--text-primary) hover:bg-(--bg-muted)"
                            }`}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              selectComboOption(o.label);
                            }}
                          >
                            {o.label}
                          </li>
                        );
                      })}
                    </>
                  ) : null}
                  {regionOptions.length > 0 ? (
                    <>
                      <li
                        className={`px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-(--text-muted) ${stateOptions.length > 0 ? "mt-1 border-t border-(--border-default) pt-2" : ""}`}
                      >
                        Regions
                      </li>
                      {regionOptions.map((o) => {
                        const flatIdx = filteredComboOptions.indexOf(o);
                        const isHighlighted = flatIdx === comboHighlight;
                        return (
                          <li
                            key={o.label}
                            role="option"
                            aria-selected={region === o.label}
                            className={`cursor-pointer px-3 py-1.5 text-sm ${
                              isHighlighted
                                ? "bg-(--realm-purple) text-white"
                                : region === o.label
                                  ? "bg-(--bg-muted) text-(--text-primary)"
                                  : "text-(--text-primary) hover:bg-(--bg-muted)"
                            }`}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              selectComboOption(o.label);
                            }}
                          >
                            {o.label}
                          </li>
                        );
                      })}
                    </>
                  ) : null}
                </ul>
              ) : comboOpen && comboInputValue.trim() && filteredComboOptions.length === 0 ? (
                <div className="absolute z-50 mt-1 w-full rounded-lg border border-(--border-default) bg-(--bg-card) px-3 py-2 text-sm text-(--text-muted) shadow-lg">
                  No results for &ldquo;{comboInputValue}&rdquo;
                </div>
              ) : null}
            </div>
          </label>

          {listType === "contacts" ? (
            <label
              className="flex flex-col gap-1 text-sm sm:col-span-2"
              htmlFor="audience-type"
            >
              <span className="font-medium text-(--text-primary)">
                Audience Type{" "}
                {importMode === "event" ? <span className="text-(--color-error)">*</span> : null}
              </span>
              <div className="relative">
                <input
                  id="audience-type"
                  required={importMode === "event"}
                  aria-label={
                    importMode === "event" ? "Audience type (required)" : "Audience type (optional)"
                  }
                  className={`${inputWithTrailingIconClass} ${!audienceTouched ? "text-(--text-muted)" : ""}`}
                  value={audienceLevel}
                  onChange={(e) => setAudienceLevel(e.target.value)}
                  onFocus={() => setAudienceTouched(true)}
                  disabled={disabled}
                />
                <span
                  className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-(--text-muted) opacity-40"
                  aria-hidden
                >
                  ✏️
                </span>
              </div>
            </label>
          ) : null}
        </div>

        <div className="flex justify-end pt-1">
          <button
            type="submit"
            disabled={disabled}
            className="rounded-lg bg-(--realm-purple) px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-(--realm-purple-hover) disabled:cursor-not-allowed disabled:opacity-50"
          >
            {importMode === "bulk" ? "Run AI Cleaning" : "Run Enrichment Pipeline"}
          </button>
        </div>
      </form>
    </>
  );
}
