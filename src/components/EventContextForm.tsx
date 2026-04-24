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

const inputWithTrailingIconClass = `${inputClass} pr-10`;

const selectClass =
  `${inputClass} appearance-none pr-10`;

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
  "Mountain West",
  "Pacific West",
] as const;
const REGION_PICKER_OPTIONS = [...MACRO_REGION_OPTIONS, "National"] as const;
const REGION_VALUES = [
  "Midwest",
  "Northeast",
  "Southeast",
  "Southwest",
  "Pacific West",
  "Mountain West",
  "National",
] as const;

const ROOT_PICK_STATE = "__pick_state__";
const ROOT_PICK_REGION = "__pick_region__";
/** Root dropdown: explicit "no location" — stored `region` is "". */
const ROOT_NO_STATE_REGION = "__no_state_region__";
const CHANGE_SELECTION = "__change_selection__";
/** Sub-pickers: return to the main State/Region root dropdown (replaces a duplicate ← Back in the form). */
const SUB_PICKER_RETURN = "__return_to_state_region_root__";

const CITY_TO_STATE: Record<string, string> = {
  // Major metros / city keywords
  "new york": "New York",
  nyc: "New York",
  manhattan: "New York",
  brooklyn: "New York",
  queens: "New York",
  buffalo: "New York",
  rochester: "New York",
  albany: "New York",
  philadelphia: "Pennsylvania",
  pittsburgh: "Pennsylvania",
  harrisburg: "Pennsylvania",
  chicago: "Illinois",
  boston: "Massachusetts",
  worcester: "Massachusetts",
  dallas: "Texas",
  houston: "Texas",
  austin: "Texas",
  "fort worth": "Texas",
  "san antonio": "Texas",
  "el paso": "Texas",
  atlanta: "Georgia",
  savannah: "Georgia",
  miami: "Florida",
  orlando: "Florida",
  tampa: "Florida",
  jacksonville: "Florida",
  seattle: "Washington",
  spokane: "Washington",
  denver: "Colorado",
  "colorado springs": "Colorado",
  aurora: "Colorado",
  phoenix: "Arizona",
  tucson: "Arizona",
  mesa: "Arizona",
  "las vegas": "Nevada",
  reno: "Nevada",
  "san francisco": "California",
  sf: "California",
  "los angeles": "California",
  la: "California",
  "san diego": "California",
  "san jose": "California",
  sacramento: "California",
  fresno: "California",
  portland: "Oregon",
  minneapolis: "Minnesota",
  "st paul": "Minnesota",
  detroit: "Michigan",
  cleveland: "Ohio",
  columbus: "Ohio",
  cincinnati: "Ohio",
  charlotte: "North Carolina",
  raleigh: "North Carolina",
  durham: "North Carolina",
  nashville: "Tennessee",
  memphis: "Tennessee",
  louisville: "Kentucky",
  indianapolis: "Indiana",
  "kansas city": "Missouri",
  "st louis": "Missouri",
  "saint louis": "Missouri",
  "new orleans": "Louisiana",
  "baton rouge": "Louisiana",
  baltimore: "Maryland",
  dc: "District of Columbia",
  "washington dc": "District of Columbia",
  "washington d.c.": "District of Columbia",
  washington: "District of Columbia",
  richmond: "Virginia",
  norfolk: "Virginia",
  "virginia beach": "Virginia",
  "salt lake": "Utah",
  "salt lake city": "Utah",
  albuquerque: "New Mexico",
  omaha: "Nebraska",
  milwaukee: "Wisconsin",
  hartford: "Connecticut",
  providence: "Rhode Island",
  newark: "New Jersey",
  "jersey city": "New Jersey",
  "oklahoma city": "Oklahoma",
  tulsa: "Oklahoma",
  wichita: "Kansas",
  birmingham: "Alabama",
  montgomery: "Alabama",
  jackson: "Mississippi",
  "little rock": "Arkansas",
  "sioux falls": "South Dakota",
  fargo: "North Dakota",
  billings: "Montana",
  boise: "Idaho",
  anchorage: "Alaska",
  honolulu: "Hawaii",

  // State names
  alabama: "Alabama",
  alaska: "Alaska",
  arizona: "Arizona",
  arkansas: "Arkansas",
  california: "California",
  colorado: "Colorado",
  connecticut: "Connecticut",
  delaware: "Delaware",
  florida: "Florida",
  georgia: "Georgia",
  hawaii: "Hawaii",
  idaho: "Idaho",
  illinois: "Illinois",
  indiana: "Indiana",
  iowa: "Iowa",
  kansas: "Kansas",
  kentucky: "Kentucky",
  louisiana: "Louisiana",
  maine: "Maine",
  maryland: "Maryland",
  massachusetts: "Massachusetts",
  michigan: "Michigan",
  minnesota: "Minnesota",
  mississippi: "Mississippi",
  missouri: "Missouri",
  montana: "Montana",
  nebraska: "Nebraska",
  nevada: "Nevada",
  "new hampshire": "New Hampshire",
  "new jersey": "New Jersey",
  "new mexico": "New Mexico",
  "new york state": "New York",
  "north carolina": "North Carolina",
  "north dakota": "North Dakota",
  ohio: "Ohio",
  oklahoma: "Oklahoma",
  oregon: "Oregon",
  pennsylvania: "Pennsylvania",
  "rhode island": "Rhode Island",
  "south carolina": "South Carolina",
  "south dakota": "South Dakota",
  tennessee: "Tennessee",
  texas: "Texas",
  utah: "Utah",
  vermont: "Vermont",
  virginia: "Virginia",
  "washington state": "Washington",
  "west virginia": "West Virginia",
  wisconsin: "Wisconsin",
  wyoming: "Wyoming",
  "district of columbia": "District of Columbia",

  // State abbreviations
  al: "Alabama",
  ak: "Alaska",
  az: "Arizona",
  ar: "Arkansas",
  ca: "California",
  co: "Colorado",
  ct: "Connecticut",
  de: "Delaware",
  fl: "Florida",
  ga: "Georgia",
  hi: "Hawaii",
  id: "Idaho",
  il: "Illinois",
  in: "Indiana",
  ia: "Iowa",
  ks: "Kansas",
  ky: "Kentucky",
  me: "Maine",
  md: "Maryland",
  ma: "Massachusetts",
  mi: "Michigan",
  mn: "Minnesota",
  ms: "Mississippi",
  mo: "Missouri",
  mt: "Montana",
  ne: "Nebraska",
  nv: "Nevada",
  nh: "New Hampshire",
  nj: "New Jersey",
  nm: "New Mexico",
  ny: "New York",
  nc: "North Carolina",
  nd: "North Dakota",
  oh: "Ohio",
  ok: "Oklahoma",
  or: "Oregon",
  pa: "Pennsylvania",
  ri: "Rhode Island",
  sc: "South Carolina",
  sd: "South Dakota",
  tn: "Tennessee",
  tx: "Texas",
  ut: "Utah",
  vt: "Vermont",
  va: "Virginia",
  wa: "Washington",
  wv: "West Virginia",
  wi: "Wisconsin",
  wy: "Wyoming",

  // Macro keywords
  "mid-west": "Midwest",
  midwest: "Midwest",
  "mid west": "Midwest",
  "north-east": "Northeast",
  northeast: "Northeast",
  "south-east": "Southeast",
  southeast: "Southeast",
  "south-west": "Southwest",
  southwest: "Southwest",
  pacific: "Pacific West",
  mountain: "Mountain West",
  national: "National",
  virtual: "National",
  online: "National",
  rsa: "California",
};

