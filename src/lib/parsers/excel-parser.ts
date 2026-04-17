import * as XLSX from "xlsx";

/**
 * Parse first worksheet of an Excel workbook into a 2D string matrix.
 */
export function parseExcelToMatrix(buffer: ArrayBuffer): string[][] {
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return [];
  }
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<(string | number | boolean | null | undefined)[]>(
    sheet,
    {
      header: 1,
      defval: "",
      raw: false,
    },
  );

  const stringRows: string[][] = [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const cells = row.map((c) => {
      if (c === null || c === undefined) return "";
      return String(c).trim();
    });
    if (cells.every((c) => c === "")) continue;
    stringRows.push(cells);
  }
  return stringRows;
}
