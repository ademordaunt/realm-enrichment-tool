import type { ListType, RawCompanyRow, RawContactRow } from "@/lib/utils/types";

const US_STATE_ABBREVS = new Set([
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
  "DC",
]);

/** Strips Gartner-style US state/region suffixes from company name strings. */
export function extractCompanyAndState(raw: string): { name: string; state: string } {
  const usPattern = /\s*-\s*US\s*-\s*([A-Z]{2})\d*\s*$/i;
  const dashPattern = /\s+-\s+([A-Z]{2})\s*$/i;
  const trailingPattern = /\s+([A-Z]{2})\s*$/i;

  const patterns = [usPattern, dashPattern, trailingPattern] as const;
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match?.[1] && US_STATE_ABBREVS.has(match[1]!.toUpperCase())) {
      return {
        name: raw.replace(pattern, "").trim(),
        state: match[1]!.toUpperCase(),
      };
    }
  }

  return { name: raw.trim(), state: "" };
}

/**
 * Parses a combined "City, ST" location field into city and state parts.
 * If the part after the last comma is a valid 2-letter US state abbreviation,
 * sets city from the left part and state from the right. Otherwise stores the
 * full string as location with no extracted state.
 */
export function parseLocation(location: string): { city: string; state: string; location: string } {
  const raw = location.trim();
  if (!raw) return { city: "", state: "", location: "" };
  const lastComma = raw.lastIndexOf(",");
  if (lastComma >= 0) {
    const right = raw.slice(lastComma + 1).trim().toUpperCase();
    if (US_STATE_ABBREVS.has(right)) {
      return { city: raw.slice(0, lastComma).trim(), state: right, location: raw };
    }
  }
  return { city: "", state: "", location: raw };
}

function isCompanyHeader(h: string): boolean {
  return (
    h === "company" ||
    h === "companyname" ||
    h === "organization" ||
    h === "org" ||
    h === "account" ||
    h === "accountname" ||
    h === "employer"
  );
}

/** Lowercase, trim, strip non-alphanumeric for header matching */
export function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

const CONTACT_HEADER_MAP: Record<string, keyof RawContactRow | "ignore" | "fullName"> = {
  // Combined full name (auto-split into firstName + lastName)
  name: "fullName",
  fullname: "fullName",
  attendeename: "fullName",
  participantname: "fullName",
  attendee: "fullName",
  contactname: "fullName",
  // First name
  first: "firstName",
  firstname: "firstName",
  givenname: "firstName",
  fname: "firstName",
  // Last name
  last: "lastName",
  lastname: "lastName",
  surname: "lastName",
  lname: "lastName",
  // Notes
  notes: "membershipNotes",
  membershipnotes: "membershipNotes",
  repnotes: "membershipNotes",
  realmnotes: "membershipNotes",
  johnsnotes: "membershipNotes",
  comments: "membershipNotes",
  // Title
  title: "title",
  jobtitle: "title",
  position: "title",
  role: "title",
  // Company
  company: "company",
  companyname: "company",
  organization: "company",
  org: "company",
  account: "company",
  accountname: "company",
  employer: "company",
  // Location
  hq: "location",
  location: "location",
  // Email
  email: "email",
  emailaddress: "email",
  businessemail: "email",
  workemail: "email",
  corporateemail: "email",
  contactemail: "email",
  primaryemail: "email",
  // LinkedIn
  linkedincontactprofileurl: "linkedinUrl",
  linkedinprofileurl: "linkedinUrl",
  linkedinurl: "linkedinUrl",
  linkedinprofile: "linkedinUrl",
  linkedincontacturl: "linkedinUrl",
  linkedin: "linkedinUrl",
  liurl: "linkedinUrl",
  // Phone
  phone: "phone",
  phonenumber: "phone",
  phonenum: "phone",
  mobile: "phone",
  cell: "phone",
  mobilephone: "phone",
  // Lead source
  leadsource: "leadSource",
  leadsourcedescription: "leadSourceDescription",
  leadorigination: "ignore",
  // Event fields
  attended: "attended",
  attendance: "attended",
  didattend: "attended",
  format: "eventFormat",
  eventformat: "eventFormat",
  attendancetype: "eventFormat",
  // Pre-enriched company fields
  domain: "companyDomain",
  companydomain: "companyDomain",
  companydomainname: "companyDomain",
  website: "companyDomain",
  web: "companyDomain",
  state: "state",
  stateregion: "state",
  region: "state",
  province: "state",
  employees: "employees",
  numberofemployees: "employees",
  numemployees: "employees",
  employeecount: "employees",
  headcount: "employees",
  industry: "industry",
  primaryindustry: "industry",
  sector: "industry",
  vertical: "industry",
};

