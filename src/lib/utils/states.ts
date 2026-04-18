/** US state abbreviation → full name (50 states + DC). */
const US_STATE_ABBR: Record<string, string> = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
  DC: "District of Columbia",
};

const FULL_NAME_SET = new Set(Object.values(US_STATE_ABBR));

/**
 * Expands a two-letter US state code to the full state name.
 * If the value already matches a known full name (case-insensitive), returns the canonical full name.
 * Otherwise returns the trimmed input unchanged (e.g. "National", "International", multi-word regions).
 */
export function expandStateAbbreviation(abbr: string): string {
  const raw = abbr.trim();
  if (!raw) return "";

  if (raw.length === 2) {
    const upper = raw.toUpperCase();
    const expanded = US_STATE_ABBR[upper];
    if (expanded) return expanded;
  }

  const lower = raw.toLowerCase();
  for (const full of FULL_NAME_SET) {
    if (full.toLowerCase() === lower) return full;
  }

  return raw;
}

/** Options for State/Region dropdown (National, International, then 50 states + DC, A–Z). */
export const STATE_REGION_OPTIONS: readonly string[] = [
  "National",
  "International",
  ...Object.values(US_STATE_ABBR).sort((a, b) => a.localeCompare(b)),
];
