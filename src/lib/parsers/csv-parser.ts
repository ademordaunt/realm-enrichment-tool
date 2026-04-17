import Papa from "papaparse";

/** Trim cells, strip BOM from first cell, drop fully empty rows */
function normalizeMatrix(rows: string[][]): string[][] {
  const out: string[][] = [];
  for (const row of rows) {
    const cells = row.map((c) => String(c ?? "").trim());
    if (cells[0]?.length) {
      cells[0] = cells[0].replace(/^\uFEFF/, "");
    }
    if (cells.every((c) => c === "")) continue;
    out.push(cells);
  }
  return out;
}

/**
 * Parse CSV text into a 2D string matrix (no header inference).
 * Empty lines are removed; blank separator rows between events are dropped.
 */
export function parseCsvToMatrix(contents: string): string[][] {
  const parsed = Papa.parse<string[]>(contents, {
    delimiter: ",",
    header: false,
    skipEmptyLines: true,
  });

  if (parsed.errors.length > 0) {
    const fatal = parsed.errors.find((e) => e.type === "Quotes");
    if (fatal) {
      throw new Error(fatal.message || "Failed to parse CSV");
    }
  }

  const data = (parsed.data as string[][]).filter(
    (row) => Array.isArray(row) && row.length > 0,
  );
  return normalizeMatrix(data);
}