function padRow(row: string[], len: number): string[] {
  const next = row.slice(0, len);
  while (next.length < len) next.push("");
  return next;
}

function isEmptyRow(row: string[]): boolean {
  return row.every((c) => c.trim() === "");
}

/** Heuristic: row resembles a header (labels, not typical data). */
function rowLooksLikeHeaderRow(row: string[]): boolean {
  const cells = row.map(normalizeHeader).filter(Boolean);
  if (cells.length < 2) return false;
  const keywords = new Set([
    // Name fields
    "first", "firstname", "givenname", "fname",
    "last", "lastname", "surname", "lname",
    "name", "fullname", "attendeename", "participantname", "attendee", "contactname",
    // Email fields
    "email", "emailaddress", "businessemail", "workemail",
    "corporateemail", "contactemail", "primaryemail",
    // LinkedIn
    "linkedincontactprofileurl", "linkedinprofileurl", "linkedinurl",
    "linkedinprofile", "linkedincontacturl", "linkedin", "liurl",
    // Company
    "company", "companyname", "organization", "org", "account", "accountname", "employer",
    // Job
    "title", "jobtitle", "position", "role",
    // Phone
    "phone", "phonenumber", "phonenum", "mobile", "cell", "mobilephone",
    // Location
    "location", "hq", "state", "stateregion", "region", "province",
    // Notes
    "notes", "membershipnotes", "repnotes", "realmnotes", "johnsnotes", "comments",
    // Lead source
    "leadsource", "leadsourcedescription", "leadorigination",
    // Event fields
    "attended", "attendance", "didattend", "format", "eventformat", "attendancetype",
    // Pre-enriched
    "domain", "companydomain", "website", "web",
    "employees", "numberofemployees", "numemployees", "employeecount", "headcount",
    "industry", "primaryindustry", "sector", "vertical",
  ]);
  const hits = cells.filter((c) => keywords.has(c)).length;
  return hits >= 3 && hits >= Math.ceil(cells.length * 0.35);
}

/** Row likely contains contact data (e.g. email with @). */
function rowLooksLikeContactData(row: string[]): boolean {
  if (row.some((c) => c.includes("@"))) return true;
  const joined = row.join(" ").toLowerCase();
  if (joined.includes("@")) return true;
  return false;
}

function headersRoughlyEqual(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const maxLen = Math.max(a.length, b.length);
  const na = padRow(a, maxLen).map(normalizeHeader);
  const nb = padRow(b, maxLen).map(normalizeHeader);
  let matches = 0;
  let nonempty = 0;
  for (let i = 0; i < maxLen; i++) {
    if (na[i] === "" && nb[i] === "") continue;
    nonempty++;
    if (na[i] !== "" && na[i] === nb[i]) matches++;
  }
  if (nonempty === 0) return false;
  return matches / nonempty >= 0.85;
}

export interface ParsedSegment {
  headerRow: string[];
  /** 1-based line index in the parsed matrix (matrix[headerIndex] === headerRow) */
  headerLine: number;
  dataRows: string[][];
}

/**
 * Split a matrix when a second header block appears mid-file (multi-event CSVs).
 */
