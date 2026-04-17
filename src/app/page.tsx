"use client";

import { EventContextForm } from "@/components/EventContextForm";
import { EnrichmentProgress } from "@/components/EnrichmentProgress";
import type {
  EnrichedCompany,
  EnrichedContact,
  EventContext,
  ListType,
  ParseResponse,
  RawCompanyRow,
  RawContactRow,
} from "@/lib/utils/types";
import { useCallback, useMemo, useState } from "react";

const ACCEPT = ".csv,.xlsx,.xls,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv";

type Step = "upload" | "context" | "enriching" | "verifying" | "enriched";

function collectKeys(rows: Array<RawCompanyRow | RawContactRow>, maxScan: number): string[] {
  const keys = new Set<string>();
  for (let i = 0; i < Math.min(rows.length, maxScan); i++) {
    Object.keys(rows[i] ?? {}).forEach((k) => keys.add(k));
  }
  return Array.from(keys).sort();
}

function confidenceBadgeClass(score: string): string {
  switch (score) {
    case "high":
      return "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-100";
    case "medium":
      return "bg-amber-100 text-amber-950 dark:bg-amber-950/50 dark:text-amber-100";
    case "low":
      return "bg-orange-100 text-orange-950 dark:bg-orange-950/50 dark:text-orange-100";
    case "unresolved":
      return "bg-red-100 text-red-900 dark:bg-red-950/50 dark:text-red-100";
    default:
      return "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200";
  }
}

type NdjsonEvent =
  | { type: "progress"; start: number; end: number; total: number }
  | {
      type: "done";
      listType: "companies" | "contacts";
      rows: EnrichedCompany[] | EnrichedContact[];
    }
  | { type: "error"; message: string };

async function consumeEnrichmentNdjson(
  res: Response,
  onProgress: (e: { start: number; end: number; total: number }) => void,
): Promise<{
  rows: EnrichedCompany[] | EnrichedContact[];
  rawNdjson: string;
}> {
  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error("No response body from enrichment.");
  }
  const decoder = new TextDecoder();
  let buffer = "";
  let rawNdjson = "";
  let result: EnrichedCompany[] | EnrichedContact[] | null = null;

  const handleLine = (line: string) => {
    const t = line.trim();
    if (!t) return;
    const msg = JSON.parse(t) as NdjsonEvent;
    if (msg.type === "progress") {
      onProgress({ start: msg.start, end: msg.end, total: msg.total });
    } else if (msg.type === "error") {
      throw new Error(msg.message);
    } else if (msg.type === "done") {
      result = msg.rows;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (value) {
      const chunk = decoder.decode(value, { stream: true });
      rawNdjson += chunk;
      buffer += chunk;
    }
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      handleLine(line);
    }
    if (done) {
      break;
    }
  }
  if (buffer.trim()) {
    handleLine(buffer.trim());
  }
  if (!result) {
    throw new Error("Enrichment finished without a result payload.");
  }
  return { rows: result, rawNdjson };
}

function companyRowsMissingCoreFields(rows: EnrichedCompany[]): boolean {
  return rows.some(
    (row) =>
      !("domain" in row) ||
      !("state" in row) ||
      !("numberOfEmployees" in row) ||
      !("linkedinUrl" in row),
  );
}

