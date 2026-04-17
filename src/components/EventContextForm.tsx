"use client";

import type { EventContext } from "@/lib/utils/types";
import { useState } from "react";

const REGIONS = [
  "National",
  "Northeast",
  "Southeast",
  "Midwest",
  "Southwest",
  "West",
  "International",
] as const;

export interface EventContextFormProps {
  listType: "companies" | "contacts";
  onSubmit: (context: EventContext) => void;
  disabled?: boolean;
}

export function EventContextForm({
  listType,
  onSubmit,
  disabled = false,
}: EventContextFormProps) {
  const [eventName, setEventName] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [region, setRegion] = useState("");
  const [industry, setIndustry] = useState("");
  const [audienceLevel, setAudienceLevel] = useState("");
  const [additionalNotes, setAdditionalNotes] = useState("");
  const [leadSource, setLeadSource] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      eventName: eventName.trim(),
      eventDate: eventDate.trim(),
      region,
      industry: industry.trim(),
      audienceLevel: audienceLevel.trim(),
      additionalNotes: additionalNotes.trim(),
      listType,
      leadSource: leadSource.trim(),
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div>
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          Event context
        </h2>
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

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-zinc-800 dark:text-zinc-200">
            Event date <span className="text-red-600">*</span>
          </span>
          <input
            required
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
            placeholder="March 2026"
            value={eventDate}
            onChange={(e) => setEventDate(e.target.value)}
            disabled={disabled}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-zinc-800 dark:text-zinc-200">
            Region <span className="text-red-600">*</span>
          </span>
          <select
            required
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            disabled={disabled}
          >
            <option value="">Select region</option>
            {REGIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-zinc-800 dark:text-zinc-200">
            Primary industry
          </span>
          <input
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
            placeholder="Healthcare & Financial Services"
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            disabled={disabled}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          <span className="font-medium text-zinc-800 dark:text-zinc-200">
            Audience level <span className="text-red-600">*</span>
          </span>
          <input
            required
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
            placeholder="CISO-level executives"
            value={audienceLevel}
            onChange={(e) => setAudienceLevel(e.target.value)}
            disabled={disabled}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          <span className="font-medium text-zinc-800 dark:text-zinc-200">
            Additional notes
          </span>
          <textarea
            rows={3}
            className="resize-y rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
            placeholder="Chicago-area heavy, many hospital systems"
            value={additionalNotes}
            onChange={(e) => setAdditionalNotes(e.target.value)}
            disabled={disabled}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          <span className="font-medium text-zinc-800 dark:text-zinc-200">
            Lead source (HubSpot) <span className="text-red-600">*</span>
          </span>
          <input
            required
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
            placeholder="CISOExecNet Midwest Mar. 2026"
            value={leadSource}
            onChange={(e) => setLeadSource(e.target.value)}
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