export function splitIntoSegments(matrix: string[][]): ParsedSegment[] {
  if (matrix.length === 0) return [];
  const segments: ParsedSegment[] = [];
  let header = matrix[0];
  let headerLine = 1;
  const dataRows: string[][] = [];
  let i = 1;

  const flush = () => {
    segments.push({
      headerRow: header,
      headerLine,
      dataRows: dataRows.splice(0, dataRows.length),
    });
  };

  while (i < matrix.length) {
    const row = matrix[i];
    if (isEmptyRow(row)) {
      i++;
      continue;
    }

    const duplicateHeader =
      dataRows.length > 0 &&
      (headersRoughlyEqual(row, matrix[0]) || headersRoughlyEqual(row, header));

    const newHeaderBlock =
      dataRows.length > 0 &&
      rowLooksLikeHeaderRow(row) &&
      !rowLooksLikeContactData(row) &&
      !duplicateHeader;

    if (duplicateHeader || newHeaderBlock) {
      flush();
      header = row;
      headerLine = i + 1;
      i++;
      continue;
    }

    dataRows.push(row);
    i++;
  }

  flush();
  return segments;
}

export function detectListType(normalizedHeaders: string[]): ListType {
  const nonempty = normalizedHeaders.filter(Boolean);
  if (nonempty.length === 0) return "unknown";

  const hasFirst =
    nonempty.includes("first") || nonempty.includes("firstname") ||
    nonempty.includes("givenname") || nonempty.includes("fname");
  const hasLast =
    nonempty.includes("last") || nonempty.includes("lastname") ||
    nonempty.includes("surname") || nonempty.includes("lname");
  const hasEmail =
    nonempty.includes("email") ||
    nonempty.includes("emailaddress") ||
    nonempty.includes("businessemail") ||
    nonempty.includes("workemail") ||
    nonempty.includes("corporateemail") ||
    nonempty.includes("contactemail") ||
    nonempty.includes("primaryemail");
  const onlyCompany =
    nonempty.length === 1 && isCompanyHeader(nonempty[0]!);

  if (
    onlyCompany ||
    (nonempty.every((h) => isCompanyHeader(h)) && nonempty.length >= 1)
  ) {
    return "companies";
  }

  const contactPattern = hasFirst && hasLast && (hasEmail || nonempty.includes("title") || nonempty.includes("jobtitle"));
  if (contactPattern) {
    return "contacts";
  }

  if (
    nonempty.some((h) => isCompanyHeader(h)) &&
    !hasFirst &&
    !hasLast
  ) {
    return "companies";
  }

  if (hasFirst && hasLast) {
    return "contacts";
  }

  return "unknown";
}

const COMPANY_ENRICHED_ALIASES: Record<string, keyof RawCompanyRow> = {
  domain: "domain",
  companydomain: "domain",
  companydomainname: "domain",
  website: "domain",
  web: "domain",
  state: "state",
  stateregion: "state",
  region: "state",
  employees: "employees",
  numberofemployees: "employees",
  numemployees: "employees",
  employeecount: "employees",
  headcount: "employees",
  industry: "industry",
  primaryindustry: "industry",
  sector: "industry",
  vertical: "industry",
  linkedinurl: "linkedinUrl",
  linkedincompanyurl: "linkedinUrl",
  linkedincompanypage: "linkedinUrl",
  linkedincompanyprofileurl: "linkedinUrl",
  linkedinprofileurl: "linkedinUrl",
  linkedin: "linkedinUrl",
  liurl: "linkedinUrl",
};

/**
 * Canonical field key for an uploaded column (for mapping preview UI).
 * Returns `"ignore"` for columns that should be omitted from mapping tables;
 * `null` when the column is not recognized (stored on the row under the normalized header only).
 */
