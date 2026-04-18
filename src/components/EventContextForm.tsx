"use client";

import { STATE_REGION_OPTIONS } from "@/lib/utils/states";
import type { EventContext } from "@/lib/utils/types";
import { useEffect, useState } from "react";

const DEFAULT_AUDIENCE = "CISOs, SOC team leaders, security leaders";

function isoDateToMonthYear(iso: string): string {
  if (!iso) return "";
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function monthYearStringToIsoFirstDay(monthYear: string): string {
  const d = Date.parse(`${monthYear.trim()} 1`);
  if (Number.isNaN(d)) return "";
  const dt = new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

function formatLongDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export interface EventContextFormProps {
  listType: "companies" | "contacts";
  onSubmit: (context: EventContext) => void;
  disabled?: boolean;
  /** When set (e.g. after cancelling enrichment), rehydrates the form. */
  initialValues?: EventContext | null;
  onBackToUpload?: () => void;
}

export function EventContextForm({
  listType,
  onSubmit,
  disabled = false,
  initialValues = null,
  onBackToUpload,
}: EventContextFormProps) {
  const [eventName, setEventName] = useState("");
  const [dateIso, setDateIso] = useState("");
  const [region, setRegion] = useState("");
  const [audienceLevel, setAudienceLevel] = useState(DEFAULT_AUDIENCE);
  const [audienceTouched, setAudienceTouched] = useState(false);

  useEffect(() => {
    if (!initialValues) return;
    setEventName(initialValues.eventName);
    setRegion(initialValues.region);
    setAudienceLevel(initialValues.audienceLevel || DEFAULT_AUDIENCE);
    const iso = monthYearStringToIsoFirstDay(initialValues.eventDate);
    if (iso) setDateIso(iso);
  }, [initialValues]);

  const monthYearForPrompt = isoDateToMonthYear(dateIso);

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
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
    >
      {onBackToUpload ? (
        <button
          type="button"
          onClick={onBackToUpload}
          className="self-start text-sm text-blue-600 hover:underline dark:text-blue-400"
        >
          ← Back to upload
        </button>
      ) : null}

      <div>
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Event context</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Describe the event so AI enrichment can resolve names accurately.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-zinc-800 dark:text-zinc-200">
            Event name <span className="text-red-600">*</span>
          </span>
          <input
            required
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
            placeholder="CISOExecNet Midwest"
            value={eventName}
            onChange={(e) => setEventName(e.target.value)}
            disabled={disabled}
          />
        </label>

        <div className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-zinc-800 dark:text-zinc-200">
            Event date <span className="text-red-600">*</span>
          </span>
          <input
            required
            type="date"
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
            value={dateIso}
            onChange={(e) => setDateIso(e.target.value)}
            disabled={disabled}
          />
          {dateIso ? (
            <span className="text-xs text-zinc-600 dark:text-zinc-400">
              {formatLongDate(dateIso)} · Stored for AI as{" "}
              <span className="font-medium">{monthYearForPrompt || "—"}</span>
            </span>
          ) : null}
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-zinc-800 dark:text-zinc-200">
            State <span className="text-red-600">*</span>
          </span>
          <select
            required
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            disabled={disabled}
          >
            <option value="">Select state</option>
            {STATE_REGION_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          <span className="font-medium text-zinc-800 dark:text-zinc-200">
            Audience Level <span className="text-red-600">*</span>
          </span>
          <input
            required
            className={`rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 ${
              !audienceTouched ? "text-zinc-500 dark:text-zinc-400" : ""
            }`}
            value={audienceLevel}
            onChange={(e) => setAudienceLevel(e.target.value)}
            onFocus={() => setAudienceTouched(true)}
            disabled={disabled}
          />
        </label>
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={disabled}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Run AI enrichment
        </button>
      </div>
    </form>
  );
}
