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

function monthMatchesQuery(month: (typeof MONTH_NAMES)[number], query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const full = month.toLowerCase();
  const short = full.slice(0, 3);
  return full.startsWith(q) || short.startsWith(q);
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
  sourceFileName = null,
  importMode = "event",
}: EventContextFormProps) {
  const [eventName, setEventName] = useState("");
  const [monthName, setMonthName] = useState<string>("");
  const [monthInputValue, setMonthInputValue] = useState("");
  const [monthOpen, setMonthOpen] = useState(false);
  const [monthHighlight, setMonthHighlight] = useState(-1);
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
  const filteredMonthOptions = useMemo(
    () => MONTH_NAMES.filter((month) => monthMatchesQuery(month, monthInputValue)),
    [monthInputValue],
  );

  useEffect(() => {
    if (!initialValues) return;
    const r = initialValues.region;
    const normalized = String(r ?? "").trim();
    const validRegion =
      US_STATE_OPTIONS.includes(normalized) ||
      REGION_VALUES.includes(normalized as (typeof REGION_VALUES)[number]);
    regionManuallySelected.current = Boolean(normalized);
    const parsed = parseMonthYearString(initialValues.eventDate);
    queueMicrotask(() => {
      setEventName(initialValues.eventName);
      if (validRegion) {
        setRegion(normalized);
        setComboInputValue(normalized);
      } else {
        setRegion("");
        setComboInputValue("");
      }
      setAudienceLevel(initialValues.audienceLevel || DEFAULT_AUDIENCE);
      if (parsed) {
        setMonthName(parsed.month);
        setMonthInputValue(parsed.month);
        setYear(parsed.year.toString());
      }
    });
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

      let inferredMonth: (typeof MONTH_NAMES)[number] | null = null;
      for (const { token, month } of monthTokens) {
        const monthBoundary = new RegExp(`(?<![a-z])${token}(?![a-z])`);
        if (monthBoundary.test(normalized)) {
          inferredMonth = month;
          break;
        }
      }
      if (inferredMonth) {
        queueMicrotask(() => {
          setMonthName(inferredMonth);
          setMonthInputValue(inferredMonth);
        });
      }
    }

    if (!yearManuallySelected.current) {
      const yearMatch = normalized.match(/(?<!\d)(20[2-3]\d)(?!\d)/);
      if (yearMatch) {
        const yearNum = Number(yearMatch[1]);
        if (yearNum >= 2020 && yearNum <= 2035) {
          queueMicrotask(() => setYear(String(yearNum)));
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

  const selectMonthOption = useCallback((month: (typeof MONTH_NAMES)[number]) => {
    monthManuallySelected.current = true;
    setMonthName(month);
    setMonthInputValue(month);
    setMonthOpen(false);
    setMonthHighlight(-1);
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
    <form onSubmit={handleSubmit} className={`flex flex-col ${cardClass}`}>
        <div>
          <h2 className="text-lg font-semibold text-(--realm-navy)">
            {importMode === "bulk" ? "List Context" : "Event Context"}
          </h2>
          <p className="mt-1 text-sm text-(--text-muted)">
            {importMode === "bulk"
              ? "Describe the list so AI can resolve company names accurately."
              : "Adding event context helps the AI enrich your records with greater precision"}
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
            <span className="font-medium text-(--text-primary)">Event Date</span>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="relative">
                <input
                  type="text"
                  role="combobox"
                  aria-expanded={monthOpen}
                  aria-controls="month-listbox"
                  aria-activedescendant={monthHighlight >= 0 ? `month-option-${monthHighlight}` : undefined}
                  className={`${inputClass} pr-8`}
                  placeholder="Search months..."
                  value={monthInputValue}
                  autoComplete="off"
                  disabled={disabled}
                  onChange={(e) => {
                    setMonthInputValue(e.target.value);
                    setMonthOpen(true);
                    setMonthHighlight(-1);
                  }}
                  onFocus={() => setMonthOpen(true)}
                  onBlur={() => {
                    setTimeout(() => {
                      setMonthOpen(false);
                      setMonthInputValue(monthName);
                      setMonthHighlight(-1);
                    }, 120);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setMonthOpen(true);
                      setMonthHighlight((h) => Math.min(h + 1, filteredMonthOptions.length - 1));
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setMonthHighlight((h) => Math.max(h - 1, -1));
                    } else if (e.key === "Enter") {
                      e.preventDefault();
                      const sel = filteredMonthOptions[monthHighlight];
                      if (sel) selectMonthOption(sel);
                    } else if (e.key === "Escape") {
                      setMonthOpen(false);
                      setMonthInputValue(monthName);
                      setMonthHighlight(-1);
                    }
                  }}
                />
                <span
                  className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-(--text-muted)"
                  aria-hidden
                >
                  ▾
                </span>

                {monthOpen && filteredMonthOptions.length > 0 ? (
                  <ul
                    id="month-listbox"
                    className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-(--border-default) bg-(--bg-card) py-1 shadow-lg"
                    role="listbox"
                  >
                    <li className="px-3 py-1 text-xs font-semibold uppercase tracking-wider text-(--text-muted)">
                      Months
                    </li>
                    {filteredMonthOptions.map((m, idx) => {
                      const isHighlighted = idx === monthHighlight;
                      return (
                        <li
                          key={m}
                          id={`month-option-${idx}`}
                          role="option"
                          aria-selected={monthName === m}
                          className={`cursor-pointer px-3 py-1.5 text-sm ${
                            isHighlighted
                              ? "bg-(--realm-purple) text-white"
                              : monthName === m
                                ? "bg-(--bg-muted) text-(--text-primary)"
                                : "text-(--text-primary) hover:bg-(--bg-muted)"
                          }`}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            selectMonthOption(m);
                          }}
                        >
                          {m}
                        </li>
                      );
                    })}
                  </ul>
                ) : monthOpen && monthInputValue.trim() && filteredMonthOptions.length === 0 ? (
                  <div className="absolute z-50 mt-1 w-full rounded-lg border border-(--border-default) bg-(--bg-card) px-3 py-2 text-sm text-(--text-muted) shadow-lg">
                    No results for &ldquo;{monthInputValue}&rdquo;
                  </div>
                ) : null}
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
            <span className="font-medium text-(--text-primary)">State / Region</span>
            <div className="relative" ref={comboContainerRef}>
              <input
                type="text"
                role="combobox"
                aria-expanded={comboOpen}
                aria-controls="state-region-listbox"
                aria-activedescendant={comboHighlight >= 0 ? `state-region-option-${comboHighlight}` : undefined}
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
                  id="state-region-listbox"
                  className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-(--border-default) bg-(--bg-card) py-1 shadow-lg"
                  role="listbox"
                >
                  {stateOptions.length > 0 ? (
                    <>
                      <li className="px-3 py-1 text-xs font-semibold uppercase tracking-wider text-(--text-muted)">
                        States
                      </li>
                      {stateOptions.map((o) => {
                        const flatIdx = filteredComboOptions.indexOf(o);
                        const isHighlighted = flatIdx === comboHighlight;
                        return (
                          <li
                            key={o.label}
                            id={`state-region-option-${flatIdx}`}
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
                        className={`px-3 py-1 text-xs font-semibold uppercase tracking-wider text-(--text-muted) ${stateOptions.length > 0 ? "mt-1 border-t border-(--border-default) pt-2" : ""}`}
                      >
                        Regions
                      </li>
                      {regionOptions.map((o) => {
                        const flatIdx = filteredComboOptions.indexOf(o);
                        const isHighlighted = flatIdx === comboHighlight;
                        return (
                          <li
                            key={o.label}
                            id={`state-region-option-${flatIdx}`}
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
            className="rounded-lg bg-(--realm-purple) px-4 py-2 text-sm font-medium text-white transition-[background-color,transform] duration-75 hover:bg-(--realm-purple-hover) active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {importMode === "bulk" ? "Run AI Cleaning" : "Run Enrichment Pipeline"}
          </button>
        </div>
    </form>
  );
}
