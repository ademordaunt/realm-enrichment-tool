import type { ListType, RawCompanyRow, RawContactRow } from "@/lib/utils/types";

/** Lowercase, trim, strip non-alphanumeric for header matching */
export function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

const CONTACT_HEADER_MAP: Record<string, keyof RawContactRow | "ignore"> = {
  first: "firstName",
  firstname: "firstName",
  last: "lastName",
  lastname: "lastName",
  notes: "membershipNotes",
  membershipnotes: "membershipNotes",
  title: "title",
  company: "company",
  hq: "location",
  location: "location",
  email: "email",
  leadsource: "leadSource",
  leadsourcedescription: "leadSourceDescription",
  leadorigination: "ignore",
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
    "first",
    "firstname",
    "last",
    "lastname",
    "email",
    "company",
    "title",
    "location",
    "hq",
    "notes",
    "membershipnotes",
    "leadsource",
    "leadsourcedescription",
    "leadorigination",
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
    nonempty.includes("first") || nonempty.includes("firstname");
  const hasLast = nonempty.includes("last") || nonempty.includes("lastname");
  const hasEmail = nonempty.includes("email");
  const onlyCompany =
    nonempty.length === 1 && nonempty[0] === "company";

  if (onlyCompany || (nonempty.every((h) => h === "company") && nonempty.length >= 1)) {
    return "companies";
  }

  const contactPattern = hasFirst && hasLast && (hasEmail || nonempty.includes("title"));
  if (contactPattern) {
    return "contacts";
  }

  if (nonempty.includes("company") && !hasFirst && !hasLast) {
    return "companies";
  }

  if (hasFirst && hasLast) {
    return "contacts";
  }

  return "unknown";
}

function mapCompanyRow(
  headers: string[],
  values: string[],
): { row: RawCompanyRow; missingCompany: boolean } {
  const normalized = headers.map(normalizeHeader);
  const companyIdx = normalized.findIndex((h) => h === "company");
  const rawName =
    companyIdx >= 0 ? (values[companyIdx] ?? "").trim() : "";

  const row: RawCompanyRow = { rawName };
  for (let i = 0; i < headers.length; i++) {
    const key = normalizeHeader(headers[i]);
    if (!key) continue;
    const val = (values[i] ?? "").trim();
    if (key === "company") continue;
    row[key] = val;
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
    const cur = row[field];
    if (cur === undefined || cur === "") {
      (row as Record<string, string | undefined>)[field] = val;
    } else if (val) {
      row[nh] = val;
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
  if (normalizedHeaders.filter(Boolean).length === 1 && normalizedHeaders.includes("company")) {
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
