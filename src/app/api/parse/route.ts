import { NextResponse } from "next/server";
import {
  findDuplicateWarnings,
  mapSegment,
  splitIntoSegments,
} from "@/lib/parsers/column-mapper";
import { parseCsvToMatrix } from "@/lib/parsers/csv-parser";
import { parseExcelToMatrix } from "@/lib/parsers/excel-parser";
import type { ListType, ParseResponse } from "@/lib/utils/types";

const MAX_BYTES = 5 * 1024 * 1024;

function badRequest(detail: string) {
  return NextResponse.json({ error: "Bad request", detail }, { status: 400 });
}

export async function POST(request: Request): Promise<Response> {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const listTypeField = formData.get("listType");
    const forcedListType: ListType | undefined =
      listTypeField === "companies" || listTypeField === "contacts"
        ? listTypeField
        : undefined;

    if (!(file instanceof File)) {
      return badRequest('Expected multipart field "file" with a file upload.');
    }

    if (file.size > MAX_BYTES) {
      return badRequest("File must be 5 MB or smaller.");
    }

    const lowerName = file.name.toLowerCase();
    if (
      !lowerName.endsWith(".csv") &&
      !lowerName.endsWith(".xlsx") &&
      !lowerName.endsWith(".xls")
    ) {
      return badRequest(
        "Unsupported file type. Please upload a .csv, .xlsx, or .xls file.",
      );
    }

    const buffer = await file.arrayBuffer();
    const matrix = lowerName.endsWith(".csv")
      ? parseCsvToMatrix(new TextDecoder("utf-8").decode(buffer))
      : parseExcelToMatrix(buffer);

    if (matrix.length === 0) {
      return badRequest("That file did not contain any rows.");
    }

    const parsedSegments = splitIntoSegments(matrix);
    const mappedSegments = parsedSegments.map((segment) =>
      mapSegment(segment, forcedListType),
    );

    const primaryIndex = mappedSegments.findIndex((m) => m.rows.length > 0);
    const primary =
      mappedSegments[primaryIndex >= 0 ? primaryIndex : 0] ?? mappedSegments[0];

    if (!primary || primary.rows.length === 0) {
      return badRequest("No data rows were found below the header row.");
    }

    const hasCompanyColumn =
      primary.headers?.some(
        (h) => h === "company" || h === "companyname",
      ) ?? false;
    if (primary.listType === "companies" && !hasCompanyColumn) {
      return badRequest(
        'Company list is missing a Company column (for example "Company" or "Company Name").',
      );
    }

    const warnings: string[] = [];
    if (parsedSegments.length > 1) {
      warnings.push(
        "Multiple header blocks detected — this file may contain more than one event. Choose which segment to preview below.",
      );
    }

    const listTypes = new Set(mappedSegments.map((m) => m.listType));
    if (listTypes.size > 1) {
      warnings.push(
        "Segments appear to use different column layouts or list types. Confirm the list type and the segment you want.",
      );
    }

    const primarySegment =
      parsedSegments[primaryIndex >= 0 ? primaryIndex : 0] ?? parsedSegments[0];

    warnings.push(
      ...findDuplicateWarnings(
        primary.rows,
        primary.listType,
        primarySegment.headerLine,
      ),
    );

    const multiEvent =
      parsedSegments.length > 1
        ? {
            segments: mappedSegments.map((m, idx) => ({
              label: `Event ${idx + 1} (header row ${parsedSegments[idx].headerLine})`,
              headerLine: parsedSegments[idx].headerLine,
              listType: m.listType,
              rows: m.rows,
            })),
          }
        : undefined;

    const body: ParseResponse = {
      listType: primary.listType,
      rows: primary.rows,
      totalRows: primary.rows.length,
      warnings,
      headers: primary.headers,
      multiEvent,
    };

    return NextResponse.json(body);
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Internal server error", detail: String(err) },
      { status: 500 },
    );
  }
}