export default function Home() {
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enrichError, setEnrichError] = useState<string | null>(null);
  const [result, setResult] = useState<ParseResponse | null>(null);
  const [listOverride, setListOverride] = useState<"companies" | "contacts" | null>(null);
  const [segmentIndex, setSegmentIndex] = useState(0);

  const [progress, setProgress] = useState<{
    startRow: number;
    endRow: number;
    totalRows: number;
  } | null>(null);

  const [enriched, setEnriched] = useState<EnrichedCompany[] | EnrichedContact[] | null>(null);
  const [enrichedListType, setEnrichedListType] = useState<"companies" | "contacts" | null>(
    null,
  );

  const parseFile = useCallback(
    async (f: File, listType?: "companies" | "contacts") => {
      setBusy(true);
      setError(null);
      try {
        const body = new FormData();
        body.append("file", f);
        if (listType) {
          body.append("listType", listType);
        }
        const res = await fetch("/api/parse", {
          method: "POST",
          body,
        });
        const json = (await res.json()) as ParseResponse & { error?: string };
        if (!res.ok) {
          setResult(null);
          setError(json.error ?? `Request failed (${res.status})`);
          return;
        }
        if ("error" in json && json.error) {
          setResult(null);
          setError(json.error);
          return;
        }
        setResult(json);
        setSegmentIndex(0);
        setStep("upload");
        setEnriched(null);
        setEnrichedListType(null);
        if (json.listType !== "unknown") {
          setListOverride(null);
        }
      } catch (e) {
        setResult(null);
        setError(e instanceof Error ? e.message : "Failed to upload file.");
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const onFiles = useCallback(
    (files: FileList | null) => {
      const f = files?.[0];
      if (!f) return;
      setFile(f);
      setListOverride(null);
      void parseFile(f);
    },
    [parseFile],
  );

  const effectiveListType: ListType = useMemo(() => {
    if (!result) return "unknown";
    if (result.multiEvent?.segments?.length) {
      const seg = result.multiEvent.segments[segmentIndex];
      if (seg?.listType && seg.listType !== "unknown") {
        return seg.listType;
      }
    }
    if (result.listType === "unknown" && listOverride) {
      return listOverride;
    }
    return result.listType;
  }, [listOverride, result, segmentIndex]);

  const resolvedListType: "companies" | "contacts" | null = useMemo(() => {
    if (effectiveListType === "companies" || effectiveListType === "contacts") {
      return effectiveListType;
    }
    return null;
  }, [effectiveListType]);

  const displayRows = useMemo(() => {
    if (!result) return [];
    if (result.multiEvent?.segments?.length) {
      const seg = result.multiEvent.segments[segmentIndex];
      return seg?.rows ?? result.rows;
    }
    return result.rows;
  }, [result, segmentIndex]);

  const displayTotal = displayRows.length;

  const previewKeys = useMemo(
    () => collectKeys(displayRows, 100),
    [displayRows],
  );

  const previewSample = useMemo(() => displayRows.slice(0, 25), [displayRows]);

  const subtitle = useMemo(() => {
    switch (step) {
      case "upload":
        return "Step 1 — Upload a lead list (.csv, .xlsx, or .xls)";
      case "context":
        return "Step 2 — Event context";
      case "enriching":
        return "Step 3 — AI enrichment";
      case "verifying":
        return "Step 4 — ZoomInfo & Common Room";
      case "enriched":
        return "Step 5 — Enrichment results";
      default:
        return "";
    }
  }, [step]);

  const runZoomVerify = async (
    aiRows: EnrichedCompany[] | EnrichedContact[],
    listType: "companies" | "contacts",
  ): Promise<EnrichedCompany[] | EnrichedContact[]> => {
    setStep("verifying");
    setProgress({
      startRow: 1,
      endRow: 1,
      totalRows: aiRows.length,
    });
    const res = await fetch("/api/enrich/zoominfo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: aiRows, listType }),
    });
    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(errBody.error ?? `Verification failed (${res.status})`);
    }
    const { rows } = await consumeEnrichmentNdjson(res, (p) => {
      setProgress({
        startRow: p.start,
        endRow: p.end,
        totalRows: p.total,
      });
    });
    return rows;
  };

  const runEnrichment = async (context: EventContext) => {
    if (!resolvedListType) return;
    setEnrichError(null);
    setStep("enriching");
    setProgress({
      startRow: 1,
      endRow: Math.min(10, displayRows.length),
      totalRows: displayRows.length,
    });
    try {
      const res = await fetch("/api/enrich/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: displayRows,
          listType: resolvedListType,
          context,
        }),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errBody.error ?? `Enrichment failed (${res.status})`);
      }
      const { rows: aiRows, rawNdjson } = await consumeEnrichmentNdjson(res, (p) => {
        setProgress({
          startRow: p.start,
          endRow: p.end,
          totalRows: p.total,
        });
      });
      if (resolvedListType === "companies") {
        const companyRows = aiRows as EnrichedCompany[];
        if (companyRowsMissingCoreFields(companyRows)) {
          console.log("[enrich/ai] full raw NDJSON response (missing domain/state/numberOfEmployees/linkedinUrl on some rows):", rawNdjson);
        }
      }

      let finalRows: EnrichedCompany[] | EnrichedContact[] = aiRows;
      try {
        finalRows = await runZoomVerify(aiRows, resolvedListType);
      } catch (verifyErr) {
        setEnrichError(
          verifyErr instanceof Error ? verifyErr.message : "ZoomInfo / Common Room step failed.",
        );
        finalRows = aiRows;
      }

      setEnriched(finalRows);
      setEnrichedListType(resolvedListType);
      setStep("enriched");
    } catch (e) {
      setEnrichError(e instanceof Error ? e.message : "Enrichment failed.");
      setStep("context");
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="flex min-h-full flex-1 flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      <header className="border-b border-zinc-200 bg-white px-6 py-5 dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-xl font-semibold tracking-tight">Realm Enrichment Tool</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{subtitle}</p>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
        {step === "upload" && (
          <section
            className={`relative flex min-h-[220px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 transition-colors ${
              busy
                ? "border-zinc-200 bg-zinc-100/60 dark:border-zinc-700 dark:bg-zinc-900/40"
                : "border-zinc-300 bg-white hover:border-zinc-400 hover:bg-zinc-50/80 dark:border-zinc-600 dark:bg-zinc-900/40 dark:hover:border-zinc-500"
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onFiles(e.dataTransfer.files);
            }}
          >
            <input
              className="absolute inset-0 cursor-pointer opacity-0"
              type="file"
              accept={ACCEPT}
              disabled={busy}
              onChange={(e) => onFiles(e.target.files)}
              aria-label="Upload CSV or Excel file"
            />
            <div className="pointer-events-none text-center">
              <p className="text-base font-medium">Drop a file here, or click to browse</p>
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                Accepted: .csv, .xlsx, .xls — max 5 MB
              </p>
            </div>
          </section>
        )}

        {step !== "upload" && file && (
          <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
            <span className="font-medium text-zinc-700 dark:text-zinc-300">{file.name}</span>
            <span className="text-zinc-500 dark:text-zinc-400">
              {" "}
              — {displayTotal} rows — {resolvedListType ?? "unknown list type"}
            </span>
            <button
              type="button"
              className="ml-3 text-blue-600 hover:underline dark:text-blue-400"
              onClick={() => {
                setStep("upload");
                setEnriched(null);
                setEnrichedListType(null);
              }}
            >
              Change file
            </button>
          </div>
        )}

        {busy && step === "upload" && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400" role="status">
            Parsing…
          </p>
        )}

        {error && (
          <div
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-100"
            role="alert"
          >
            {error}
          </div>
        )}

        {result && file && step === "upload" && (
          <section className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">File</p>
                <p className="text-base font-semibold">{file.name}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Rows parsed</p>
                <p className="text-base font-semibold tabular-nums">{displayTotal}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-zinc-600 dark:text-zinc-400">Detected list type:</span>
              <span className="rounded-full bg-zinc-100 px-3 py-1 text-sm font-medium dark:bg-zinc-800">
                {result.listType === "unknown" ? "Unknown" : result.listType}
              </span>
            </div>

            {result.listType === "unknown" && (
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-950/50">
                <p className="text-sm font-medium">This file does not match a known header pattern.</p>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                  Choose how to interpret the columns, then apply to re-parse.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                      listOverride === "companies"
                        ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                        : "bg-white ring-1 ring-zinc-300 hover:bg-zinc-100 dark:bg-zinc-900 dark:ring-zinc-600 dark:hover:bg-zinc-800"
                    }`}
                    onClick={() => setListOverride("companies")}
                  >
                    Company list
                  </button>
                  <button
                    type="button"
                    className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                      listOverride === "contacts"
                        ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                        : "bg-white ring-1 ring-zinc-300 hover:bg-zinc-100 dark:bg-zinc-900 dark:ring-zinc-600 dark:hover:bg-zinc-800"
                    }`}
                    onClick={() => setListOverride("contacts")}
                  >
                    Contact list
                  </button>
                  <button
                    type="button"
                    disabled={!listOverride || busy}
                    className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => {
                      if (!file || !listOverride) return;
                      void parseFile(file, listOverride);
                    }}
                  >
                    Apply &amp; re-parse
                  </button>
                </div>
              </div>
            )}

            {result.multiEvent?.segments && result.multiEvent.segments.length > 1 && (
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium" htmlFor="segment">
                  Segment (multi-event file)
                </label>
                <select
                  id="segment"
                  className="max-w-md rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-950"
                  value={segmentIndex}
                  onChange={(e) => setSegmentIndex(Number(e.target.value))}
                >
                  {result.multiEvent.segments.map((s, i) => (
                    <option key={`${s.label}-${i}`} value={i}>
                      {s.label} — {s.rows.length} rows
                    </option>
                  ))}
                </select>
              </div>
            )}

            {result.warnings.length > 0 && (
              <div className="flex flex-col gap-2">
                {result.warnings.map((w) => (
                  <div
                    key={w}
                    className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-700/80 dark:bg-amber-950/40 dark:text-amber-100"
                    role="status"
                  >
                    {w}
                  </div>
                ))}
              </div>
            )}

            <div>
              <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                Raw preview (first {previewSample.length} of {displayTotal} rows)
              </h2>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Showing effective list type:{" "}
                <span className="font-medium text-zinc-700 dark:text-zinc-300">
                  {effectiveListType}
                </span>
              </p>
              <div className="mt-3 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
                <table className="min-w-full border-collapse text-left text-xs sm:text-sm">
                  <thead className="bg-zinc-100 dark:bg-zinc-800/80">
                    <tr>
                      {previewKeys.map((k) => (
                        <th
                          key={k}
                          className="whitespace-nowrap border-b border-zinc-200 px-3 py-2 font-semibold dark:border-zinc-700"
                        >
                          {k}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewSample.map((row, ri) => (
                      <tr
                        key={ri}
                        className={
                          ri % 2 === 0 ? "bg-white dark:bg-zinc-900" : "bg-zinc-50/80 dark:bg-zinc-900/60"
                        }
                      >
                        {previewKeys.map((k) => (
                          <td
                            key={k}
                            className="border-b border-zinc-100 px-3 py-2 text-zinc-800 dark:border-zinc-800 dark:text-zinc-200"
                          >
                            {(row as Record<string, string | undefined>)[k] ?? ""}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-end border-t border-zinc-100 pt-4 dark:border-zinc-800">
              <button
                type="button"
                disabled={!resolvedListType || displayTotal === 0}
                onClick={() => setStep("context")}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Continue to event context
              </button>
            </div>
          </section>
        )}

        {step === "context" && resolvedListType && (
          <>
            {enrichError && (
              <div
                className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-100"
                role="alert"
              >
                {enrichError}
              </div>
            )}
            <EventContextForm
              listType={resolvedListType}
              onSubmit={(ctx) => void runEnrichment(ctx)}
            />
          </>
        )}

        {step === "enriching" && progress && (
          <EnrichmentProgress
            startRow={progress.startRow}
            endRow={progress.endRow}
            totalRows={progress.totalRows}
          />
        )}

        {step === "verifying" && (
          <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100" role="status">
              Verifying with ZoomInfo and Common Room…
            </p>
            {progress && (
              <EnrichmentProgress
                startRow={progress.startRow}
                endRow={progress.endRow}
                totalRows={progress.totalRows}
              />
            )}
          </div>
        )}

        {step === "enriched" && enriched && enrichedListType && (
          <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              Enrichment results
            </h2>
            {enrichError && (
              <div
                className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-700/80 dark:bg-amber-950/40 dark:text-amber-100"
                role="status"
              >
                {enrichError}
              </div>
            )}
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              {enriched.length} {enrichedListType === "companies" ? "companies" : "contacts"} — AI
              enrichment{enrichError ? "" : ", ZoomInfo, and Common Room"} applied
              {enrichError ? " (ZoomInfo / Common Room step failed; showing AI results)." : "."}
            </p>
            <div className="mt-4 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
              <table className="min-w-full border-collapse text-left text-xs sm:text-sm">
                <thead className="bg-zinc-100 dark:bg-zinc-800/80">
                  <tr>
                    <th className="border-b border-zinc-200 px-3 py-2 font-semibold dark:border-zinc-700">
                      Raw input
                    </th>
                    <th className="border-b border-zinc-200 px-3 py-2 font-semibold dark:border-zinc-700">
                      Resolved
                    </th>
                    <th className="border-b border-zinc-200 px-3 py-2 font-semibold dark:border-zinc-700">
                      Domain
                    </th>
                    <th className="border-b border-zinc-200 px-3 py-2 font-semibold dark:border-zinc-700">
                      State
                    </th>
                    <th className="border-b border-zinc-200 px-3 py-2 font-semibold dark:border-zinc-700">
                      Employees
                    </th>
                    <th className="border-b border-zinc-200 px-3 py-2 font-semibold dark:border-zinc-700">
                      LinkedIn URL
                    </th>
                    <th className="border-b border-zinc-200 px-3 py-2 font-semibold dark:border-zinc-700">
                      Confidence
                    </th>
                    <th className="border-b border-zinc-200 px-3 py-2 font-semibold dark:border-zinc-700">
                      AI reasoning
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {enrichedListType === "companies"
                    ? (enriched as EnrichedCompany[]).map((row) => (
                        <tr
                          key={row.id}
                          className="border-b border-zinc-100 dark:border-zinc-800"
                        >
                          <td className="px-3 py-2 align-top text-zinc-800 dark:text-zinc-200">
                            {row.rawInput}
                          </td>
                          <td className="px-3 py-2 align-top text-zinc-800 dark:text-zinc-200">
                            {row.resolvedName}
                          </td>
                          <td className="max-w-[10rem] break-words px-3 py-2 align-top text-zinc-800 dark:text-zinc-200">
                            {"domain" in row ? row.domain : ""}
                          </td>
                          <td className="px-3 py-2 align-top text-zinc-800 dark:text-zinc-200">
                            {"state" in row ? row.state : ""}
                          </td>
                          <td className="px-3 py-2 align-top tabular-nums text-zinc-800 dark:text-zinc-200">
                            {"numberOfEmployees" in row && row.numberOfEmployees != null
                              ? row.numberOfEmployees
                              : ""}
                          </td>
                          <td className="max-w-[12rem] break-all px-3 py-2 align-top text-xs text-zinc-800 dark:text-zinc-200">
                            {"linkedinUrl" in row ? row.linkedinUrl : ""}
                          </td>
                          <td className="px-3 py-2 align-top">
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${confidenceBadgeClass(row.confidenceScore)}`}
                            >
                              {row.confidenceScore}
                            </span>
                          </td>
                          <td className="max-w-md px-3 py-2 align-top text-zinc-700 dark:text-zinc-300">
                            {row.aiReasoning}
                          </td>
                        </tr>
                      ))
                    : (enriched as EnrichedContact[]).map((row) => (
                        <tr
                          key={row.id}
                          className="border-b border-zinc-100 dark:border-zinc-800"
                        >
                          <td className="px-3 py-2 align-top text-zinc-800 dark:text-zinc-200">
                            {[row.firstName, row.lastName].filter(Boolean).join(" ")}
                            {row.rawEmail ? (
                              <>
                                <br />
                                <span className="text-zinc-500">{row.rawEmail}</span>
                              </>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 align-top text-zinc-800 dark:text-zinc-200">
                            {row.resolvedEmail}
                            <br />
                            <span className="text-zinc-500">{row.resolvedCompany}</span>
                          </td>
                          <td className="max-w-[10rem] break-words px-3 py-2 align-top text-zinc-800 dark:text-zinc-200">
                            {"companyDomain" in row ? row.companyDomain : ""}
                          </td>
                          <td className="px-3 py-2 align-top text-zinc-800 dark:text-zinc-200">
                            {"location" in row ? row.location : ""}
                          </td>
                          <td className="px-3 py-2 align-top text-zinc-500 dark:text-zinc-400">
                            —
                          </td>
                          <td className="max-w-[12rem] break-all px-3 py-2 align-top text-xs text-zinc-800 dark:text-zinc-200">
                            {"linkedinUrl" in row ? row.linkedinUrl : ""}
                          </td>
                          <td className="px-3 py-2 align-top">
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${confidenceBadgeClass(row.confidenceScore)}`}
                            >
                              {row.confidenceScore}
                            </span>
                          </td>
                          <td className="max-w-md px-3 py-2 align-top text-zinc-700 dark:text-zinc-300">
                            {row.aiReasoning}
                          </td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
