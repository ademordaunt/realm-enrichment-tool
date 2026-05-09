"use client";

import { useCallback, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import type { EnrichedCompany, EnrichedContact, EventContext } from "@/lib/utils/types";
import type { PrePushSettings } from "@/components/PrePushScreen";
import type { HubSpotPushDonePayload } from "@/lib/hubspot/push-result";

export const MANUAL_EDITS_SESSION_KEY = "realm-enrichment-manual-edits-v1";

type Step =
  | "starter" | "upload" | "context" | "enriching" | "verifying"
  | "costestimate" | "prereview" | "enriched" | "prepush" | "pushing" | "complete";

type HubSpotPushListSnapshot = {
  listId: string;
  listName: string;
  folderId?: string;
};

type PushNdjsonEvent =
  | { type: "progress"; current: number; total: number }
  | { type: "list_created"; listId: string; listName: string; folderId?: string }
  | { type: "done"; created: number; updated: number; errors: { rowId: string; error: string }[]; listId: string; listName: string; totalPushed: number; folderId?: string }
  | { type: "error"; message: string };

function apiJsonErrorMessage(o: { error?: string; detail?: string }): string {
  if (typeof o.detail === "string" && o.detail.length > 0) return o.detail;
  if (typeof o.error === "string" && o.error.length > 0) return o.error;
  return "";
}

function firePushCompleteNotification() {
  if (typeof window === "undefined" || typeof Notification === "undefined") return;
  if (Notification.permission === "granted") {
    try {
      new Notification("Realm Enrichment Tool", {
        body: "HubSpot push complete — your records are ready!",
        icon: "/favicon.ico",
      });
    } catch { /* ignore */ }
  }
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const freqs = [523.25, 659.25, 783.99];
    let t = 0;
    for (const freq of freqs) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.value = 0.07;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const start = ctx.currentTime + t;
      osc.start(start);
      osc.stop(start + 0.14);
      t += 0.11;
    }
  } catch { /* ignore */ }
}

async function consumePushNdjson(
  res: Response,
  onProgress: (e: { current: number; total: number }) => void,
  onListCreated?: (e: HubSpotPushListSnapshot) => void,
): Promise<HubSpotPushDonePayload> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body from HubSpot push.");
  const decoder = new TextDecoder();
  let buffer = "";
  let result: HubSpotPushDonePayload | null = null;

  const handleLine = (line: string) => {
    const t = line.trim();
    if (!t) return;
    const msg = JSON.parse(t) as PushNdjsonEvent;
    if (msg.type === "progress") {
      onProgress({ current: msg.current, total: msg.total });
    } else if (msg.type === "list_created") {
      onListCreated?.({
        listId: msg.listId,
        listName: msg.listName,
        ...(typeof msg.folderId === "string" && msg.folderId.trim() !== ""
          ? { folderId: msg.folderId.trim() }
          : {}),
      });
    } else if (msg.type === "error") {
      throw new Error(msg.message);
    } else if (msg.type === "done") {
      result = {
        created: msg.created,
        updated: msg.updated,
        errors: msg.errors,
        listId: msg.listId,
        listName: msg.listName,
        totalPushed: msg.totalPushed,
        ...(typeof msg.folderId === "string" && msg.folderId.trim() !== ""
          ? { folderId: msg.folderId.trim() }
          : {}),
      };
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) handleLine(line);
    if (done) break;
  }
  if (buffer.trim()) handleLine(buffer.trim());
  if (!result) throw new Error("HubSpot push finished without a result payload.");
  return result;
}

interface HubSpotPushOptions {
  enrichedListType: "companies" | "contacts" | null;
  eventContext: EventContext | null;
  reviewRows: EnrichedCompany[] | EnrichedContact[];
  setStep: (s: Step) => void;
  setShowEnrichmentCompleteBanner: (b: boolean) => void;
  setCompletionBannerText: (text: string) => void;
  enrichmentBannerTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
}