export function resolveParsedColumnField(
  normalizedHeader: string,
  listType: "contacts" | "companies",
): "ignore" | null | string {
  const nh = normalizedHeader.trim();
  if (!nh) return null;
  if (listType === "companies") {
    if (isCompanyHeader(nh)) return "rawName";
    const typed = COMPANY_ENRICHED_ALIASES[nh];
    if (typed) return typed as string;
    return null;
  }
  const f = CONTACT_HEADER_MAP[nh];
  if (f === "ignore") return "ignore";
  if (f === "fullName") return "fullName";
  if (f) return f as string;
  return null;
}

function mapCompanyRow(
  headers: string[],
  values: string[],
): { row: RawCompanyRow; missingCompany: boolean } {
  const normalized = headers.map(normalizeHeader);
  const companyIdx = normalized.findIndex((h) => isCompanyHeader(h));
  const rawValue =
    companyIdx >= 0 ? (values[companyIdx] ?? "").trim() : "";
  const { name: cleanedName, state: extractedState } =
    extractCompanyAndState(rawValue);

  const row: RawCompanyRow = { rawName: cleanedName };
  for (let i = 0; i < headers.length; i++) {
    const key = normalizeHeader(headers[i]);
    if (!key) continue;
    const val = (values[i] ?? "").trim();
    if (isCompanyHeader(key)) continue;

    // Map pre-enriched columns to typed fields
    const typedField = COMPANY_ENRICHED_ALIASES[key];
    if (typedField) {
      if (!row[typedField] && val) {
        row[typedField] = val;
      }
      continue;
    }

    row[key] = val;
  }
  if (extractedState && !row.state) {
    row.state = extractedState;
  }
  return { row, missingCompany: companyIdx < 0 };
}

function mapContactRow(headers: string[], values: string[]): RawContactRow {
  const row: RawContactRow = { firstName: "", lastName: "" };
  for (let i = 0; i < headers.length; i++) {
    const nh = normalizeHeader(headers[i]);
    if (!nh) continue;
    const val = (values[i] ?? "").trim();
    const field = CONTACT_HEADER_MAP[nh];
    if (field === "ignore" || field === undefined) {
      if (val) row[nh] = val;
      continue;
    }
    const cur = (row as Record<string, string | undefined>)[field];
    if (cur === undefined || cur === "") {
      (row as Record<string, string | undefined>)[field] = val;
    } else if (val) {
      row[nh] = val;
    }
  }

  // Handle combined name columns (fullName sentinel → firstName + lastName)
  const fullName = (row as Record<string, string | undefined>)["fullName"];
  if (fullName?.trim() && !row.firstName?.trim() && !row.lastName?.trim()) {
    const name = fullName.trim();
    // Strip leading honorifics (case-insensitive, with or without period)
    const honorifics = /^(dr\.?|mr\.?|mrs\.?|ms\.?|prof\.?|sr\.?|jr\.?)\s+/i;
    const stripped = name.replace(honorifics, "").trim();

    if (stripped.includes(",")) {
      // "Last, First" format
      const commaIdx = stripped.indexOf(",");
      const lastName = stripped.slice(0, commaIdx).trim();
      const firstName = stripped.slice(commaIdx + 1).trim();
      row.firstName = firstName;
      row.lastName = lastName;
    } else {
      const parts = stripped.split(/\s+/).filter(Boolean);
      if (parts.length === 0) {
        // nothing to split
      } else if (parts.length === 1) {
        row.firstName = parts[0]!;
        row.lastName = "";
      } else {
        row.firstName = parts[0]!;
        row.lastName = parts.slice(1).join(" ");
      }
    }
  }
  // Remove the fullName sentinel from the row — it's parsing-only
  delete (row as Record<string, string | undefined>)["fullName"];

  // Parse "City, ST" location field into city + state components
  if (row.location?.trim()) {
    const parsed = parseLocation(row.location);
    if (parsed.state && !row.state) {
      row.state = parsed.state;
    }
  }

  return row;
}

export interface MappedSegment {
  listType: ListType;
  rows: Array<RawCompanyRow | RawContactRow>;
  headers: string[];
  missingRequired: boolean;
}

