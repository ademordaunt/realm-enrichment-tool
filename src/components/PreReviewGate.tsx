"use client";

import type { EnrichedCompany, EnrichedContact } from "@/lib/utils/types";
import {
  detectDuplicateContactGroups,
  detectDuplicateGroups,
  PREREVIEW_DUPLICATE_THRESHOLD,
  PREREVIEW_INTL_GOV_THRESHOLD,
} from "@/lib/utils/prereview";
import { useCallback, useLayoutEffect, useMemo, useState } from "react";

const PRIMARY_ACTION_BUTTON =
  "rounded-lg bg-[#7B35C1] px-4 py-2 text-sm font-medium text-white hover:bg-[#6A2AAD] disabled:cursor-not-allowed disabled:opacity-50";

const cardClass =
  "rounded-xl border border-(--border-default) bg-(--bg-card) p-6 shadow-(--shadow-card) sm:p-8";

export interface PreReviewGateProps {
  rows: EnrichedCompany[] | EnrichedContact[];
  listType: "companies" | "contacts";
  onContinue: (updatedRows: EnrichedCompany[] | EnrichedContact[]) => void;
}

function keepFirstInEachDuplicateGroupCompanies(
  working: EnrichedCompany[],
  dupMap: Map<string, EnrichedCompany[]>,
): EnrichedCompany[] {
  const indexById = new Map(working.map((r, i) => [r.id, i] as const));
  const toRemove = new Set<string>();
  for (const group of dupMap.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort(
      (a, b) => (indexById.get(a.id) ?? 0) - (indexById.get(b.id) ?? 0),
    );
    for (let i = 1; i < sorted.length; i++) {
      toRemove.add(sorted[i]!.id);
    }
  }
  return working.filter((r) => !toRemove.has(r.id));
}

function keepFirstInEachDuplicateGroupContacts(
  working: EnrichedContact[],
  dupMap: Map<string, EnrichedContact[]>,
): EnrichedContact[] {
  const indexById = new Map(working.map((r, i) => [r.id, i] as const));
  const toRemove = new Set<string>();
  for (const group of dupMap.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort(
      (a, b) => (indexById.get(a.id) ?? 0) - (indexById.get(b.id) ?? 0),
    );
    for (let i = 1; i < sorted.length; i++) {
      toRemove.add(sorted[i]!.id);
    }
  }
  return working.filter((r) => !toRemove.has(r.id));
}

