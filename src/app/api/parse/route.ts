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

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const listTypeField = formData.get("listType");
    const forcedListType: ListType | undefined =
      listTypeField === "companies" || listTypeField === "contacts"
        ? listTypeField
        : undefined;

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: 'Expected multipart field "file" with a file upload.' },
        { status: 400 },
      );
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: "File must be 5 MB or smaller." },
        { status: 400 },
      );
    }

    const lowerName = file.name.toLowerCase();
    if (
      !lowerName.endsWith(".csv") &&
      !lowerName.endsWith(".xlsx") &&
      !lowerName.endsWith(".xls")
    ) {
      return NextResponse.json(
        {
          error:
            "Unsupported file type. Please upload a .csv, .xlsx, or .xls file.",
        },
        { status: 400 },
      );
    }

    const buffer = await file.arrayBuffer();
    const matrix = lowerName.endsWith(".csv")
      ? parseCsvToMatrix(new TextDecoder("utf-8").decode(buffer))
      : parseExcelToMatrix(buffer);

    if (matrix.length === 0) {
      return NextResponse.json(
        { error: "That file did not contain any rows." },
        { status: 400 },
      );
    }

    const parsedSegments = splitIntoSegments(matrix);
    const mappedSegments = parsedSegments.map((segment) =>
      mapSegment(segment, forcedListType),
    );

    const primaryIndex = mappedSegments.findIndex((m) => m.rows.length > 0);
    const primary =
      mappedSegments[primaryIndex >= 0 ? primaryIndex : 0] ?? mappedSegments[0];

    if (!primary || primary.rows.length === 0) {
      return NextResponse.json(
        { error: "No data rows were found below the header row." },
        { status: 400 },
      );
    }

    if (
      primary.listType === "companies" &&
      !primary.headers?.includes("company")
    ) {
      return NextResponse.json(
        {
          error:
            "Company list is missing a Company column (for example \"Company:\").",
        },
        { status: 400 },
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
    const message =
      err instanceof Error ? err.message : "Unexpected error while parsing.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