function inferListTypeFromFirstRow(
  headers: string[],
  values: string[],
  normalizedHeaders: string[],
): ListType {
  const { row: companyRow, missingCompany } = mapCompanyRow(headers, values);
  const contactRow = mapContactRow(headers, values);
  const hasNameParts =
    contactRow.firstName.trim() !== "" || contactRow.lastName.trim() !== "";
  const hasCompanyName = companyRow.rawName.trim() !== "" && !missingCompany;

  if (hasNameParts && !hasCompanyName) return "contacts";
  if (hasCompanyName && !hasNameParts) return "companies";
  if (
    normalizedHeaders.filter(Boolean).length === 1 &&
    normalizedHeaders.some((h) => isCompanyHeader(h))
  ) {
    return "companies";
  }
  if (hasNameParts) return "contacts";
  if (hasCompanyName) return "companies";
  return "unknown";
}

export function mapSegment(
  segment: ParsedSegment,
  forcedListType?: ListType,
): MappedSegment {
  const headers = segment.headerRow.map((h) => h.trim());
  const normalizedHeaders = headers.map(normalizeHeader);

  let listType: ListType =
    forcedListType && forcedListType !== "unknown"
      ? forcedListType
      : detectListType(normalizedHeaders);

  const firstData = segment.dataRows.find(
    (r) => !padRow(r, headers.length).every((v) => v.trim() === ""),
  );
  if (listType === "unknown" && firstData) {
    const inferred = inferListTypeFromFirstRow(
      headers,
      padRow(firstData, headers.length),
      normalizedHeaders,
    );
    if (inferred !== "unknown") {
      listType = inferred;
    }
  }

  /** How to map cells when headers alone are ambiguous */
  let mappingMode: "companies" | "contacts" =
    listType === "companies" ? "companies" : "contacts";

  if (listType === "unknown") {
    mappingMode = "contacts";
  }

  const rows: Array<RawCompanyRow | RawContactRow> = [];
  let missingRequired = false;

  for (const rawValues of segment.dataRows) {
    const values = padRow(rawValues, headers.length);
    if (values.every((v) => v.trim() === "")) continue;

    if (mappingMode === "companies") {
      const { row, missingCompany } = mapCompanyRow(headers, values);
      if (missingCompany) missingRequired = true;
      rows.push(row);
    } else {
      rows.push(mapContactRow(headers, values));
    }
  }

  return { listType, rows, headers: normalizedHeaders, missingRequired };
}

function stableSerialize(
  row: RawCompanyRow | RawContactRow,
  listType: ListType,
): string {
  if (listType === "companies") {
    const r = row as RawCompanyRow;
    const keys = Object.keys(r).sort();
    return JSON.stringify(keys.map((k) => [k, r[k]]));
  }
  const r = row as RawContactRow;
  const keys = Object.keys(r).sort() as (keyof RawContactRow)[];
  return JSON.stringify(keys.map((k) => [k, r[k]]));
}

export function findDuplicateWarnings(
  rows: Array<RawCompanyRow | RawContactRow>,
  listType: ListType,
  headerLine: number,
): string[] {
  const warnings: string[] = [];
  const effectiveList: ListType =
    listType === "unknown" ? "contacts" : listType;
  const indexMap = new Map<string, number[]>();
  rows.forEach((row, idx) => {
    const key = stableSerialize(row, effectiveList);
    const list = indexMap.get(key) ?? [];
    list.push(idx);
    indexMap.set(key, list);
  });

  for (const [, indices] of indexMap) {
    if (indices.length < 2) continue;
    const a = indices[0] + 1;
    const b = indices[1] + 1;
    const lineA = headerLine + 1 + indices[0];
    const lineB = headerLine + 1 + indices[1];
    warnings.push(
      `Duplicate rows detected: data rows ${a} and ${b} are identical (file lines ~${lineA} and ~${lineB}).`,
    );
  }
  return warnings;
}