export function PreReviewGate({ rows, listType, onContinue }: PreReviewGateProps) {
  const [working, setWorking] = useState(rows);
  const [expandIntl, setExpandIntl] = useState(false);
  const [expandDup, setExpandDup] = useState(false);

  const summary = useMemo(() => {
    if (listType === "companies") {
      const w = working as EnrichedCompany[];
      const intlGovCount = w.filter(
        (r) =>
          r.exclusionReason === "international" || r.exclusionReason === "government",
      ).length;
      const dupGroupCount = detectDuplicateGroups(w).size;
      return {
        showIntlGov: intlGovCount >= PREREVIEW_INTL_GOV_THRESHOLD,
        showDup: dupGroupCount >= PREREVIEW_DUPLICATE_THRESHOLD,
        intlGovCount,
        dupGroupCount,
      };
    }
    const w = working as EnrichedContact[];
    const dupGroupCount = detectDuplicateContactGroups(w).size;
    return {
      showIntlGov: false,
      showDup: dupGroupCount >= PREREVIEW_DUPLICATE_THRESHOLD,
      intlGovCount: 0,
      dupGroupCount,
    };
  }, [listType, working]);

  const needGate = summary.showIntlGov || summary.showDup;

  useLayoutEffect(() => {
    setWorking(rows);
  }, [rows]);

  const onRemoveAllFlagged = useCallback(() => {
    if (listType !== "companies") return;
    const w = working as EnrichedCompany[];
    setWorking(
      w.filter(
        (r) =>
          r.exclusionReason !== "international" && r.exclusionReason !== "government",
      ),
    );
  }, [listType, working]);

  const onKeepFirstDup = useCallback(() => {
    if (listType === "companies") {
      const w = working as EnrichedCompany[];
      const dupMap = detectDuplicateGroups(w);
      setWorking(keepFirstInEachDuplicateGroupCompanies(w, dupMap));
    } else {
      const w = working as EnrichedContact[];
      const dupMap = detectDuplicateContactGroups(w);
      setWorking(keepFirstInEachDuplicateGroupContacts(w, dupMap));
    }
  }, [listType, working]);

  const recordLabel = listType === "companies" ? "companies" : "contacts";

  const handleContinue = () => {
    onContinue(working);
  };

  const intlGovRowsUnique = (() => {
    if (listType !== "companies") return [] as { row: EnrichedCompany; tags: string }[];
    const w = working as EnrichedCompany[];
    return w
      .filter(
        (r) =>
          r.exclusionReason === "international" || r.exclusionReason === "government",
      )
      .map((row) => ({
        row,
        tags:
          row.exclusionReason === "international"
            ? "International"
            : row.exclusionReason === "government"
              ? "Government"
              : "",
      }));
  })();

  const companyDupMap =
    listType === "companies" ? detectDuplicateGroups(working as EnrichedCompany[]) : null;
  const contactDupMap =
    listType === "contacts" ? detectDuplicateContactGroups(working as EnrichedContact[]) : null;

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 py-10">
      <div className={cardClass}>
        <h1 className="text-lg font-semibold text-(--realm-navy) sm:text-xl">Pre-Review</h1>
        <p className="mt-2 text-sm text-(--text-muted)">
          {working.length} {recordLabel} will be reviewed
        </p>

        {summary.showIntlGov && listType === "companies" ? (
          <div className="mt-6 border-t border-(--border-default) pt-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-(--text-primary)">
                🌍 International &amp; Government Companies
                <span className="ml-2 text-(--text-muted) font-normal">
                  [{summary.intlGovCount} {summary.intlGovCount === 1 ? "company" : "companies"}]
                </span>
              </h2>
            </div>
            <p className="mt-1 text-sm text-(--text-muted)">
              Companies that appear to be outside your ICP.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setExpandIntl((e) => !e)}
                className="rounded-lg border border-(--border-default) bg-(--bg-page) px-3 py-1.5 text-sm font-medium text-(--text-primary) hover:bg-(--bg-muted)"
              >
                {expandIntl ? "▴ Hide list" : "▾ Show list"}
              </button>
              <button
                type="button"
                onClick={onRemoveAllFlagged}
                className="rounded-lg border border-(--border-default) bg-(--bg-page) px-3 py-1.5 text-sm font-medium text-(--text-primary) hover:bg-(--bg-muted)"
              >
                Remove All
              </button>
            </div>
            {expandIntl ? (
              <ul className="mt-3 max-h-48 space-y-2 overflow-y-auto text-sm text-(--text-primary)">
                {intlGovRowsUnique.map(({ row, tags }) => (
                  <li key={row.id} className="border-b border-(--border-default) border-dotted pb-2 last:border-0">
                    <span className="font-medium">{row.resolvedName || row.rawInput}</span>
                    <span className="text-(--text-muted)"> — {tags}</span>
                    <div className="text-xs text-(--text-muted)">
                      {row.state ? `State: ${row.state}` : null}
                      {row.state && row.domain ? " · " : null}
                      {row.domain ? `Domain: ${row.domain}` : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {summary.showDup ? (
          <div className="mt-6 border-t border-(--border-default) pt-6">
            <h2 className="text-sm font-semibold text-(--text-primary)">
              ⚠️ {listType === "companies" ? "Duplicate Domains" : "Duplicate emails"}
              <span className="ml-2 text-(--text-muted) font-normal">
                [{summary.dupGroupCount} {summary.dupGroupCount === 1 ? "group" : "groups"}]
              </span>
            </h2>
            <p className="mt-1 text-sm text-(--text-muted)">
              {listType === "companies"
                ? "Multiple companies resolving to the same domain. Only the first will be pushed to HubSpot."
                : "Multiple contacts with the same resolved email. Only the first will be pushed to HubSpot."}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setExpandDup((e) => !e)}
                className="rounded-lg border border-(--border-default) bg-(--bg-page) px-3 py-1.5 text-sm font-medium text-(--text-primary) hover:bg-(--bg-muted)"
              >
                {expandDup ? "▴ Hide list" : "▾ Show list"}
              </button>
              <button
                type="button"
                onClick={onKeepFirstDup}
                className="rounded-lg border border-(--border-default) bg-(--bg-page) px-3 py-1.5 text-sm font-medium text-(--text-primary) hover:bg-(--bg-muted)"
              >
                Keep First of Each
              </button>
            </div>
            {expandDup
              ? listType === "companies" && companyDupMap
                ? (() => {
                    const w = working as EnrichedCompany[];
                    const order = new Map(w.map((r, i) => [r.id, i] as const));
                    return (
                      <ul className="mt-3 max-h-48 space-y-3 overflow-y-auto text-sm text-(--text-primary)">
                        {Array.from(companyDupMap.entries()).map(([key, group]) => (
                          <li key={key} className="border-b border-(--border-default) pb-2 last:border-0">
                            <div className="text-xs font-semibold uppercase text-(--text-muted)">
                              {key}
                            </div>
                            <ul className="mt-1 space-y-1 pl-2">
                              {[...group]
                                .sort(
                                  (a, b) =>
                                    (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
                                )
                                .map((r, idx) => (
                                  <li key={r.id}>
                                    {idx === 0 ? "kept — " : "duplicate — "}
                                    {r.resolvedName || r.rawInput}
                                  </li>
                                ))}
                            </ul>
                          </li>
                        ))}
                      </ul>
                    );
                  })()
                : listType === "contacts" && contactDupMap
                  ? (() => {
                      const w = working as EnrichedContact[];
                      const order = new Map(w.map((r, i) => [r.id, i] as const));
                      return (
                        <ul className="mt-3 max-h-48 space-y-3 overflow-y-auto text-sm text-(--text-primary)">
                          {Array.from(contactDupMap.entries()).map(([key, group]) => (
                            <li key={key} className="border-b border-(--border-default) pb-2 last:border-0">
                              <div className="text-xs font-semibold uppercase text-(--text-muted)">
                                {key}
                              </div>
                              <ul className="mt-1 space-y-1 pl-2">
                                {[...group]
                                  .sort(
                                    (a, b) =>
                                      (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
                                  )
                                  .map((r, idx) => (
                                    <li key={r.id}>
                                      {idx === 0 ? "kept — " : "duplicate — "}
                                      {r.firstName} {r.lastName} — {r.resolvedEmail}
                                    </li>
                                  ))}
                              </ul>
                            </li>
                          ))}
                        </ul>
                      );
                    })()
                  : null
              : null}
          </div>
        ) : null}

        <div className="mt-8 flex justify-end">
          <button type="button" onClick={handleContinue} className={PRIMARY_ACTION_BUTTON}>
            Continue to Review &amp; Edit →
          </button>
        </div>
      </div>
    </div>
  );
}