const LOCATION_MATCH_KEYS = Object.keys(CITY_TO_STATE).sort((a, b) => b.length - a.length);

function detectRegionFromEventName(input: string): string | null {
  const normalized = input
    .toLowerCase()
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;
  for (const key of LOCATION_MATCH_KEYS) {
    if (normalized.includes(key)) {
      return CITY_TO_STATE[key] ?? null;
    }
  }
  return null;
}

function StateSubPicker({
  disabled,
  onBack,
  onPick,
  importMode,
}: {
  disabled: boolean;
  onBack: () => void;
  onPick: (name: string) => void;
  importMode: "event" | "bulk";
}) {
  return (
    <div className="relative">
      <select
        key="state-sub"
        className={selectClass}
        defaultValue=""
        onChange={(e) => {
          const v = e.target.value;
          if (v === SUB_PICKER_RETURN) {
            onBack();
            return;
          }
          if (!v) {
            if (importMode === "bulk") onPick("");
            return;
          }
          onPick(v);
        }}
        disabled={disabled}
      >
        {importMode === "bulk" ? (
          <option value="">No specific state</option>
        ) : (
          <option value="" disabled hidden>
            Select state
          </option>
        )}
        <option value={SUB_PICKER_RETURN}>Main State / Region menu</option>
        {US_STATE_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
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
  );
}

function RegionSubPicker({
  disabled,
  onBack,
  onPick,
}: {
  disabled: boolean;
  onBack: () => void;
  onPick: (name: string) => void;
}) {
  return (
    <div className="relative">
      <select
        key="region-sub"
        className={selectClass}
        defaultValue=""
        onChange={(e) => {
          const v = e.target.value;
          if (v === SUB_PICKER_RETURN) {
            onBack();
            return;
          }
          if (!v) return;
          onPick(v);
        }}
        disabled={disabled}
      >
        <option value="" disabled hidden>
          Select region
        </option>
        <option value={SUB_PICKER_RETURN}>Main State / Region menu</option>
        {MACRO_REGION_OPTIONS.map((s) => (
          <option key={s} value={s}>
            {s}
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
  );
}

type LocationPickerView = "root" | "state" | "region";

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
  /** True when user chose "No State / Region" (valid submit with empty `region`). */
  const [noStateRegionSelected, setNoStateRegionSelected] = useState(false);
  const [locationView, setLocationView] = useState<LocationPickerView>("root");
  const [autoDetectedRegion, setAutoDetectedRegion] = useState(false);
  const [audienceLevel, setAudienceLevel] = useState(DEFAULT_AUDIENCE);
  const [audienceTouched, setAudienceTouched] = useState(false);

  const nameFromFileApplied = useRef(false);
  const regionManuallySelected = useRef(false);

  const years = useMemo(() => {
    const y = new Date().getFullYear();
    return [y - 2, y - 1, y, y + 1];
  }, []);

  const monthYearForPrompt =
    monthName && year !== "" ? `${monthName} ${year}` : "";

  useEffect(() => {
    if (!initialValues) return;
    setEventName(initialValues.eventName);
    const r = initialValues.region;
    setRegion(r);
    setAutoDetectedRegion(false);
    regionManuallySelected.current = Boolean(String(r ?? "").trim());
    setNoStateRegionSelected(!String(r ?? "").trim());
    setLocationView("root");
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
    if (regionManuallySelected.current) return;
    const detected = detectRegionFromEventName(eventName);
    if (
      !detected ||
      (!STATE_REGION_OPTIONS.includes(detected) &&
        !REGION_VALUES.includes(detected as (typeof REGION_VALUES)[number]))
    ) {
      return;
    }
    if (region === detected && !noStateRegionSelected) {
      setAutoDetectedRegion(true);
      return;
    }
    const isDetectedRegion = REGION_PICKER_OPTIONS.includes(
      detected as (typeof REGION_PICKER_OPTIONS)[number],
    );
    if (isDetectedRegion) {
      console.log(`[EventContext] Auto-detected region: ${detected}`);
      setLocationView("region");
      setRegion(detected);
    } else if (US_STATE_OPTIONS.includes(detected)) {
      console.log(`[EventContext] Auto-detected state: ${detected}`);
      setLocationView("state");
      setRegion(detected);
    } else {
      setRegion(detected);
    }
    setNoStateRegionSelected(false);
    setAutoDetectedRegion(true);
  }, [eventName, region, noStateRegionSelected]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventName.trim()) return;
    if (importMode === "event") {
      if (!monthYearForPrompt.trim()) return;
      if (!region.trim() && !noStateRegionSelected) return;
    }
    const eventDateForSubmit =
      importMode === "bulk" && !monthYearForPrompt.trim() ? "" : monthYearForPrompt.trim();
    onSubmit({
      eventName: eventName.trim(),
      eventDate: eventDateForSubmit,
      region: region.trim(),
      audienceLevel: listType === "contacts" ? audienceLevel.trim() : "",
      listType,
      importMode,
    });
  };

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
              {importMode === "event" ? <span className="text-(--color-error)">*</span> : null}
            </span>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="relative">
                <select
                  required={importMode === "event"}
                  className={selectClass}
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
                <span
                  className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-(--text-muted)"
                  aria-hidden
                >
                  ▾
                </span>
              </div>
              <div className="relative">
                <select
                  required={importMode === "event"}
                  className={selectClass}
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
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
              {importMode === "event" ? <span className="text-(--color-error)">*</span> : null}
            </span>
            {region ? (
              <div className="relative">
                <select
                  required={importMode === "event"}
                  className={selectClass}
                  value={region}
                  onChange={(e) => {
                    regionManuallySelected.current = true;
                    const v = e.target.value;
                    if (v === CHANGE_SELECTION) {
                      const isRegionSelection = REGION_PICKER_OPTIONS.includes(
                        region as (typeof REGION_PICKER_OPTIONS)[number],
                      );
                      setRegion("");
                      setNoStateRegionSelected(false);
                      setLocationView(isRegionSelection ? "region" : "state");
                      setAutoDetectedRegion(false);
                      return;
                    }
                    setRegion(v);
                    setNoStateRegionSelected(false);
                    setAutoDetectedRegion(false);
                  }}
                  disabled={disabled}
                >
                  <option value={region}>{region}</option>
                  <option value={CHANGE_SELECTION}>Choose different…</option>
                </select>
                <span
                  className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-(--text-muted)"
                  aria-hidden
                >
                  ▾
                </span>
              </div>
            ) : null}

            {!region && locationView === "root" ? (
              <div className="relative">
                <select
                  className={selectClass}
                  value={
                    importMode === "bulk" && !region
                      ? ""
                      : noStateRegionSelected
                        ? ROOT_NO_STATE_REGION
                        : ""
                  }
                  onChange={(e) => {
                    regionManuallySelected.current = true;
                    const v = e.target.value;
                    if (v === "") {
                      setRegion("");
                      if (importMode === "bulk") {
                        setNoStateRegionSelected(true);
                      } else {
                        setNoStateRegionSelected(false);
                      }
                      setAutoDetectedRegion(false);
                      return;
                    }
                    if (v === ROOT_NO_STATE_REGION) {
                      setRegion("");
                      setNoStateRegionSelected(true);
                      setAutoDetectedRegion(false);
                      return;
                    }
                    setNoStateRegionSelected(false);
                    setAutoDetectedRegion(false);
                    if (v === ROOT_PICK_STATE) setLocationView("state");
                    else if (v === ROOT_PICK_REGION) setLocationView("region");
                  }}
                  disabled={disabled}
                >
                  {importMode === "bulk" ? (
                    <option value="">No specific state</option>
                  ) : (
                    <option value="">Select State / Region</option>
                  )}
                  {importMode === "event" ? (
                    <option value={ROOT_NO_STATE_REGION}>No State / Region</option>
                  ) : null}
                  <option value={ROOT_PICK_STATE}>Select a State →</option>
                  <option value={ROOT_PICK_REGION}>Select a Region →</option>
                </select>
                <span
                  className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-(--text-muted)"
                  aria-hidden
                >
                  ▾
                </span>
              </div>
            ) : null}

            {!region && locationView === "state" ? (
              <StateSubPicker
                importMode={importMode}
                disabled={disabled}
                onBack={() => setLocationView("root")}
                onPick={(name) => {
                  regionManuallySelected.current = true;
                  if (name === "") {
                    setRegion("");
                    setLocationView("root");
                    setNoStateRegionSelected(true);
                    setAutoDetectedRegion(false);
                    return;
                  }
                  setRegion(name);
                  setLocationView("root");
                  setNoStateRegionSelected(false);
                  setAutoDetectedRegion(false);
                }}
              />
            ) : null}

            {!region && locationView === "region" ? (
              <RegionSubPicker
                disabled={disabled}
                onBack={() => setLocationView("root")}
                onPick={(name) => {
                  regionManuallySelected.current = true;
                  setRegion(name);
                  setLocationView("root");
                  setNoStateRegionSelected(false);
                  setAutoDetectedRegion(false);
                }}
              />
            ) : null}
            {autoDetectedRegion && region ? null : null}
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
