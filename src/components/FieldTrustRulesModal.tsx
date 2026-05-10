"use client";

import { useEffect, useState } from "react";

export function FieldTrustRulesModal(props: {
  listType: "companies" | "contacts";
  open: boolean;
  onClose: () => void;
}) {
  const { listType, open, onClose } = props;
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetch(`/api/field-trust-rules?listType=${encodeURIComponent(listType)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("fetch failed");
        return res.text();
      })
      .then((t) => {
        if (!cancelled) {
          setHtml(t);
          setFailed(false);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, listType]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-200 flex items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="field-trust-rules-title"
    >
      <div className="absolute inset-0 bg-black/40" aria-hidden />

      <div className="relative flex max-h-[min(90vh,880px)] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-(--border-default) bg-(--bg-card) shadow-xl">
        <div className="flex items-center justify-between gap-2 border-b border-(--border-default) px-4 py-3">
          <h2
            id="field-trust-rules-title"
            className="text-sm font-semibold text-(--text-primary)"
          >
            Field trust rules
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-(--border-default) bg-(--bg-card) px-2.5 py-1 text-xs font-medium text-(--text-primary) hover:bg-(--bg-muted)"
          >
            Close
          </button>
        </div>

        <div className="min-h-[50vh] flex-1 bg-(--bg-page)">
          {failed ? (
            <p className="p-4 text-sm text-(--text-secondary)">
              Could not load field trust rules. Try again later.
            </p>
          ) : html == null ? (
            <p className="p-4 text-sm text-(--text-secondary)">Loading…</p>
          ) : (
            <iframe
              title="Field trust rules"
              className="h-[min(70vh,720px)] w-full border-0 bg-(--bg-card)"
              srcDoc={html}
              sandbox="allow-same-origin"
            />
          )}
        </div>
      </div>
    </div>
  );
}
