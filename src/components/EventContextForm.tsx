"use client";

import { STATE_REGION_OPTIONS } from "@/lib/utils/states";
import type { EventContext } from "@/lib/utils/types";
import { useEffect, useMemo, useRef, useState } from "react";

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

export interface EventContextFormProps {
  listType: "companies" | "contacts";
  onSubmit: (context: EventContext) => void;
  disabled?: boolean;
  /** When set (e.g. after cancelling enrichment), rehydrates the form. */
  initialValues?: EventContext | null;
  onBackToUpload?: () => void;
  /** Original upload file name — used to pre-fill Event Name once. */
  sourceFileName?: string | null;
}

export function EventContextForm({
  listType,
  onSubmit,
  disabled = false,
  initialValues = null,
  onBackToUpload,
  sourceFileName = null,
}: EventContextFormProps) {
  const [eventName, setEventName] = useState("");
  const [monthName, setMonthName] = useState<string>("");
  const [year, setYear] = useState<number | "">("");
  const [region, setRegion] = useState("");
  const [audienceLevel, setAudienceLevel] = useState(DEFAULT_AUDIENCE);
  const [audienceTouched, setAudienceTouched] = useState(false);

  const nameFromFileApplied = useRef(false);

  const years = useMemo(() => {
    const y = new Date().getFullYear();
    return [y - 2, y - 1, y, y + 1];
  }, []);

  const monthYearForPrompt =
    monthName && year !== "" ? `${monthName} ${year}` : "";

  useEffect(() => {
    if (!initialValues) return;
    setEventName(initialValues.eventName);
    setRegion(initialValues.region);
    setAudienceLevel(initialValues.audienceLevel || DEFAULT_AUDIENCE);
    const parsed = parseMonthYearString(initialValues.eventDate);
    if (parsed) {
      setMonthName(parsed.month);
      setYear(parsed.year);
    }
  }, [initialValues]);

  useEffect(() => {
    if (initialValues || !sourceFileName || nameFromFileApplied.current) return;
    setEventName(eventNameFromFileName(sourceFileName));
    nameFromFileApplied.current = true;
  }, [initialValues, sourceFileName]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!monthYearForPrompt.trim()) return;
    onSubmit({
      eventName: eventName.trim(),
      eventDate: monthYearForPrompt.trim(),
      region,
      audienceLevel: audienceLevel.trim(),
      listType,
    });
  };

  return (
    <>
      {onBackToUpload ? (
        <button
          type="button"
          onClick={onBackToUpload}
          className="mb-3 self-start text-sm text-(--text-muted) transition-colors hover:text-(--text-primary) hover:underline"
        >
          ← Back to Upload
        </button>
      ) : null}

      <form onSubmit={handleSubmit} className={`flex flex-col ${cardClass}`}>
        <div>
          <h2 className="text-lg font-semibold text-(--realm-navy)">Event Context</h2>
          <p className="mt-1 text-sm text-(--text-muted)">
            Describe the event so AI enrichment can resolve names accurately.
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-(--text-primary)">
              Event Name <span className="text-(--color-error)">*</span>
            </span>
            <input
              required
              className={inputClass}
              placeholder="CISOExecNet Midwest"
              value={eventName}
              onChange={(e) => setEventName(e.target.value)}
              disabled={disabled}
            />
            <span className="text-xs text-(--text-muted)">
              Auto-filled from file name — edit if needed
            </span>
          </label>

          <div className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium text-(--text-primary)">
              Event Date <span className="text-(--color-error)">*</span>
            </span>
            <div className="grid gap-3 sm:grid-cols-2">
              <select
                required
                className={inputClass}
                value={monthName}
                onChange={(e) => setMonthName(e.target.value)}
                disabled={disabled}
              >
                <option value="">Select Month</option>
                {MONTH_NAMES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <select
                required
                className={inputClass}
                value={year === "" ? "" : String(year)}
                onChange={(e) => setYear(e.target.value ? Number(e.target.value) : "")}
                disabled={disabled}
              >
                <option value="">Select Year</option>
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-(--text-primary)">
              State / Region <span className="text-(--color-error)">*</span>
            </span>
            <select
              required
              className={inputClass}
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              disabled={disabled}
            >
              <option value="">Select State</option>
              {STATE_REGION_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium text-(--text-primary)">
              Audience Level <span className="text-(--color-error)">*</span>
            </span>
            <input
              required
              className={`${inputClass} ${!audienceTouched ? "text-(--text-muted)" : ""}`}
              value={audienceLevel}
              onChange={(e) => setAudienceLevel(e.target.value)}
              onFocus={() => setAudienceTouched(true)}
              disabled={disabled}
            />
          </label>
        </div>

        <div className="flex justify-end pt-1">
          <button
            type="submit"
            disabled={disabled}
            className="rounded-lg bg-(--realm-purple) px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-(--realm-purple-hover) disabled:cursor-not-allowed disabled:opacity-50"
          >
            Run AI Enrichment
          </button>
        </div>
      </form>
    </>
  );
}