export function useHubSpotPush(options: HubSpotPushOptions) {
  const {
    enrichedListType, eventContext, reviewRows, setStep,
    setShowEnrichmentCompleteBanner, setCompletionBannerText, enrichmentBannerTimeoutRef,
  } = options;

  const [pushProgress, setPushProgress] = useState<{ current: number; total: number } | null>(null);
  const [pushListCreatedMeta, setPushListCreatedMeta] = useState<HubSpotPushListSnapshot | null>(null);
  const pushListCreatedRef = useRef<HubSpotPushListSnapshot | null>(null);
  const [pushResult, setPushResult] = useState<HubSpotPushDonePayload | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);
  const [lastPushLeadSource, setLastPushLeadSource] = useState<string | null>(null);

  const runHubSpotPush = useCallback(async (settings: PrePushSettings) => {
    if (!enrichedListType || !eventContext) return;
    const approved = reviewRows.filter((r) => r.status === "approved");
    if (approved.length === 0) return;
    if (typeof window !== "undefined") {
      const rows = reviewRows
        .map((row) => ({
          stableKey: enrichedListType === "contacts"
            ? (row as EnrichedContact).resolvedEmail?.trim().toLowerCase() ?? ""
            : (row as EnrichedCompany).domain?.trim().toLowerCase() ?? "",
          linkedinUrl: String(row.linkedinUrl ?? ""),
        }))
        .filter((r) => r.stableKey);
      try {
        window.sessionStorage.setItem(MANUAL_EDITS_SESSION_KEY, JSON.stringify({ rows }));
      } catch { /* best-effort */ }
    }
    setPushError(null);
    setLastPushLeadSource(settings.leadSource);
    pushListCreatedRef.current = null;
    setPushListCreatedMeta(null);
    setStep("pushing");
    setPushProgress({ current: 0, total: approved.length });
    try {
      const res = await fetch("/api/hubspot/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: settings.contactRowsOverride ?? approved,
          listType: enrichedListType,
          eventName: eventContext.eventName,
          listName: settings.listName,
          folderId: settings.folderId,
          leadSource: settings.leadSource,
          leadSourceDescription: settings.leadSourceDescription,
          useExistingLeadSource: settings.useExistingLeadSource,
          useExistingLeadSourceDescription: settings.useExistingLeadSourceDescription,
          notes: settings.notes,
        }),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
        throw new Error(apiJsonErrorMessage(errBody) || `HubSpot push failed (${res.status})`);
      }
      const done = await consumePushNdjson(
        res,
        (p) => setPushProgress({ current: p.current, total: p.total }),
        (list) => { pushListCreatedRef.current = list; setPushListCreatedMeta(list); },
      );
      setPushResult(done);
      setStep("complete");
      firePushCompleteNotification();
      if (typeof window !== "undefined" && typeof Notification !== "undefined" && Notification.permission !== "granted") {
        setCompletionBannerText("✓ HubSpot push complete — your records are ready!");
        setShowEnrichmentCompleteBanner(true);
        if (enrichmentBannerTimeoutRef.current) clearTimeout(enrichmentBannerTimeoutRef.current);
        enrichmentBannerTimeoutRef.current = setTimeout(() => {
          setShowEnrichmentCompleteBanner(false);
          enrichmentBannerTimeoutRef.current = null;
        }, 5000);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "HubSpot push failed.";
      setPushError(message);
      const listSnap = pushListCreatedRef.current as HubSpotPushListSnapshot | null;
      setPushResult({
        created: 0,
        updated: 0,
        errors: [{ rowId: "push", error: message }],
        listId: listSnap?.listId ?? "",
        listName: listSnap?.listName ?? (settings.listName || eventContext.eventName),
        totalPushed: 0,
        ...(listSnap?.folderId?.trim()
          ? { folderId: listSnap.folderId.trim() }
          : settings.folderId?.trim()
            ? { folderId: settings.folderId.trim() }
            : {}),
      });
      setStep("complete");
    } finally {
      setPushProgress(null);
      pushListCreatedRef.current = null;
      setPushListCreatedMeta(null);
    }
  }, [enrichedListType, eventContext, reviewRows, setStep, setShowEnrichmentCompleteBanner, setCompletionBannerText, enrichmentBannerTimeoutRef]);

  return {
    pushProgress,
    pushListCreatedMeta,
    pushResult,
    pushError,
    lastPushLeadSource,
    setPushResult,
    setPushError,
    setLastPushLeadSource,
    runHubSpotPush,
  };
}
