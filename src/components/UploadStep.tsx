"use client";

import type { MutableRefObject } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ListType, ParseResponse, RawCompanyRow, RawContactRow } from "@/lib/utils/types";
import { resolveParsedColumnField } from "@/lib/parsers/column-mapper";
import { COMPANY_FIELD_LABELS, CONTACT_FIELD_LABELS } from "@/lib/utils/field-labels";

const ACCEPT = ".csv,.xlsx,.xls,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv";
const PRIMARY_ACTION_BUTTON =
  "rounded-lg bg-(--realm-purple) px-4 py-2 text-sm font-semibold text-white transition-transform duration-75 hover:bg-(--realm-purple-hover) active:scale-95 disabled:cursor-not-allowed disabled:opacity-50";
const UPLOAD_FADE_IN = "animate-[fadeIn_0.3s_ease-in]";

function displayLabelForCanonicalField(field: string, listType: "contacts" | "companies"): string {
  const primary = listType === "companies" ? COMPANY_FIELD_LABELS[field] : CONTACT_FIELD_LABELS[field];
  if (primary) return primary;
  const fallback = listType === "companies" ? CONTACT_FIELD_LABELS[field] : COMPANY_FIELD_LABELS[field];
  return fallback ?? field;
}

function rowDedupKey(row: RawCompanyRow | RawContactRow, kind: "companies" | "contacts"): string {
  if (kind === "companies") return `c:${(row as RawCompanyRow).rawName?.trim().toLowerCase() ?? ""}`;
  const c = row as RawContactRow;
  const em = c.email?.trim().toLowerCase() ?? "";
  if (em) return `e:${em}`;
  return `n:${c.firstName?.trim() ?? ""}|${c.lastName?.trim() ?? ""}|${c.company?.trim() ?? ""}`;
}

function listAllDuplicatePairs(
  rows: Array<RawCompanyRow | RawContactRow>,
  kind: "companies" | "contacts",
  exempt: Set<string>,
): [number, number][] {
  const out: [number, number][] = [];
  const groups = new Map<string, number[]>();
  for (let i = 0; i < rows.length; i++) {
    const k = rowDedupKey(rows[i]!, kind);
    const list = groups.get(k) ?? [];
    list.push(i);
    groups.set(k, list);
  }
  for (const indices of groups.values()) {
    if (indices.length < 2) continue;
    for (let u = 0; u < indices.length; u++) {
      for (let v = u + 1; v < indices.length; v++) {
        const a = indices[u]!; const b = indices[v]!;
        if (!exempt.has(`${a}-${b}`)) out.push([a, b]);
      }
    }
  }
  return out;
}

function findFirstDuplicatePair(
  rows: Array<RawCompanyRow | RawContactRow>,
  kind: "companies" | "contacts",
  exempt: Set<string>,
): [number, number] | null {
  const all = listAllDuplicatePairs(rows, kind, exempt);
  return all.length > 0 ? all[0]! : null;
}

function removeAllDuplicateRows(
  rows: Array<RawCompanyRow | RawContactRow>,
  kind: "companies" | "contacts",
): { rows: Array<RawCompanyRow | RawContactRow>; removed: number } {
  const seen = new Set<string>();
  const out: Array<RawCompanyRow | RawContactRow> = [];
  for (const row of rows) {
    const k = rowDedupKey(row, kind);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(row);
  }
  return { rows: out, removed: rows.length - out.length };
}

function duplicateDisplayName(row: RawCompanyRow | RawContactRow, kind: "companies" | "contacts"): string {
  if (kind === "companies") return (row as RawCompanyRow).rawName?.trim() ?? "";
  const c = row as RawContactRow;
  return `${c.firstName?.trim() ?? ""} ${c.lastName?.trim() ?? ""}`.trim();
}

interface UploadStepProps {
  wizardImportMode: "event" | "bulk";
  bulkSmallListBypass: boolean;
  file: File | null;
  busy: boolean;
  error: string | null;
  result: ParseResponse | null;
  showSuccessFlash: boolean;
  effectiveListType: ListType;
  effectiveRowCount: number;
  resolvedListType: "companies" | "contacts" | null;
  workingRows: Array<RawCompanyRow | RawContactRow>;
  displayRows: Array<RawCompanyRow | RawContactRow>;
  previewRowsOverride: Array<RawCompanyRow | RawContactRow> | null;
  activeNormalizedHeaders: string[];
  activeOriginalHeaders: string[];
  duplicateExemptPairs: Set<string>;
  dupFeedback: "removed" | "kept" | null;
  duplicateSessionTotal: number | null;
  removeAllDupConfirm: string | null;
  removeAllDupMsgTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  onFiles: (files: FileList | null) => void;
  parseFile: (f: File, listType?: "companies" | "contacts") => Promise<void>;
  startNewImport: () => void;
  setStep: (s: "upload" | "context" | "starter") => void;
  setPreviewRowsOverride: (rows: Array<RawCompanyRow | RawContactRow> | null) => void;
  setDuplicateExemptPairs: (s: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  setDupFeedback: (f: "removed" | "kept" | null) => void;
  setRemoveAllDupConfirm: (s: string | null) => void;
  setBulkSmallListBypass: (b: boolean) => void;
  resetToUpload: (clearSession?: boolean) => void;
}

export function UploadStep({
  wizardImportMode, bulkSmallListBypass, file, busy, error, result, showSuccessFlash,
  effectiveListType, effectiveRowCount, resolvedListType,
  workingRows, displayRows, previewRowsOverride,
  activeNormalizedHeaders, activeOriginalHeaders,
  duplicateExemptPairs, dupFeedback, duplicateSessionTotal, removeAllDupConfirm,
  removeAllDupMsgTimeoutRef,
  onFiles, parseFile, startNewImport, setStep,
  setPreviewRowsOverride, setDuplicateExemptPairs, setDupFeedback,
  setRemoveAllDupConfirm, setBulkSmallListBypass, resetToUpload,
}: UploadStepProps) {
  const showBulkSmallListWarning =
    wizardImportMode === "bulk" && effectiveRowCount > 0 && effectiveRowCount < 200 && !bulkSmallListBypass;

  const [switchConfirm, setSwitchConfirm] = useState<string | null>(null);
  const switchConfirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (switchConfirmTimerRef.current) clearTimeout(switchConfirmTimerRef.current);
  }, []);

  const mappingListType: "contacts" | "companies" = useMemo(() => {
    if (resolvedListType) return resolvedListType;
    if (effectiveListType === "companies") return "companies";
    return "contacts";
  }, [resolvedListType, effectiveListType]);

  const columnMappingRows = useMemo(() => {
    const n = Math.max(activeOriginalHeaders.length, activeNormalizedHeaders.length);
    const rows: Array<{
      originalHeader: string;
      normalized: string;
      mappedField: string | null;
    }> = [];
    for (let i = 0; i < n; i++) {
      const originalHeader = activeOriginalHeaders[i] ?? "";
      const normalized = activeNormalizedHeaders[i] ?? "";
      const target = resolveParsedColumnField(normalized, mappingListType);
      if (target === "ignore") continue;
      rows.push({
        originalHeader: originalHeader.trim() || normalized || "(empty)",
        normalized,
        mappedField: target,
      });
    }
    return rows;
  }, [activeOriginalHeaders, activeNormalizedHeaders, mappingListType]);

  const duplicatePair = useMemo((): [number, number] | null => {
    if (!resolvedListType) return null;
    return findFirstDuplicatePair(workingRows, resolvedListType, duplicateExemptPairs);
  }, [workingRows, resolvedListType, duplicateExemptPairs]);

  const remainingDuplicatePairsCount = useMemo(() => {
    if (!resolvedListType) return 0;
    return listAllDuplicatePairs(workingRows, resolvedListType, duplicateExemptPairs).length;
  }, [workingRows, resolvedListType, duplicateExemptPairs]);

  const duplicatePairSerial =
    duplicateSessionTotal != null && remainingDuplicatePairsCount > 0
      ? duplicateSessionTotal - remainingDuplicatePairsCount + 1
      : 1;

  return (
    <div className="flex w-full flex-1 flex-col justify-center py-8">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        {!result ? (
          <button type="button" onClick={() => setStep("starter")} className="self-start text-sm text-(--text-muted) hover:text-(--text-primary)">
            ← Back
          </button>
        ) : null}

        {!result && (
          <section
            className={`relative flex min-h-55 w-full cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-(--border-default) bg-(--bg-card) px-6 py-10 transition-colors ${busy ? "opacity-80" : "hover:border-(--realm-purple) hover:bg-(--bg-muted)"}`}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); onFiles(e.dataTransfer.files); }}
          >
            <input className="absolute inset-0 cursor-pointer opacity-0" type="file" accept={ACCEPT} disabled={busy} onChange={(e) => onFiles(e.target.files)} aria-label="Upload CSV or Excel file" />
            <div className="pointer-events-none text-center">
              <p className="text-base font-medium text-(--text-primary)">Drop a file here, or click to browse</p>
              <p className="mt-2 text-sm text-(--text-muted)">Accepted: .csv, .xlsx, .xls — max 5 MB</p>
            </div>
          </section>
        )}

        {error && (
          <div className="w-full rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-100" role="alert">
            {error}
          </div>
        )}

        {result && file && showSuccessFlash && (
          <div className={`flex w-full flex-col items-center justify-center py-16 ${UPLOAD_FADE_IN}`} role="status" aria-live="polite">
            <span className="text-7xl leading-none text-green-500" aria-hidden>✓</span>
            <p className={`mt-4 text-base font-medium text-(--text-primary) ${UPLOAD_FADE_IN}`}>File uploaded successfully</p>
          </div>
        )}

        {result && file && !showSuccessFlash && showBulkSmallListWarning && (
          <section className={`flex w-full flex-col gap-6 rounded-xl border border-(--border-default) bg-(--bg-card) p-5 shadow-(--shadow-card) sm:p-6 ${UPLOAD_FADE_IN}`}>
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-100" role="status">
              <p>This list has fewer than 200 records. Consider using Marketing Event List mode instead.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className="rounded-lg border border-amber-800/25 bg-white px-3 py-1.5 text-sm font-medium text-amber-950 hover:bg-amber-100 dark:border-amber-600/40 dark:bg-amber-900/50 dark:text-amber-50 dark:hover:bg-amber-900/80" onClick={() => resetToUpload(false)}>← Back</button>
                <button type="button" className={`${PRIMARY_ACTION_BUTTON} px-3 py-1.5 text-xs`} onClick={() => setBulkSmallListBypass(true)}>Continue Anyway</button>
              </div>
            </div>
          </section>
        )}

        {result && file && !showSuccessFlash && !showBulkSmallListWarning && (
          <section className={`flex w-full flex-col gap-6 rounded-xl border border-(--border-default) bg-(--bg-card) p-5 shadow-(--shadow-card) sm:p-6 ${UPLOAD_FADE_IN}`}>
            <div className="flex w-full flex-wrap items-start gap-3 text-sm text-(--text-primary)">
              <div className="min-w-0 flex-1 flex flex-col gap-1">
                <p>
                  ✓ <span className="font-semibold">{file.name}</span>
                </p>
                <p>
                  {effectiveRowCount} row{effectiveRowCount === 1 ? "" : "s"} detected as{" "}
                  <span className="font-semibold">
                    {effectiveListType === "companies"
                      ? "Companies"
                      : effectiveListType === "contacts"
                        ? "Contacts"
                        : "Unknown"}
                  </span>
                </p>
              </div>
            </div>

            {duplicatePair && resolvedListType ? (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-100" role="status">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 flex-1 text-sm font-bold">
                    Duplicate found: &quot;{duplicateDisplayName(workingRows[duplicatePair[0]]!, resolvedListType)}&quot;
                  </p>
                  {duplicateSessionTotal != null && duplicateSessionTotal > 1 ? (
                    <p className="shrink-0 text-xs text-amber-900/60 dark:text-amber-200/70">{duplicatePairSerial} of {duplicateSessionTotal} duplicates</p>
                  ) : null}
                </div>
                <div className="mt-3 flex w-full flex-wrap items-center justify-between gap-2 gap-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" className="rounded-lg border border-amber-700/30 bg-white px-3 py-1.5 text-sm font-medium text-amber-950 hover:bg-amber-100 dark:border-amber-600/40 dark:bg-amber-900/50 dark:text-amber-50 dark:hover:bg-amber-900/80"
                      onClick={() => {
                        const [a, b] = duplicatePair;
                        const removeIndex = Math.max(a, b);
                        const base = previewRowsOverride ?? displayRows;
                        setPreviewRowsOverride(base.filter((_, i) => i !== removeIndex));
                        setDupFeedback("removed");
                      }}
                    >
                      Remove Duplicate
                    </button>
                    <button type="button" className="rounded-lg border border-amber-700/30 bg-white px-3 py-1.5 text-sm font-medium text-amber-950 hover:bg-amber-100 dark:border-amber-600/40 dark:bg-amber-900/50 dark:text-amber-50 dark:hover:bg-amber-900/80"
                      onClick={() => {
                        setDuplicateExemptPairs((prev) => new Set(prev).add(`${duplicatePair[0]}-${duplicatePair[1]}`));
                        setDupFeedback("kept");
                      }}
                    >
                      Keep Both
                    </button>
                  </div>
                  {remainingDuplicatePairsCount > 1 ? (
                    <button type="button" className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-600 hover:border-red-400 hover:bg-red-50 dark:border-red-700/50 dark:bg-zinc-950 dark:text-red-400 dark:hover:border-red-500 dark:hover:bg-red-950/30"
                      onClick={() => {
                        if (!resolvedListType) return;
                        const base = previewRowsOverride ?? displayRows;
                        const pairCountBefore = listAllDuplicatePairs(base, resolvedListType, duplicateExemptPairs).length;
                        const bannerTotal = duplicateSessionTotal ?? pairCountBefore;
                        const { rows: next } = removeAllDuplicateRows(base, resolvedListType);
                        setPreviewRowsOverride(next);
                        setDuplicateExemptPairs(new Set());
                        setDupFeedback(null);
                        if (removeAllDupMsgTimeoutRef.current) clearTimeout(removeAllDupMsgTimeoutRef.current);
                        const dupWord = bannerTotal === 1 ? "duplicate" : "duplicates";
                        setRemoveAllDupConfirm(`Removed ${bannerTotal} ${dupWord} from this import.`);
                        removeAllDupMsgTimeoutRef.current = setTimeout(() => { setRemoveAllDupConfirm(null); removeAllDupMsgTimeoutRef.current = null; }, 4000);
                      }}
                    >
                      Remove All Duplicates
                    </button>
                  ) : null}
                </div>

                {dupFeedback ? (
                  <p className="mt-2 text-xs text-amber-800 dark:text-amber-200">
                    {dupFeedback === "removed" ? "Removed the later duplicate row from this import." : "Kept both rows for this pair."}
                  </p>
                ) : null}
              </div>
            ) : null}

            {removeAllDupConfirm ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950 dark:border-emerald-800/50 dark:bg-emerald-950/35 dark:text-emerald-100" role="status" aria-live="polite">
                {removeAllDupConfirm}
              </div>
            ) : null}

            <div className="overflow-x-auto rounded-lg border border-(--border-default) bg-(--bg-muted)/40">
              <table className="min-w-full border-separate border-spacing-0 text-left text-xs">
                <thead className="bg-(--bg-muted) text-(--text-secondary)">
                  <tr>
                    <th className="border-b border-(--border-default) px-3 py-1.5 font-semibold text-(--text-secondary)">Your Column</th>
                    <th className="border-b border-(--border-default) px-3 py-1.5 font-semibold text-(--text-secondary)">Mapped To</th>
                  </tr>
                </thead>
                <tbody>
                  {columnMappingRows.map((row, idx) => (
                    <tr
                      key={`${row.normalized}-${idx}`}
                      className={idx % 2 === 0 ? "bg-(--bg-card)" : "bg-(--bg-muted)/60"}
                    >
                      <td className="border-b border-(--border-default) px-3 py-1.5 text-(--text-secondary) wrap-break-word">
                        {row.originalHeader}
                      </td>
                      <td className="border-b border-(--border-default) px-3 py-1.5 wrap-break-word">
                        {row.mappedField ? (
                          <span className="text-(--text-primary)">
                            → {displayLabelForCanonicalField(row.mappedField, mappingListType)}
                          </span>
                        ) : (
                          <span className="text-amber-800/90 dark:text-amber-200/90">
                            Column not recognized — visible during review, not pushed to HubSpot
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {mappingListType === "contacts" ? (
              <p className="text-xs text-(--text-muted)">
                If your CSV has a combined name column (e.g. &quot;Full Name&quot;, &quot;Attendee Name&quot;), the tool will automatically split it into first and last name.
              </p>
            ) : null}

            {effectiveListType === "unknown" ? (
              <div className="text-xs text-(--text-muted)">We couldn&apos;t automatically detect whether this is a contact or company list. Please select below:</div>
            ) : null}
            {effectiveListType === "unknown" ? (
              <div className="flex gap-2">
                <button type="button" disabled={busy} className={`${PRIMARY_ACTION_BUTTON} px-3 py-1.5 text-xs`} onClick={() => { if (!file) return; void parseFile(file, "companies"); }}>Company list</button>
                <button type="button" disabled={busy} className={`${PRIMARY_ACTION_BUTTON} px-3 py-1.5 text-xs`} onClick={() => { if (!file) return; void parseFile(file, "contacts"); }}>Contact list</button>
              </div>
            ) : null}
            {(effectiveListType === "contacts" || effectiveListType === "companies") ? (
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  disabled={busy}
                  className="self-start text-xs text-(--text-muted) hover:text-(--text-primary) underline"
                  onClick={() => {
                    if (!file) return;
                    const nextType = effectiveListType === "contacts" ? "companies" : "contacts";
                    if (switchConfirmTimerRef.current) clearTimeout(switchConfirmTimerRef.current);
                    setSwitchConfirm(nextType === "companies" ? "Switched to Companies — column mapping updated." : "Switched to Contacts — column mapping updated.");
                    switchConfirmTimerRef.current = setTimeout(() => setSwitchConfirm(null), 3000);
                    void parseFile(file, nextType);
                  }}
                >
                  Switch to {effectiveListType === "contacts" ? "Companies" : "Contacts"}
                </button>
                {switchConfirm ? (
                  <p className="text-xs text-(--text-muted)">{switchConfirm}</p>
                ) : null}
              </div>
            ) : null}

            {!showBulkSmallListWarning ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button type="button" className="text-sm font-medium text-(--realm-purple) hover:text-(--realm-purple-hover) hover:underline" onClick={startNewImport}>Change File</button>
                <button type="button" disabled={!resolvedListType || effectiveRowCount === 0} onClick={() => setStep("context")} className={PRIMARY_ACTION_BUTTON}>
                  Continue →
                </button>
              </div>
            ) : null}
          </section>
        )}
      </div>
    </div>
  );
}
