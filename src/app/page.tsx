"use client";

import { CostEstimateScreen } from "@/components/CostEstimateScreen";
import { BulkProgressScreen } from "@/components/BulkProgressScreen";
import { EventContextForm } from "@/components/EventContextForm";
import { EnrichmentProgress } from "@/components/EnrichmentProgress";
import { StarterScreen } from "@/components/StarterScreen";
import type { PrePushSettings } from "@/components/PrePushScreen";
import { PrePushScreen } from "@/components/PrePushScreen";
import { applyInitialReviewStatus, ReviewTable } from "@/components/ReviewTable";
import { PreReviewGate } from "@/components/PreReviewGate";
import { SuccessScreen } from "@/components/SuccessScreen";
import type { HubSpotPushDonePayload } from "@/lib/hubspot/push-result";
import type {
  BulkJobState,
  EnrichmentSummary,
  EnrichedCompany,
  EnrichedContact,
  EventContext,
  ListType,
  ParseResponse,
  RawCompanyRow,
  RawContactRow,
} from "@/lib/utils/types";
import { finalizeRowsForReview } from "@/lib/utils/prereview";
import {
  ENRICHMENT_BATCH_SIZE,
  needsCompanyLinkedInLookup,
  needsLinkedInLookup,
} from "@/lib/enrichment/enrichment-utils";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

const ACCEPT = ".csv,.xlsx,.xls,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv";

const NAV_STEPS = [
  "Upload",
  "Event Context",
  "Enrichment",
  "Review & Edit",
  "Import Settings",
  "Complete",
] as const;

const PREVIEW_MAX_ROWS = 50;
/** Rows per ZoomInfo verify request — aligned with API `maxDuration` and inter-row delay. */
const ZOOM_VERIFY_COMPANY_CHUNK_SIZE = 15;
/** Contacts are heavier per row (Common Room + prospector + ZoomInfo); use smaller chunks than companies. */
const ZOOM_VERIFY_CONTACT_CHUNK_SIZE = 8;
const SESSION_STORAGE_KEY = "realm-enrichment-session-v1";
const BULK_JOB_SESSION_KEY = "realm-bulk-job-id";
const MANUAL_EDITS_SESSION_KEY = "realm-enrichment-manual-edits-v1";

/** Prefer `detail` from standardized API error JSON; fall back to `error`. */
function apiJsonErrorMessage(o: { error?: string; detail?: string }): string {
  if (typeof o.detail === "string" && o.detail.length > 0) return o.detail;
  if (typeof o.error === "string" && o.error.length > 0) return o.error;
  return "";
}

const MONTH_LONG_TO_ABBREV: Record<string, string> = {
  january: "Jan.",
  february: "Feb.",
  march: "Mar.",
  april: "Apr.",
  may: "May.",
  june: "Jun.",
  july: "Jul.",
  august: "Aug.",
  september: "Sep.",
  october: "Oct.",
  november: "Nov.",
  december: "Dec.",
};

function formatContactDefaultLeadSourceDescription(ctx: EventContext): string {
  const name = ctx.eventName.trim();
  const eventDate = ctx.eventDate.trim();
  const parts = eventDate.split(/\s+/).filter(Boolean);
  if (parts.length < 2) {
    return name || eventDate;
  }
  const year = parts[parts.length - 1]!;
  const monthPart = parts.slice(0, -1).join(" ");
  const abbrev =
    MONTH_LONG_TO_ABBREV[monthPart.toLowerCase()] ??
    `${monthPart.slice(0, 3)}.`;
  return `${name} ${abbrev} ${year}`.trim();
}

const PRIMARY_ACTION_BUTTON =
  "rounded-lg bg-[#7B35C1] px-4 py-2 text-sm font-medium text-white hover:bg-[#6A2AAD] disabled:cursor-not-allowed disabled:opacity-50";

const UPLOAD_FADE_IN = "animate-[fadeIn_0.3s_ease-in]";

function breadcrumbIndex(s: Step): number {
  switch (s) {
    case "starter":
      return -1;
    case "upload":
      return 0;
    case "context":
      return 1;
    case "enriching":
    case "verifying":
    case "costestimate":
      return 2;
    case "prereview":
    case "enriched":
      return 3;
    case "prepush":
    case "pushing":
      return 4;
    case "complete":
      return 5;
    default:
      return 0;
  }
}

type Step =
  | "starter"
  | "upload"
  | "context"
  | "enriching"
  | "verifying"
  | "costestimate"
  | "prereview"
  | "enriched"
  | "prepush"
  | "pushing"
  | "complete";

type PersistedSession = {
  step: Step;
  wizardImportMode?: "event" | "bulk";
  enrichedData: EnrichedCompany[] | EnrichedContact[] | null;
  approvedRows: Array<EnrichedCompany | EnrichedContact>;
  eventContext: EventContext | null;
  listType: "companies" | "contacts" | null;
  parseResult: ParseResponse | null;
};

type PersistedManualLinkedInEdits = {
  rows: Array<{ stableKey: string; linkedinUrl: string }>;
};

function rowDedupKey(row: RawCompanyRow | RawContactRow, kind: "companies" | "contacts"): string {
  if (kind === "companies") {
    return `c:${(row as RawCompanyRow).rawName?.trim().toLowerCase() ?? ""}`;
  }
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
        const a = indices[u]!;
        const b = indices[v]!;
        const sig = `${a}-${b}`;
        if (!exempt.has(sig)) out.push([a, b]);
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

/** Keep the first row per dedup key; drop later duplicates. */
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

function duplicateDisplayName(
  row: RawCompanyRow | RawContactRow,
  kind: "companies" | "contacts",
): string {
  if (kind === "companies") {
    return (row as RawCompanyRow).rawName?.trim() ?? "";
  }
  const c = row as RawContactRow;
  return `${c.firstName?.trim() ?? ""} ${c.lastName?.trim() ?? ""}`.trim();
}

function playEnrichmentChime() {
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
  } catch {
    /* ignore */
  }
}

function fireEnrichmentCompleteNotification() {
  if (typeof window === "undefined" || typeof Notification === "undefined") return;
  if (Notification.permission === "granted") {
    try {
      new Notification("Realm Enrichment Tool", {
        body: "Enrichment complete — ready for review!",
        icon: "/favicon.ico",
      });
    } catch {
      /* ignore */
    }
  }
  playEnrichmentChime();
}

function firePushCompleteNotification() {
  if (typeof window === "undefined" || typeof Notification === "undefined") return;
  if (Notification.permission === "granted") {
    try {
      new Notification("Realm Enrichment Tool", {
        body: "HubSpot push complete — your records are ready!",
        icon: "/favicon.ico",
      });
    } catch {
      /* ignore */
    }
  }
  playEnrichmentChime();
}

function collectKeys(rows: Array<RawCompanyRow | RawContactRow>, maxScan: number): string[] {
  const keys = new Set<string>();
  for (let i = 0; i < Math.min(rows.length, maxScan); i++) {
    Object.keys(rows[i] ?? {}).forEach((k) => keys.add(k));
  }
  return Array.from(keys).sort();
}

const STANDARD_PREVIEW_FIELDS = new Set<string>([
  "rawName",
  "domain",
  "state",
  "employees",
  "industry",
  "firstName",
  "lastName",
  "email",
  "phone",
  "title",
  "company",
  "location",
  "notes",
  "membershipNotes",
  "leadSource",
  "leadSourceDescription",
  "attended",
  "eventFormat",
  "companyDomain",
]);

function humanizeFieldLabel(key: string): string {
  const special: Record<string, string> = {
    rawName: "Company",
    firstName: "First Name",
    lastName: "Last Name",
    leadSource: "Lead Source",
    leadSourceDescription: "Lead Source Description",
    eventFormat: "Format",
    companyDomain: "Domain",
    rawEmail: "Email",
  };
  if (special[key]) return special[key];
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

type NdjsonEvent =
  | { type: "progress"; start: number; end: number; total: number; detail?: string }
  | {
      type: "done";
      listType: "companies" | "contacts";
      rows: EnrichedCompany[] | EnrichedContact[];
      enrichedCount?: number;
      cachedCount?: number;
      commonRoomHits?: number;
      creditsUsed?: number;
    }
  | { type: "error"; message: string; zoomInfoAuthFailure?: boolean };

class ZoomInfoVerifyError extends Error {
  readonly zoomInfoAuthFailure: boolean;

  constructor(message: string, options?: { zoomInfoAuthFailure?: boolean }) {
    super(message);
    this.name = "ZoomInfoVerifyError";
    this.zoomInfoAuthFailure = Boolean(options?.zoomInfoAuthFailure);
  }
}

type ZoomInfoVerifySummary =
  | {
      kind: "success";
      enrichedCount: number;
      cachedCount: number;
      creditsUsed: number;
      listType: "companies" | "contacts";
    }
  | { kind: "no_matches" }
  | { kind: "credentials" };

type EventEnrichmentSummary = EnrichmentSummary;

type HubSpotPrecheckItem = {
  id: string;
  hubspotId: string | null;
  hubspotComplete: boolean;
  existingData: Record<string, string>;
};

function isBlank(value: string | null | undefined): boolean {
  return value == null || value.trim() === "";
}

/** HubSpot property name → enriched row field name (companies). */
const companyFieldMap: Record<string, string> = {
  domain: "domain",
  state: "state",
  numberofemployees: "numberOfEmployees",
  linkedin_company_page: "linkedinUrl",
  industry: "industry",
  description: "description",
  city: "city",
};

/** HubSpot property name → enriched row field name (contacts). */
const contactFieldMap: Record<string, string> = {
  jobtitle: "title",
  company: "resolvedCompany",
  ds_liprofile: "linkedinUrl",
  state: "location",
  phone: "phone",
  job_level: "ziManagementLevel",
  job_function: "ziJobFunction",
};

function mergeHubSpotExistingIntoCompany(
  merged: EnrichedCompany,
  existing: Record<string, string>,
): void {
  for (const [hsKey, rowKey] of Object.entries(companyFieldMap)) {
    const raw = existing[hsKey];
    if (raw == null || String(raw).trim() === "") continue;
    const val = String(raw).trim();
    if (rowKey === "numberOfEmployees") {
      if (merged.numberOfEmployees != null) continue;
      const n = Number.parseInt(val, 10);
      if (Number.isFinite(n)) merged.numberOfEmployees = n;
      continue;
    }
    const cur = merged[rowKey as keyof EnrichedCompany];
    if (typeof cur === "string" && !isBlank(cur)) continue;
    if (cur != null && typeof cur !== "string") continue;
    (merged as unknown as Record<string, unknown>)[rowKey] = val;
  }
  if (isBlank(merged.website) && !isBlank(merged.domain)) {
    const d = merged.domain
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0]!;
    if (d) merged.website = `https://www.${d}`;
  }
  const hsLi = String(existing.linkedin_company_page ?? "").trim();
  if (hsLi && merged.linkedinUrl.trim() === hsLi) {
    merged.linkedinSource = "hubspot";
  }
  const hsDom = String(existing.domain ?? "").trim();
  if (hsDom && merged.domain.trim().toLowerCase() === hsDom.toLowerCase()) {
    merged.domainSource = "hubspot_verified";
  }
}

function contactPrecheckFieldEmpty(merged: EnrichedContact, rowKey: string): boolean {
  const v = (merged as unknown as Record<string, unknown>)[rowKey];
  if (v == null) return true;
  if (typeof v === "string") return isBlank(v);
  return false;
}

function mergeHubSpotExistingIntoContact(
  merged: EnrichedContact,
  existing: Record<string, string>,
): void {
  for (const [hsKey, rowKey] of Object.entries(contactFieldMap)) {
    const raw = existing[hsKey];
    if (raw == null || String(raw).trim() === "") continue;
    if (!contactPrecheckFieldEmpty(merged, rowKey)) continue;
    (merged as unknown as Record<string, unknown>)[rowKey] = String(raw).trim();
  }
  const hsLi = String(existing.ds_liprofile ?? "").trim();
  if (hsLi && merged.linkedinUrl.trim() === hsLi) {
    merged.linkedinSource = "hubspot";
  }
}

function computeZoomVerifyNonHighTotal(
  allRows: (EnrichedCompany | EnrichedContact)[],
  _listType: "companies" | "contacts",
): number {
  return allRows.filter((r) => r.hubspotComplete !== true).length;
}

/** Count of rows before `beforeIndex` that take the ZoomInfo enrich path (same as server `nonHighIndex` steps). */
function countZoomVerifyNonHighPrefix(
  allRows: (EnrichedCompany | EnrichedContact)[],
  _listType: "companies" | "contacts",
  beforeIndex: number,
): number {
  let n = 0;
  const end = Math.min(beforeIndex, allRows.length);
  for (let j = 0; j < end; j++) {
    const row = allRows[j]!;
    if (row.hubspotComplete !== true) n++;
  }
  return n;
}

async function consumeEnrichmentNdjson(
  res: Response,
  onProgress: (e: {
    start: number;
    end: number;
    total: number;
    detail?: string | null;
  }) => void,
): Promise<{
  rows: EnrichedCompany[] | EnrichedContact[];
  rawNdjson: string;
  enrichedCount: number;
  cachedCount: number;
  commonRoomHits: number;
  creditsUsed: number;
}> {
  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error("No response body from enrichment.");
  }
  const decoder = new TextDecoder();
  let buffer = "";
  let rawNdjson = "";
  let result: EnrichedCompany[] | EnrichedContact[] | null = null;
  let enrichedCount = 0;
  let cachedCount = 0;
  let commonRoomHits = 0;
  let creditsUsed = 0;

  const handleLine = (line: string) => {
    const t = line.trim();
    if (!t) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      console.error("[NDJSON] Failed to parse line, skipping:", line.slice(0, 120));
      return;
    }
    const msg = parsed as NdjsonEvent;
    if (msg.type === "progress") {
      onProgress({
        start: msg.start,
        end: msg.end,
        total: msg.total,
        detail: msg.detail ?? null,
      });
    } else if (msg.type === "error") {
      throw new ZoomInfoVerifyError(msg.message, {
        zoomInfoAuthFailure: msg.zoomInfoAuthFailure === true,
      });
    } else if (msg.type === "done") {
      result = msg.rows;
      enrichedCount =
        typeof msg.enrichedCount === "number" && Number.isFinite(msg.enrichedCount)
          ? msg.enrichedCount
          : 0;
      cachedCount =
        typeof msg.cachedCount === "number" && Number.isFinite(msg.cachedCount)
          ? msg.cachedCount
          : 0;
      commonRoomHits =
        typeof msg.commonRoomHits === "number" && Number.isFinite(msg.commonRoomHits)
          ? msg.commonRoomHits
          : 0;
      creditsUsed =
        typeof msg.creditsUsed === "number" && Number.isFinite(msg.creditsUsed)
          ? msg.creditsUsed
          : enrichedCount;
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
  return { rows: result, rawNdjson, enrichedCount, cachedCount, commonRoomHits, creditsUsed };
}

function linkedInLookupIdentityOk(
  row: EnrichedCompany | EnrichedContact,
): boolean {
  const ic = row.identityConfidence ?? row.confidenceScore;
  return ic === "high" || ic === "medium";
}

async function runLinkedInLookupPass(
  contacts: EnrichedContact[],
  signal: AbortSignal,
  onProgress: (done: number, total: number) => void,
): Promise<EnrichedContact[]> {
  const missingIndices: number[] = [];
  for (let i = 0; i < contacts.length; i++) {
    const c = contacts[i]!;
    if (linkedInLookupIdentityOk(c) && needsLinkedInLookup(c)) {
      missingIndices.push(i);
    }
  }
  const total = missingIndices.length;
  if (total === 0) {
    return contacts;
  }

  const out = contacts.slice();
  let done = 0;
  for (const idx of missingIndices) {
    const row = out[idx]!;
    const res = await fetch("/api/enrich/linkedin-search", {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contact: row }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "unknown error");
      console.error(
        `[LinkedIn] fetch failed for row ${idx}: ${res.status} ${errText}`,
      );
      done += 1;
      onProgress(done, total);
      continue;
    }
    const payload = (await res.json()) as {
      linkedInUrl?: string | null;
      linkedinSource?: string;
    };
    const linkedInUrl = String(payload.linkedInUrl ?? "").trim();
    if (linkedInUrl) {
      out[idx] = {
        ...row,
        linkedinUrl: linkedInUrl,
        linkedinSource: "ai_search",
        enrichedByAI: true,
      };
    }
    done += 1;
    onProgress(done, total);
  }
  return out;
}

async function runCompanyLinkedInLookupPass(
  companies: EnrichedCompany[],
  signal: AbortSignal,
  onProgress: (done: number, total: number) => void,
): Promise<EnrichedCompany[]> {
  const missingIndices: number[] = [];
  for (let i = 0; i < companies.length; i++) {
    const c = companies[i]!;
    if (linkedInLookupIdentityOk(c) && needsCompanyLinkedInLookup(c)) {
      missingIndices.push(i);
    }
  }
  const total = missingIndices.length;
  if (total === 0) {
    return companies;
  }

  const out = companies.slice();
  let done = 0;
  for (const idx of missingIndices) {
    const row = out[idx]!;
    const res = await fetch("/api/enrich/linkedin-search", {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company: row }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "unknown error");
      console.error(
        `[LinkedIn] fetch failed for row ${idx}: ${res.status} ${errText}`,
      );
      done += 1;
      onProgress(done, total);
      continue;
    }
    const payload = (await res.json()) as {
      linkedInUrl?: string | null;
      linkedinSource?: string;
    };
    const linkedInUrl = String(payload.linkedInUrl ?? "").trim();
    if (linkedInUrl) {
      out[idx] = {
        ...row,
        linkedinUrl: linkedInUrl,
        linkedinSource: "ai_search",
        enrichedByAI: true,
      };
    }
    done += 1;
    onProgress(done, total);
  }
  return out;
}

function fallbackAiCompanyRows(rows: RawCompanyRow[], errMsg: string): EnrichedCompany[] {
  return rows.map((row) => ({
    id: crypto.randomUUID(),
    rawInput: row.rawName,
    resolvedName: row.rawName,
    confidenceScore: "unresolved" as const,
    identityConfidence: "unresolved" as const,
    aiReasoning: errMsg,
    needsReview: true,
    domain: "",
    domainSource: "" as const,
    website: "",
    state: "",
    numberOfEmployees: null,
    linkedinUrl: "",
    linkedinSource: "" as const,
    reviewBucket: "needs_review" as const,
    enrichedByZoomInfo: false,
    enrichedByCommonRoom: false,
    enrichedByAI: false,
    status: "pending" as const,
  }));
}

function fallbackAiContactRows(rows: RawContactRow[], errMsg: string): EnrichedContact[] {
  return rows.map((row) => {
    const rawEmail = row.email?.trim() ?? "";
    return {
      id: crypto.randomUUID(),
      firstName: row.firstName,
      lastName: row.lastName,
      rawEmail,
      rawCompany: row.company?.trim() ?? "",
      resolvedEmail: rawEmail,
      isPersonalEmail: false,
      resolvedCompany: row.company?.trim() ?? "",
      confidenceScore: "unresolved" as const,
      identityConfidence: "unresolved" as const,
      aiReasoning: errMsg,
      needsReview: true,
      title: row.title?.trim() ?? "",
      linkedinUrl: "",
      linkedinSource: "" as const,
      reviewBucket: "needs_review" as const,
      companyDomain: "",
      location: row.location?.trim() ?? "",
      leadSource: row.leadSource?.trim() ?? "",
      leadSourceDescription: row.leadSourceDescription?.trim() ?? "",
      notes: row.notes?.trim() ?? "",
      membershipNotes: row.membershipNotes?.trim() ?? "",
      enrichedByZoomInfo: false,
      enrichedByCommonRoom: false,
      enrichedByAI: false,
      status: "pending" as const,
    };
  });
}

type HubSpotPushListSnapshot = {
  listId: string;
  listName: string;
  folderId?: string;
};

type PushNdjsonEvent =
  | { type: "progress"; current: number; total: number }
  | { type: "list_created"; listId: string; listName: string; folderId?: string }
  | {
      type: "done";
      created: number;
      updated: number;
      errors: { rowId: string; error: string }[];
      listId: string;
      listName: string;
      totalPushed: number;
      folderId?: string;
    }
  | { type: "error"; message: string };

async function consumePushNdjson(
  res: Response,
  onProgress: (e: { current: number; total: number }) => void,
  onListCreated?: (e: HubSpotPushListSnapshot) => void,
): Promise<HubSpotPushDonePayload> {
  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error("No response body from HubSpot push.");
  }
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
    if (value) {
      buffer += decoder.decode(value, { stream: true });
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
    throw new Error("HubSpot push finished without a result payload.");
  }
  return result;
}

export default function Home() {
  const [step, setStep] = useState<Step>("starter");
  const [wizardImportMode, setWizardImportMode] = useState<"event" | "bulk">("event");
  const [bulkSmallListBypass, setBulkSmallListBypass] = useState(false);
  const [showEnrichmentInterruptedBanner, setShowEnrichmentInterruptedBanner] = useState(false);
  const [costEstimateMeta, setCostEstimateMeta] = useState<{
    totalRows: number;
    hubspotCompleteCount: number;
  } | null>(null);
  const [precheckHubspotSkipCount, setPrecheckHubspotSkipCount] = useState<number | null>(null);
  const [bulkJobId, setBulkJobId] = useState<string | null>(null);
  const [bulkJobState, setBulkJobState] = useState<BulkJobState | null>(null);
  const bulkPollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bulkCompleteNotifiedRef = useRef(false);
  const [bulkRowsContinueLoading, setBulkRowsContinueLoading] = useState(false);
  const bulkContinueRef = useRef<{
    rows: EnrichedCompany[] | EnrichedContact[];
    listType: "companies" | "contacts";
    signal: AbortSignal;
  } | null>(null);
  /** Resolves when the user taps Proceed on the bulk cost estimate screen (runEnrichment awaits this). */
  const bulkCostGateResolveRef = useRef<(() => void) | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enrichError, setEnrichError] = useState<string | null>(null);
  const [zoomInfoVerifySummary, setZoomInfoVerifySummary] = useState<ZoomInfoVerifySummary | null>(
    null,
  );
  const [eventEnrichmentSummary, setEventEnrichmentSummary] = useState<EventEnrichmentSummary | null>(
    null,
  );
  const [result, setResult] = useState<ParseResponse | null>(null);
  const [listOverride, setListOverride] = useState<"companies" | "contacts" | null>(null);
  const [segmentIndex, setSegmentIndex] = useState(0);

  const [progress, setProgress] = useState<{
    startRow: number;
    endRow: number;
    totalRows: number;
    detail?: string | null;
    /** True when the current batch was served entirely from KV cache (AI skipped). */
    fromCache?: boolean;
  } | null>(null);

  const [enriched, setEnriched] = useState<EnrichedCompany[] | EnrichedContact[] | null>(null);
  const [enrichedListType, setEnrichedListType] = useState<"companies" | "contacts" | null>(
    null,
  );
  const [reviewRows, setReviewRows] = useState<EnrichedCompany[] | EnrichedContact[]>([]);
  const [eventContext, setEventContext] = useState<EventContext | null>(null);
  const [pushProgress, setPushProgress] = useState<{ current: number; total: number } | null>(
    null,
  );
  const [pushListCreatedMeta, setPushListCreatedMeta] = useState<HubSpotPushListSnapshot | null>(
    null,
  );
  const pushListCreatedRef = useRef<HubSpotPushListSnapshot | null>(null);
  const [pushResult, setPushResult] = useState<HubSpotPushDonePayload | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);
  const [lastPushLeadSource, setLastPushLeadSource] = useState<string | null>(null);

  const [previewRowsOverride, setPreviewRowsOverride] = useState<Array<RawCompanyRow | RawContactRow> | null>(
    null,
  );
  const [duplicateExemptPairs, setDuplicateExemptPairs] = useState<Set<string>>(() => new Set());
  const [dupFeedback, setDupFeedback] = useState<"removed" | "kept" | null>(null);
  /** Snapshot of unresolved duplicate-pair count when the user first sees the duplicate card (for "N of M" UI). */
  const [duplicateSessionTotal, setDuplicateSessionTotal] = useState<number | null>(null);
  const [removeAllDupConfirm, setRemoveAllDupConfirm] = useState<string | null>(null);
  const [showSuccessFlash, setShowSuccessFlash] = useState(false);

  const enrichAbortRef = useRef<AbortController | null>(null);
  const uploadFlashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const removeAllDupMsgTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enrichmentBannerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoredApprovedIdsRef = useRef<Set<string> | null>(null);
  const restoredManualEditsRef = useRef(false);
  const sessionHydratedRef = useRef(false);

  const [showEnrichmentCompleteBanner, setShowEnrichmentCompleteBanner] = useState(false);
  const [completionBannerText, setCompletionBannerText] = useState(
    "✓ Enrichment complete — your results are ready below.",
  );

  const approvedRowsForPush = useMemo(
    () => reviewRows.filter((r) => r.status === "approved"),
    [reviewRows],
  );
  const approvedRowsById = useMemo(() => {
    const byId = new Map<string, { displayName: string }>();
    for (const row of approvedRowsForPush) {
      if ("rawInput" in row) {
        byId.set(row.id, { displayName: row.resolvedName });
      } else {
        const fullName = `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim();
        byId.set(row.id, { displayName: fullName });
      }
    }
    return byId;
  }, [approvedRowsForPush]);
  useLayoutEffect(() => {
    if (!enriched?.length || !enrichedListType) {
      setReviewRows([]);
      return;
    }
    restoredManualEditsRef.current = false;
    const seeded = applyInitialReviewStatus(enriched);
    const approvedIds = restoredApprovedIdsRef.current;
    if (!approvedIds || approvedIds.size === 0) {
      setReviewRows(seeded);
      return;
    }
    const withRestoredApproval = seeded.map((row) => ({
      ...row,
      status: approvedIds.has(row.id) ? ("approved" as const) : row.status,
    })) as EnrichedCompany[] | EnrichedContact[];
    setReviewRows(withRestoredApproval);
    restoredApprovedIdsRef.current = null;
  }, [enriched, enrichedListType]);

  useEffect(() => {
    if (step !== "enriched" || reviewRows.length === 0 || restoredManualEditsRef.current) return;
    if (!enrichedListType || typeof window === "undefined") return;
    const raw = window.sessionStorage.getItem(MANUAL_EDITS_SESSION_KEY);
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as PersistedManualLinkedInEdits;
      const savedRows = Array.isArray(saved?.rows) ? saved.rows : [];
      if (savedRows.length === 0) return;
      const savedByStableKey = new Map<string, string>();
      for (const r of savedRows) {
        const rawKey =
          typeof (r as { stableKey?: string }).stableKey === "string"
            ? (r as { stableKey: string }).stableKey
            : "";
        const key = rawKey.trim().toLowerCase();
        if (!key) continue;
        const url =
          typeof r.linkedinUrl === "string" ? r.linkedinUrl.trim() : String(r.linkedinUrl ?? "").trim();
        if (url) savedByStableKey.set(key, url);
      }
      if (savedByStableKey.size === 0) return;

      const merged = reviewRows.map((row) => {
        const stableKey =
          enrichedListType === "contacts"
            ? (row as EnrichedContact).resolvedEmail?.trim().toLowerCase() ?? ""
            : (row as EnrichedCompany).domain?.trim().toLowerCase() ?? "";
        if (!stableKey) return row;
        const savedLinkedIn = savedByStableKey.get(stableKey) ?? "";
        const currentLinkedIn = (row.linkedinUrl ?? "").trim();
        if (!savedLinkedIn || currentLinkedIn) return row;
        return { ...row, linkedinUrl: savedLinkedIn };
      }) as EnrichedCompany[] | EnrichedContact[];
      restoredManualEditsRef.current = true;
      setReviewRows(merged);
      window.sessionStorage.removeItem(MANUAL_EDITS_SESSION_KEY);
    } catch {
      // Ignore malformed payloads and leave current rows untouched.
    }
  }, [step, reviewRows, enrichedListType]);

  useEffect(() => {
    return () => {
      if (uploadFlashTimeoutRef.current) {
        clearTimeout(uploadFlashTimeoutRef.current);
        uploadFlashTimeoutRef.current = null;
      }
      if (removeAllDupMsgTimeoutRef.current) {
        clearTimeout(removeAllDupMsgTimeoutRef.current);
        removeAllDupMsgTimeoutRef.current = null;
      }
      if (enrichmentBannerTimeoutRef.current) {
        clearTimeout(enrichmentBannerTimeoutRef.current);
        enrichmentBannerTimeoutRef.current = null;
      }
      if (bulkPollTimerRef.current) {
        clearInterval(bulkPollTimerRef.current);
        bulkPollTimerRef.current = null;
      }
    };
  }, []);

  const clearSessionSnapshot = useCallback(() => {
    if (typeof window === "undefined") return;
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || sessionHydratedRef.current) return;
    sessionHydratedRef.current = true;
    const raw = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as PersistedSession;
      if (saved.parseResult) {
        setResult(saved.parseResult);
      }
      if (saved.eventContext) {
        const ec = saved.eventContext as EventContext;
        setEventContext({
          ...ec,
          importMode: ec.importMode ?? saved.wizardImportMode ?? "event",
          region: saved.wizardImportMode === "bulk" ? "" : (ec.region ?? ""),
        });
      }
      if (saved.wizardImportMode === "bulk" || saved.wizardImportMode === "event") {
        setWizardImportMode(saved.wizardImportMode);
      } else if (saved.eventContext) {
        const im = (saved.eventContext as EventContext).importMode;
        if (im === "bulk" || im === "event") setWizardImportMode(im);
      }
      if (saved.enrichedData) {
        setEnriched(saved.enrichedData);
      }
      if (saved.listType) {
        setEnrichedListType(saved.listType);
        setListOverride(saved.listType);
      }
      if (Array.isArray(saved.approvedRows)) {
        restoredApprovedIdsRef.current = new Set(saved.approvedRows.map((r) => r.id));
      }
      let nextStep = (saved.step ?? "starter") as Step;
      if (nextStep === "enriching" || nextStep === "verifying") {
        nextStep = "context";
        setShowEnrichmentInterruptedBanner(true);
      }
      setStep(nextStep);
      if (typeof window !== "undefined") {
        const savedBulkJobId = window.sessionStorage.getItem(BULK_JOB_SESSION_KEY);
        if (savedBulkJobId) {
          setBulkJobId(savedBulkJobId);
        }
      }
    } catch {
      clearSessionSnapshot();
    }
  }, [clearSessionSnapshot]);

  const fetchManualEditsMap = useCallback(
    async (
      rows: EnrichedCompany[] | EnrichedContact[],
      listType: "companies" | "contacts",
    ): Promise<Map<string, Record<string, unknown>>> => {
      const stableKeys = new Set<string>();
      for (const row of rows) {
        const stableKey =
          listType === "contacts"
            ? (row as EnrichedContact).resolvedEmail?.trim().toLowerCase() ?? ""
            : (row as EnrichedCompany).domain?.trim().toLowerCase() ?? "";
        if (stableKey) stableKeys.add(stableKey);
      }
      if (stableKeys.size === 0) return new Map<string, Record<string, unknown>>();

      const entries = await Promise.all(
        Array.from(stableKeys).map(async (stableKey) => {
          try {
            const res = await fetch(
              `/api/manual-edits?stableKey=${encodeURIComponent(stableKey)}&listType=${encodeURIComponent(listType)}`,
              { method: "GET", cache: "no-store" },
            );
            if (!res.ok) return [stableKey, null] as const;
            const payload = (await res.json()) as { edits?: Record<string, unknown> | null };
            const edits = payload.edits;
            if (!edits || typeof edits !== "object" || Array.isArray(edits)) {
              return [stableKey, null] as const;
            }
            return [stableKey, edits] as const;
          } catch {
            return [stableKey, null] as const;
          }
        }),
      );

      const out = new Map<string, Record<string, unknown>>();
      for (const [stableKey, edits] of entries) {
        if (edits) out.set(stableKey, edits);
      }
      return out;
    },
    [],
  );

  const advanceToReview = useCallback(
    async (
      rows: EnrichedCompany[] | EnrichedContact[],
      listType: "companies" | "contacts",
    ) => {
      const manualEdits = await fetchManualEditsMap(rows, listType);
      const finalizeOpts = { importMode: wizardImportMode, manualEdits };
      const finalized =
        listType === "companies"
          ? finalizeRowsForReview(rows as EnrichedCompany[], "companies", finalizeOpts)
          : finalizeRowsForReview(rows as EnrichedContact[], "contacts", finalizeOpts);
      setEnriched(finalized);
      setEnrichedListType(listType);
      setStep("prereview");
    },
    [wizardImportMode, fetchManualEditsMap],
  );

  const stopJobPolling = useCallback(() => {
    if (bulkPollTimerRef.current) {
      clearInterval(bulkPollTimerRef.current);
      bulkPollTimerRef.current = null;
    }
  }, []);

  const loadCompletedBulkRows = useCallback(
    async (jobId: string, listType: "companies" | "contacts") => {
      const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/rows`, {
        method: "GET",
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error(`Failed to load completed rows (${res.status})`);
      }
      const payload = (await res.json()) as {
        rows: EnrichedCompany[] | EnrichedContact[];
      };
      await advanceToReview(payload.rows, listType);
      setShowEnrichmentInterruptedBanner(false);
      setProgress(null);
      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem(BULK_JOB_SESSION_KEY);
      }
      setBulkJobId(null);
      setBulkJobState(null);
    },
    [advanceToReview],
  );

  const handleContinueToReview = useCallback(async () => {
    const jobId = bulkJobId;
    const listType = bulkJobState?.listType;
    if (!jobId || !listType) return;
    setBulkRowsContinueLoading(true);
    setEnrichError(null);
    try {
      await loadCompletedBulkRows(jobId, listType);
    } catch (e) {
      setEnrichError(e instanceof Error ? e.message : "Failed to load completed rows.");
    } finally {
      setBulkRowsContinueLoading(false);
    }
  }, [bulkJobId, bulkJobState?.listType, loadCompletedBulkRows]);

  const startJobPolling = useCallback(
    (jobId: string) => {
      stopJobPolling();
      const tick = async () => {
        try {
          const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/status`, {
            method: "GET",
            cache: "no-store",
          });
          if (!res.ok) return;
          const state = (await res.json()) as BulkJobState;
          setBulkJobState(state);
          setProgress({
            startRow: 1,
            endRow: state.processedRows,
            totalRows: state.totalRows || 1,
            detail: `Bulk job ${state.currentPhase}: ${state.processedRows} of ${state.totalRows}`,
          });

          if (state.status === "complete") {
            stopJobPolling();
            if (!bulkCompleteNotifiedRef.current) {
              bulkCompleteNotifiedRef.current = true;
              fireEnrichmentCompleteNotification();
            }
            return;
          }
          if (state.status === "failed" || state.status === "cancelled") {
            stopJobPolling();
            return;
          }
        } catch (err) {
          console.error("[bulk-job] polling failed", err);
        }
      };
      void tick();
      bulkPollTimerRef.current = setInterval(() => {
        void tick();
      }, 5000);
    },
    [loadCompletedBulkRows, stopJobPolling],
  );

  useEffect(() => {
    if (bulkJobId && wizardImportMode === "bulk") {
      startJobPolling(bulkJobId);
    }
    return () => {
      stopJobPolling();
    };
  }, [bulkJobId, wizardImportMode, startJobPolling, stopJobPolling]);

  useEffect(() => {
    if (typeof window === "undefined" || !sessionHydratedRef.current) return;
    const payload: PersistedSession = {
      step,
      wizardImportMode,
      enrichedData: enriched,
      approvedRows: approvedRowsForPush,
      eventContext,
      listType: enrichedListType,
      parseResult: result,
    };
    try {
      window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(payload));
    } catch (e) {
      console.warn("[session] Failed to persist snapshot (quota or access):", e);
    }
  }, [step, wizardImportMode, enriched, approvedRowsForPush, eventContext, enrichedListType, result]);

  const parseFile = useCallback(
    async (f: File, listType?: "companies" | "contacts") => {
      setBusy(true);
      setError(null);
      setBulkSmallListBypass(false);
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
        const json = (await res.json()) as ParseResponse & {
          error?: string;
          detail?: string;
        };
        if (!res.ok) {
          setResult(null);
          setShowSuccessFlash(false);
          setError(
            apiJsonErrorMessage(json) || `Request failed (${res.status})`,
          );
          return;
        }
        if (apiJsonErrorMessage(json)) {
          setResult(null);
          setShowSuccessFlash(false);
          setError(apiJsonErrorMessage(json));
          return;
        }
        setResult(json);
        setShowSuccessFlash(true);
        if (uploadFlashTimeoutRef.current) {
          clearTimeout(uploadFlashTimeoutRef.current);
        }
        uploadFlashTimeoutRef.current = setTimeout(() => {
          setShowSuccessFlash(false);
          uploadFlashTimeoutRef.current = null;
        }, 1500);
        setSegmentIndex(0);
        setStep("upload");
        setEnriched(null);
        setEnrichedListType(null);
        setEventContext(null);
        setPushResult(null);
        setPushError(null);
        setLastPushLeadSource(null);
        setPreviewRowsOverride(null);
        setDuplicateExemptPairs(new Set());
        if (json.listType !== "unknown") {
          setListOverride(null);
        }
      } catch (e) {
        setResult(null);
        setShowSuccessFlash(false);
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

  const workingRows = previewRowsOverride ?? displayRows;
  const effectiveRowCount = workingRows.length;

  const previewKeys = useMemo(
    () => collectKeys(workingRows, 100),
    [workingRows],
  );

  const duplicatePair = useMemo((): [number, number] | null => {
    if (!resolvedListType) return null;
    return findFirstDuplicatePair(workingRows, resolvedListType, duplicateExemptPairs);
  }, [workingRows, resolvedListType, duplicateExemptPairs]);

  const remainingDuplicatePairsCount = useMemo(() => {
    if (!resolvedListType) return 0;
    return listAllDuplicatePairs(workingRows, resolvedListType, duplicateExemptPairs).length;
  }, [workingRows, resolvedListType, duplicateExemptPairs]);

  useEffect(() => {
    if (!resolvedListType) {
      setDuplicateSessionTotal(null);
      return;
    }
    const n = listAllDuplicatePairs(workingRows, resolvedListType, duplicateExemptPairs).length;
    if (n === 0) {
      setDuplicateSessionTotal(null);
      return;
    }
    setDuplicateSessionTotal((prev) => (prev == null ? n : prev));
  }, [workingRows, resolvedListType, duplicateExemptPairs]);

  const duplicatePairSerial =
    duplicateSessionTotal != null && remainingDuplicatePairsCount > 0
      ? duplicateSessionTotal - remainingDuplicatePairsCount + 1
      : 1;

  const previewRowsForTable = useMemo(
    () => workingRows.slice(0, PREVIEW_MAX_ROWS),
    [workingRows],
  );
  const activeNormalizedHeaders = useMemo(() => {
    if (!result) return [] as string[];
    if (result.multiEvent?.segments?.length) {
      return result.multiEvent.segments[segmentIndex]?.headers ?? result.headers ?? [];
    }
    return result.headers ?? [];
  }, [result, segmentIndex]);
  const activeOriginalHeaders = useMemo(() => {
    if (!result) return [] as string[];
    if (result.multiEvent?.segments?.length) {
      return result.multiEvent.segments[segmentIndex]?.originalHeaders ?? result.originalHeaders ?? [];
    }
    return result.originalHeaders ?? [];
  }, [result, segmentIndex]);
  const previewColumnMeta = useMemo(
    () =>
      previewKeys.map((key) => {
        const headerIdx = activeNormalizedHeaders.findIndex((h) => h === key);
        const originalHeader = headerIdx >= 0 ? (activeOriginalHeaders[headerIdx] ?? key) : key;
        const recognized = STANDARD_PREVIEW_FIELDS.has(key) || headerIdx < 0;
        return {
          key,
          label: humanizeFieldLabel(key),
          originalHeader,
          recognized,
        };
      }),
    [previewKeys, activeNormalizedHeaders, activeOriginalHeaders],
  );
  const showBulkSmallListWarning =
    wizardImportMode === "bulk" &&
    effectiveRowCount > 0 &&
    effectiveRowCount < 200 &&
    !bulkSmallListBypass;

  useEffect(() => {
    setPreviewRowsOverride(null);
    setDuplicateExemptPairs(new Set());
    setDupFeedback(null);
    setDuplicateSessionTotal(null);
    setRemoveAllDupConfirm(null);
    if (removeAllDupMsgTimeoutRef.current) {
      clearTimeout(removeAllDupMsgTimeoutRef.current);
      removeAllDupMsgTimeoutRef.current = null;
    }
  }, [result, segmentIndex]);

  const runZoomVerify = async (
    aiRows: EnrichedCompany[] | EnrichedContact[],
    listType: "companies" | "contacts",
    signal?: AbortSignal,
  ): Promise<{
    rows: EnrichedCompany[] | EnrichedContact[];
    creditsUsed: number;
    commonRoomHits: number;
  }> => {
    setStep("verifying");
    const totalRows = aiRows.length;
    const listLabel = listType === "contacts" ? "contacts" : "companies";
    setProgress({
      startRow: 1,
      endRow: 0,
      totalRows,
      detail: `ZoomInfo & Common Room enriching 0 of ${totalRows} ${listLabel}…`,
    });
    if (totalRows === 0) {
      setZoomInfoVerifySummary({ kind: "no_matches" });
      return { rows: [], creditsUsed: 0, commonRoomHits: 0 };
    }

    const nonHighTotal = computeZoomVerifyNonHighTotal(aiRows, listType);
    const zoomVerifyChunkSize =
      listType === "contacts"
        ? ZOOM_VERIFY_CONTACT_CHUNK_SIZE
        : ZOOM_VERIFY_COMPANY_CHUNK_SIZE;
    const numChunks = Math.ceil(totalRows / zoomVerifyChunkSize);
    let sumEnriched = 0;
    let sumCached = 0;
    let sumCredits = 0;
    let sumCommonRoomHits = 0;
    const merged: (EnrichedCompany | EnrichedContact)[] = [];

    for (let ci = 0; ci < numChunks; ci++) {
      const chunkStart = ci * zoomVerifyChunkSize;
      const slice = aiRows.slice(
        chunkStart,
        chunkStart + zoomVerifyChunkSize,
      );
      const nonHighPrefixCount = countZoomVerifyNonHighPrefix(
        aiRows,
        listType,
        chunkStart,
      );
      const res = await fetch("/api/enrich/zoominfo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: slice,
          listType,
          chunkIndex: ci,
          chunkSize: zoomVerifyChunkSize,
          totalRows,
          nonHighTotal,
          nonHighPrefixCount,
        }),
        signal,
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as {
          error?: string;
          detail?: string;
        };
        throw new Error(
          apiJsonErrorMessage(errBody) || `Verification failed (${res.status})`,
        );
      }
      const { rows, enrichedCount, cachedCount, commonRoomHits, creditsUsed } = await consumeEnrichmentNdjson(
        res,
        (p) => {
          setProgress({
            startRow: p.start,
            endRow: p.end,
            totalRows: p.total,
            detail: `ZoomInfo & Common Room enriching ${Math.min(
              p.end,
              p.total,
            )} of ${p.total} ${listLabel}…`,
          });
        },
      );
      merged.push(...rows);
      sumEnriched += enrichedCount;
      sumCached += cachedCount;
      sumCommonRoomHits += commonRoomHits;
      sumCredits += creditsUsed;
    }

    setZoomInfoVerifySummary(
      sumEnriched > 0 || sumCached > 0
        ? {
            kind: "success",
            enrichedCount: sumEnriched,
            cachedCount: sumCached,
            creditsUsed: sumCredits,
            listType,
          }
        : { kind: "no_matches" },
    );
    return {
      rows: merged as EnrichedCompany[] | EnrichedContact[],
      creditsUsed: sumCredits,
      commonRoomHits: sumCommonRoomHits,
    };
  };

  const runZoomVerifyAndLinkedInTail = async (
    rowsAfterAi: EnrichedCompany[] | EnrichedContact[],
    listType: "companies" | "contacts",
    signal: AbortSignal,
    context: { totalRows: number; hubspotFound: number; enrichmentStartTime: number },
  ): Promise<void> => {
    // Phase 2: ZoomInfo verify (runs before HubSpot precheck — uses ZoomInfo domain as match key)
    let rowsAfterVerify: EnrichedCompany[] | EnrichedContact[] = rowsAfterAi;
    let zoomCreditsUsed = 0;
    let commonRoomFound = 0;
    try {
      const verify = await runZoomVerify(rowsAfterAi, listType, signal);
      rowsAfterVerify = verify.rows;
      zoomCreditsUsed = verify.creditsUsed;
      commonRoomFound = verify.commonRoomHits;
    } catch (verifyErr) {
      if (verifyErr instanceof Error && verifyErr.name === "AbortError") {
        setStep("context");
        throw verifyErr;
      }
      if (verifyErr instanceof ZoomInfoVerifyError && verifyErr.zoomInfoAuthFailure) {
        setZoomInfoVerifySummary({ kind: "credentials" });
        setEnrichError(null);
      } else {
        setZoomInfoVerifySummary(null);
        setEnrichError(
          verifyErr instanceof Error
            ? verifyErr.message
            : "ZoomInfo / Common Room step failed.",
        );
      }
      rowsAfterVerify = rowsAfterAi;
    }

    // Phase 3: HubSpot precheck — now runs AFTER ZoomInfo so ZoomInfo domain is used as match key
    console.log("[Pipeline] HubSpot precheck starting after ZoomInfo");
    const rowsAfterPrecheck = await runHubSpotPreCheck(rowsAfterVerify, listType, signal);
    const hubspotCompleteCount = rowsAfterPrecheck.filter((r) => r.hubspotComplete === true).length;
    setPrecheckHubspotSkipCount(hubspotCompleteCount);
    context.hubspotFound = hubspotCompleteCount;

    let finalRows: EnrichedCompany[] | EnrichedContact[] = rowsAfterPrecheck;
    if (listType === "contacts") {
      const contactRowsAfterPrecheck = rowsAfterPrecheck as EnrichedContact[];
      const missingLinkedInTotal = contactRowsAfterPrecheck.filter((r) =>
        needsLinkedInLookup(r),
      ).length;
      if (missingLinkedInTotal > 0) {
        setProgress({
          startRow: 1,
          endRow: 0,
          totalRows: missingLinkedInTotal,
          detail: `Searching for remaining LinkedIn URLs: 0 of ${missingLinkedInTotal}…`,
        });
        finalRows = await runLinkedInLookupPass(
          contactRowsAfterPrecheck,
          signal,
          (done, total) => {
            setProgress({
              startRow: 1,
              endRow: done,
              totalRows: total,
              detail: `Searching for remaining LinkedIn URLs: ${done} of ${total}…`,
            });
          },
        );
      }
    }

    if (listType === "companies") {
      const companyRowsAfterPrecheck = rowsAfterPrecheck as EnrichedCompany[];
      const missingCompanyLinkedIn = companyRowsAfterPrecheck.filter((r) =>
        needsCompanyLinkedInLookup(r),
      ).length;
      if (missingCompanyLinkedIn > 0) {
        setProgress({
          startRow: 1,
          endRow: 0,
          totalRows: missingCompanyLinkedIn,
          detail: `Finding remaining company LinkedIn profiles… (0 of ${missingCompanyLinkedIn})`,
        });
        finalRows = await runCompanyLinkedInLookupPass(
          companyRowsAfterPrecheck,
          signal,
          (done, total) => {
            setProgress({
              startRow: 1,
              endRow: done,
              totalRows: total,
              detail: `Finding remaining company LinkedIn profiles… (${done} of ${total})`,
            });
          },
        );
      }
    }

    const withLinkedInSourceFallback = finalRows.map((row) => {
      if (row.linkedinUrl?.trim() && !row.linkedinSource?.trim()) {
        return { ...row, linkedinSource: "ai_search" as const };
      }
      return row;
    }) as EnrichedCompany[] | EnrichedContact[];
    const linkedInFoundCount = withLinkedInSourceFallback.filter(
      (r) => r.linkedinSource === "ai_search",
    ).length;
    const elapsedMinutes = Math.round((Date.now() - context.enrichmentStartTime) / 60000);
    setEventEnrichmentSummary({
      totalRows: context.totalRows,
      hubspotFound: context.hubspotFound,
      creditsUsed: zoomCreditsUsed,
      linkedInFound: linkedInFoundCount,
      elapsedMinutes,
      commonRoomFound,
    });

    await advanceToReview(withLinkedInSourceFallback, listType);
    fireEnrichmentCompleteNotification();
    if (
      typeof window !== "undefined" &&
      typeof Notification !== "undefined" &&
      Notification.permission !== "granted"
    ) {
      setCompletionBannerText("✓ Enrichment complete — your results are ready below.");
      setShowEnrichmentCompleteBanner(true);
      if (enrichmentBannerTimeoutRef.current) {
        clearTimeout(enrichmentBannerTimeoutRef.current);
      }
      enrichmentBannerTimeoutRef.current = setTimeout(() => {
        setShowEnrichmentCompleteBanner(false);
        enrichmentBannerTimeoutRef.current = null;
      }, 5000);
    }
  };

  const runHubSpotPreCheck = async (
    aiRows: EnrichedCompany[] | EnrichedContact[],
    listType: "companies" | "contacts",
    signal?: AbortSignal,
  ): Promise<EnrichedCompany[] | EnrichedContact[]> => {
    setStep("verifying");
    setProgress({
      startRow: 0,
      endRow: 0,
      totalRows: 1,
      detail: "Checking HubSpot for existing records…",
    });
    try {
      const res = await fetch("/api/hubspot/precheck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listType, rows: aiRows }),
        signal,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
        throw new Error(apiJsonErrorMessage(body) || `HubSpot pre-check failed (${res.status})`);
      }

      const payload = (await res.json()) as { results?: HubSpotPrecheckItem[] };
      const byId = new Map<string, HubSpotPrecheckItem>(
        (payload.results ?? []).map((result) => [result.id, result]),
      );

      if (listType === "companies") {
        return (aiRows as EnrichedCompany[]).map((row) => {
          const match = byId.get(row.id);
          if (!match) return row;
          const merged: EnrichedCompany = {
            ...row,
            hubspotId: match.hubspotId,
            hubspotComplete: match.hubspotComplete,
            existingData: match.existingData,
          };
          if (match.hubspotComplete) {
            mergeHubSpotExistingIntoCompany(merged, match.existingData);
          }
          return merged;
        });
      }

      return (aiRows as EnrichedContact[]).map((row) => {
        const match = byId.get(row.id);
        if (!match) return row;
        const merged: EnrichedContact = {
          ...row,
          hubspotId: match.hubspotId,
          hubspotComplete: match.hubspotComplete,
          existingData: match.existingData,
        };
        if (match.hubspotComplete) {
          mergeHubSpotExistingIntoContact(merged, match.existingData);
        }
        return merged;
      });
    } catch (error) {
      console.error("[HubSpot pre-check] failed:", error);
      return aiRows;
    } finally {
      setProgress({
        startRow: 1,
        endRow: 1,
        totalRows: 1,
        detail: "Checking HubSpot for existing records…",
      });
    }
  };

  const runEnrichment = async (context: EventContext) => {
    if (!resolvedListType) return;
    setEventContext(context);
    setEnrichError(null);
    setZoomInfoVerifySummary(null);
    if (typeof window !== "undefined" && "Notification" in window) {
      void Notification.requestPermission();
    }
    const ac = new AbortController();
    enrichAbortRef.current = ac;
    const enrichmentStartTime = Date.now();
    setStep("enriching");
    const batchSize = ENRICHMENT_BATCH_SIZE;
    const totalRows = workingRows.length;
    const numBatches = Math.max(1, Math.ceil(totalRows / batchSize));
    setProgress({
      startRow: 1,
      endRow: Math.min(batchSize, totalRows),
      totalRows,
      detail: null,
      fromCache: false,
    });
    let pausedForCostEstimate = false;
    try {
      setPrecheckHubspotSkipCount(null);
      setEventEnrichmentSummary(null);
      const batchErrors: string[] = [];
      const aiRowsMerged =
        resolvedListType === "companies"
          ? ([] as EnrichedCompany[])
          : ([] as EnrichedContact[]);

      // 1. AI enrichment — await each batch in order until all complete.
      for (let i = 0; i < numBatches; i++) {
        const start = i * batchSize;
        const batchSlice = workingRows.slice(start, start + batchSize);
        setProgress({
          startRow: start + 1,
          endRow: Math.min(start + batchSlice.length, totalRows),
          totalRows,
          detail: null,
          fromCache: false,
        });

        let res: Response;
        try {
          res = await fetch("/api/enrich/ai", {
            method: "POST",
            signal: ac.signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              rows: batchSlice,
              listType: resolvedListType,
              context,
              batchIndex: i,
              batchSize,
            }),
          });
        } catch (fetchErr) {
          if (fetchErr instanceof Error && fetchErr.name === "AbortError") {
            throw fetchErr;
          }
          const msg =
            fetchErr instanceof Error ? fetchErr.message : "Network error";
          const label = `Batch ${i + 1} of ${numBatches}: ${msg}`;
          batchErrors.push(label);
          setEnrichError(batchErrors.join(" · "));
          if (resolvedListType === "companies") {
            (aiRowsMerged as EnrichedCompany[]).push(
              ...fallbackAiCompanyRows(batchSlice as RawCompanyRow[], label),
            );
          } else {
            (aiRowsMerged as EnrichedContact[]).push(
              ...fallbackAiContactRows(batchSlice as RawContactRow[], label),
            );
          }
          continue;
        }

        if (!res.ok) {
          const errBody = (await res.json().catch(() => ({}))) as {
            error?: string;
            detail?: string;
          };
          const msg =
            apiJsonErrorMessage(errBody) || `Enrichment failed (${res.status})`;
          const label = `Batch ${i + 1} of ${numBatches}: ${msg}`;
          batchErrors.push(label);
          setEnrichError(batchErrors.join(" · "));
          if (resolvedListType === "companies") {
            (aiRowsMerged as EnrichedCompany[]).push(
              ...fallbackAiCompanyRows(batchSlice as RawCompanyRow[], label),
            );
          } else {
            (aiRowsMerged as EnrichedContact[]).push(
              ...fallbackAiContactRows(batchSlice as RawContactRow[], label),
            );
          }
          continue;
        }

        const payload = (await res.json()) as {
          rows: EnrichedCompany[] | EnrichedContact[];
          allCacheHits?: boolean;
        };
        setProgress({
          startRow: start + 1,
          endRow: Math.min(start + batchSlice.length, totalRows),
          totalRows,
          detail: null,
          fromCache: payload.allCacheHits === true,
        });
        if (resolvedListType === "companies") {
          (aiRowsMerged as EnrichedCompany[]).push(
            ...(payload.rows as EnrichedCompany[]),
          );
        } else {
          (aiRowsMerged as EnrichedContact[]).push(
            ...(payload.rows as EnrichedContact[]),
          );
        }
      }

      const aiRows = aiRowsMerged as
        | EnrichedCompany[]
        | EnrichedContact[];

      if (wizardImportMode === "bulk") {
        pausedForCostEstimate = true;
        bulkContinueRef.current = {
          rows: aiRows,
          listType: resolvedListType,
          signal: ac.signal,
        };
        setCostEstimateMeta({
          totalRows: workingRows.length,
          hubspotCompleteCount: 0,
        });
        setProgress(null);
        setStep("costestimate");
        await new Promise<void>((resolve) => {
          bulkCostGateResolveRef.current = resolve;
        });
        bulkCostGateResolveRef.current = null;
        const pending = bulkContinueRef.current;
        bulkContinueRef.current = null;
        setCostEstimateMeta(null);
        pausedForCostEstimate = false;
        if (!pending) {
          return;
        }
        await runZoomVerifyAndLinkedInTail(pending.rows, pending.listType, pending.signal, {
          totalRows,
          hubspotFound: 0,
          enrichmentStartTime,
        });
      } else {
        await runZoomVerifyAndLinkedInTail(aiRows, resolvedListType, ac.signal, {
          totalRows,
          hubspotFound: 0,
          enrichmentStartTime,
        });
      }
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        setStep("context");
        return;
      }
      setEnrichError(e instanceof Error ? e.message : "Enrichment failed.");
      setStep("context");
    } finally {
      if (!pausedForCostEstimate) {
        enrichAbortRef.current = null;
        setProgress(null);
      }
    }
  };

  const startBulkJob = useCallback(
    async (context: EventContext) => {
      if (!resolvedListType) return;
      setEventContext(context);
      setEnrichError(null);
      setZoomInfoVerifySummary(null);
      try {
        const res = await fetch("/api/jobs/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            listType: resolvedListType,
            eventContext: context,
            rows: workingRows,
          }),
        });
        if (!res.ok) {
          const errBody = await res.text().catch(() => "unknown");
          console.error("[startBulkJob] failed:", res.status, errBody);
          setEnrichError("Failed to start bulk job. Please try again.");
          setStep("context");
          return;
        }
        const payload = (await res.json()) as { jobId?: string };
        const jobId = String(payload.jobId ?? "");
        if (!jobId) {
          setEnrichError("Failed to start bulk job. Please try again.");
          setStep("context");
          return;
        }
        setBulkJobId(jobId);
        bulkCompleteNotifiedRef.current = false;
        if (typeof window !== "undefined") {
          window.sessionStorage.setItem(BULK_JOB_SESSION_KEY, jobId);
        }
        setStep("enriching");
        startJobPolling(jobId);
      } catch {
        setEnrichError("Failed to start bulk job. Please try again.");
        setStep("context");
      }
    },
    [resolvedListType, startJobPolling, workingRows],
  );

  const proceedFromCostEstimate = () => {
    const resolve = bulkCostGateResolveRef.current;
    bulkCostGateResolveRef.current = null;
    resolve?.();
  };

  const backFromCostEstimate = () => {
    bulkContinueRef.current = null;
    const resolve = bulkCostGateResolveRef.current;
    bulkCostGateResolveRef.current = null;
    resolve?.();
    setCostEstimateMeta(null);
    enrichAbortRef.current?.abort();
    enrichAbortRef.current = null;
    setProgress(null);
    setStep("context");
  };

  const cancelEnrichmentToContext = useCallback(() => {
    bulkContinueRef.current = null;
    const resolve = bulkCostGateResolveRef.current;
    bulkCostGateResolveRef.current = null;
    resolve?.();
    setCostEstimateMeta(null);
    enrichAbortRef.current?.abort();
    setProgress(null);
    setStep("context");
  }, []);

  const resetToUpload = useCallback(
    (clearSession = false) => {
      if (clearSession) {
        clearSessionSnapshot();
      }
      enrichAbortRef.current?.abort();
      enrichAbortRef.current = null;
      restoredApprovedIdsRef.current = null;
      if (sessionHydratedRef.current && clearSession) {
        window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
      }
      if (enrichmentBannerTimeoutRef.current) {
        clearTimeout(enrichmentBannerTimeoutRef.current);
        enrichmentBannerTimeoutRef.current = null;
      }
      if (uploadFlashTimeoutRef.current) {
        clearTimeout(uploadFlashTimeoutRef.current);
        uploadFlashTimeoutRef.current = null;
      }
      setShowSuccessFlash(false);
      setShowEnrichmentCompleteBanner(false);
      setBulkSmallListBypass(false);
      setShowEnrichmentInterruptedBanner(false);
      bulkContinueRef.current = null;
      const resolveGate = bulkCostGateResolveRef.current;
      bulkCostGateResolveRef.current = null;
      resolveGate?.();
      setCostEstimateMeta(null);
      setPrecheckHubspotSkipCount(null);
      setEventEnrichmentSummary(null);
      setWizardImportMode("event");
      setBulkJobId(null);
      setBulkJobState(null);
      bulkCompleteNotifiedRef.current = false;
      stopJobPolling();
      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem(BULK_JOB_SESSION_KEY);
      }
      setStep("starter");
      setFile(null);
      setResult(null);
      setListOverride(null);
      setSegmentIndex(0);
      setEnriched(null);
      setEnrichedListType(null);
      setReviewRows([]);
      setEventContext(null);
      setPushResult(null);
      setPushError(null);
      setLastPushLeadSource(null);
      setEnrichError(null);
      setZoomInfoVerifySummary(null);
      setError(null);
      setProgress(null);
      setPreviewRowsOverride(null);
      setDuplicateExemptPairs(new Set());
      setDupFeedback(null);
      setDuplicateSessionTotal(null);
      setRemoveAllDupConfirm(null);
      if (removeAllDupMsgTimeoutRef.current) {
        clearTimeout(removeAllDupMsgTimeoutRef.current);
        removeAllDupMsgTimeoutRef.current = null;
      }
    },
    [clearSessionSnapshot, stopJobPolling],
  );

  const startNewImport = useCallback(() => {
    resetToUpload(true);
  }, [resetToUpload]);

  const cancelBulkJob = useCallback(async () => {
    const activeJobId = bulkJobId;
    if (activeJobId) {
      try {
        await fetch(`/api/jobs/${encodeURIComponent(activeJobId)}/cancel`, {
          method: "POST",
        });
      } catch {
        // best-effort cancel
      }
    }
    stopJobPolling();
    setBulkJobId(null);
    setBulkJobState(null);
    bulkCompleteNotifiedRef.current = false;
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(BULK_JOB_SESSION_KEY);
    }
    resetToUpload(true);
  }, [bulkJobId, resetToUpload, stopJobPolling]);

  const runHubSpotPush = useCallback(
    async (settings: PrePushSettings) => {
      if (!enrichedListType || !eventContext) return;
      const approved = reviewRows.filter((r) => r.status === "approved");
      if (approved.length === 0) return;
      if (typeof window !== "undefined" && enrichedListType) {
        const rowsWithStableKey: Array<{ stableKey: string; linkedinUrl: string }> = [];
        for (const row of reviewRows) {
          const stableKey =
            enrichedListType === "contacts"
              ? (row as EnrichedContact).resolvedEmail?.trim().toLowerCase() ?? ""
              : (row as EnrichedCompany).domain?.trim().toLowerCase() ?? "";
          if (!stableKey) continue;
          rowsWithStableKey.push({
            stableKey,
            linkedinUrl: String(row.linkedinUrl ?? ""),
          });
        }
        const payload: PersistedManualLinkedInEdits = { rows: rowsWithStableKey };
        try {
          window.sessionStorage.setItem(MANUAL_EDITS_SESSION_KEY, JSON.stringify(payload));
        } catch {
          // Best-effort persistence for recovery on push failure.
        }
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
          const errBody = (await res.json().catch(() => ({}))) as {
            error?: string;
            detail?: string;
          };
          throw new Error(
            apiJsonErrorMessage(errBody) ||
              `HubSpot push failed (${res.status})`,
          );
        }
        const done = await consumePushNdjson(
          res,
          (p) => {
            setPushProgress({ current: p.current, total: p.total });
          },
          (list) => {
            pushListCreatedRef.current = list;
            setPushListCreatedMeta(list);
            if (typeof console !== "undefined" && console.info) {
              console.info("[hubspot/push] list_created", list.listId, list.listName);
            }
          },
        );
        setPushResult(done);
        setStep("complete");
        firePushCompleteNotification();
        if (
          typeof window !== "undefined" &&
          typeof Notification !== "undefined" &&
          Notification.permission !== "granted"
        ) {
          setCompletionBannerText("✓ HubSpot push complete — your records are ready!");
          setShowEnrichmentCompleteBanner(true);
          if (enrichmentBannerTimeoutRef.current) {
            clearTimeout(enrichmentBannerTimeoutRef.current);
          }
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
          errors: [
            {
              rowId: "push",
              error: message,
            },
          ],
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
    },
    [enrichedListType, eventContext, reviewRows],
  );

  const bc = breadcrumbIndex(step);

  const enrichmentBatchPercent = useMemo(() => {
    if (!progress || progress.totalRows <= 0) return 0;
    const totalBatches = Math.max(1, Math.ceil(progress.totalRows / ENRICHMENT_BATCH_SIZE));
    const currentBatch = Math.ceil(progress.endRow / ENRICHMENT_BATCH_SIZE);
    return Math.min(100, (currentBatch / totalBatches) * 100);
  }, [progress]);

  const signOut = useCallback(() => {
    void fetch("/api/auth/logout", { method: "POST" }).finally(() => {
      window.location.href = "/login";
    });
  }, []);

  return (
    <div className="flex min-h-screen flex-1 flex-col bg-(--bg-page)">
      {showEnrichmentCompleteBanner ? (
        <div
          className="fixed top-14 left-0 right-0 z-40 border-b border-emerald-700/20 bg-emerald-600 px-4 py-3 text-center text-sm font-medium text-white shadow-sm"
          role="status"
        >
          {completionBannerText}
        </div>
      ) : null}

      <header className="fixed top-0 left-0 right-0 z-50 grid h-14 w-full grid-cols-1 items-center bg-(--realm-navy) px-4 shadow-(--shadow-card) sm:px-6 md:grid-cols-[1fr_auto_1fr]">
        <div
          className="min-w-0 whitespace-nowrap text-lg font-semibold tracking-tight text-white md:col-start-1 md:row-start-1"
          style={{ textShadow: "0 1px 3px rgba(0,0,0,0.4)" }}
        >
          <span className="text-white font-semibold">Realm</span>
          <span className="text-white font-semibold">.Security</span>
        </div>
        {step !== "starter" ? (
          <nav
            className="hidden max-w-[min(100vw-8rem,40rem)] flex-wrap items-center justify-center gap-x-0.5 gap-y-1 text-center text-[10px] leading-tight sm:max-w-none sm:text-xs md:col-start-2 md:row-start-1 md:flex md:text-sm"
            aria-label="Import steps"
          >
            {NAV_STEPS.map((label, i) => {
              const isCurrent = i === bc;
              const isDone = i < bc;
              return (
                <span key={label} className="inline-flex items-center">
                  {i > 0 ? (
                    <span className="px-0.5 text-white/30 sm:px-1" aria-hidden>
                      ·
                    </span>
                  ) : null}
                  <span
                    className={
                      isCurrent
                        ? "font-semibold text-white"
                        : isDone
                          ? "text-white/60"
                          : "text-white/30"
                    }
                  >
                    {label}
                  </span>
                </span>
              );
            })}
          </nav>
        ) : null}
        <div className="hidden min-w-0 md:col-start-3 md:row-start-1 md:flex md:justify-end">
          <button
            type="button"
            onClick={signOut}
            className="rounded border border-white/30 px-2.5 py-1 text-xs font-medium text-white hover:bg-white/10"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-7xl min-h-0 flex-1 flex-col gap-6 px-4 pb-8 pt-22 sm:px-6">
        {showEnrichmentInterruptedBanner ? (
          <div
            className="flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950 sm:flex-row sm:items-center sm:justify-between dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-100"
            role="status"
          >
            <p className="text-sm">Enrichment was interrupted. Click Run to start again.</p>
            <button
              type="button"
              onClick={() => setShowEnrichmentInterruptedBanner(false)}
              className="shrink-0 rounded-lg border border-amber-800/20 bg-white px-3 py-1.5 text-sm font-medium text-amber-950 hover:bg-amber-100 dark:border-amber-600/40 dark:bg-amber-900/60 dark:text-amber-50 dark:hover:bg-amber-900"
            >
              Dismiss
            </button>
          </div>
        ) : null}

        {step === "enriched" ? (
          <button
            type="button"
            onClick={() => setStep("prereview")}
            className="self-start text-sm text-(--text-muted) hover:text-(--text-primary)"
          >
            ← Back to Pre-Review
          </button>
        ) : null}
        {step === "prereview" ? (
          <button
            type="button"
            onClick={() => resetToUpload(true)}
            className="self-start text-sm text-(--text-muted) hover:text-(--text-primary)"
          >
            ← Start Over
          </button>
        ) : null}

        {step === "starter" && (
          <StarterScreen
            onSelectMode={(mode) => {
              setWizardImportMode(mode);
              setStep("upload");
            }}
          />
        )}

        {step === "costestimate" && costEstimateMeta ? (
          <CostEstimateScreen
            totalRows={costEstimateMeta.totalRows}
            hubspotCompleteCount={costEstimateMeta.hubspotCompleteCount}
            onProceed={proceedFromCostEstimate}
            onBack={backFromCostEstimate}
          />
        ) : null}

        {step === "upload" && (
          <div className="flex w-full flex-1 flex-col justify-center py-8">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
            {!result ? (
              <button
                type="button"
                onClick={() => setStep("starter")}
                className="self-start text-sm text-(--text-muted) hover:text-(--text-primary)"
              >
                ← Back
              </button>
            ) : null}
            {!result && (
              <section
                className={`relative flex min-h-55 w-full cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-(--border-default) bg-(--bg-card) px-6 py-10 transition-colors ${
                  busy ? "opacity-80" : "hover:border-(--realm-purple) hover:bg-(--bg-muted)"
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
                  <p className="text-base font-medium text-(--text-primary)">
                    Drop a file here, or click to browse
                  </p>
                  <p className="mt-2 text-sm text-(--text-muted)">
                    Accepted: .csv, .xlsx, .xls — max 5 MB
                  </p>
                </div>
              </section>
            )}

            {error && (
              <div
                className="w-full rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-100"
                role="alert"
              >
                {error}
              </div>
            )}

            {result && file && showSuccessFlash && (
              <div
                className={`flex w-full flex-col items-center justify-center py-16 ${UPLOAD_FADE_IN}`}
                role="status"
                aria-live="polite"
              >
                <span className="text-7xl leading-none text-green-500" aria-hidden>
                  ✓
                </span>
                <p className={`mt-4 text-base font-medium text-(--text-primary) ${UPLOAD_FADE_IN}`}>
                  File uploaded successfully
                </p>
              </div>
            )}

            {result && file && !showSuccessFlash && showBulkSmallListWarning && (
              <section
                className={`flex w-full flex-col gap-6 rounded-xl border border-(--border-default) bg-(--bg-card) p-5 shadow-(--shadow-card) sm:p-6 ${UPLOAD_FADE_IN}`}
              >
                <div
                  className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-100"
                  role="status"
                >
                  <p>
                    This list has fewer than 200 records. Consider using Marketing Event List mode
                    instead.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded-lg border border-amber-800/25 bg-white px-3 py-1.5 text-sm font-medium text-amber-950 hover:bg-amber-100 dark:border-amber-600/40 dark:bg-amber-900/50 dark:text-amber-50 dark:hover:bg-amber-900/80"
                      onClick={() => resetToUpload(false)}
                    >
                      Go Back to Start
                    </button>
                    <button
                      type="button"
                      className={`${PRIMARY_ACTION_BUTTON} px-3 py-1.5 text-xs`}
                      onClick={() => setBulkSmallListBypass(true)}
                    >
                      Continue Anyway
                    </button>
                  </div>
                </div>
              </section>
            )}

            {result && file && !showSuccessFlash && !showBulkSmallListWarning && (
              <section
                className={`flex w-full flex-col gap-6 rounded-xl border border-(--border-default) bg-(--bg-card) p-5 shadow-(--shadow-card) sm:p-6 ${UPLOAD_FADE_IN}`}
              >
                <div className="flex w-full flex-wrap items-start justify-between gap-3 text-sm text-(--text-primary)">
                  <p className="min-w-0 flex-1">
                    ✓ <span className="font-semibold">{file.name}</span> — {effectiveRowCount}{" "}
                    row{effectiveRowCount === 1 ? "" : "s"} detected as{" "}
                    <span className="font-semibold capitalize">
                      {effectiveListType === "unknown" ? "unknown" : effectiveListType}
                    </span>
                  </p>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                    <button
                      type="button"
                      className="text-sm font-medium text-(--realm-purple) hover:text-(--realm-purple-hover) hover:underline"
                      onClick={() => {
                        startNewImport();
                      }}
                    >
                      Change File
                    </button>
                  </div>
                </div>

                {duplicatePair && resolvedListType ? (
                  <div
                    className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-100"
                    role="status"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="min-w-0 flex-1 text-sm font-bold">
                        Duplicate found: &quot;
                        {duplicateDisplayName(workingRows[duplicatePair[0]]!, resolvedListType)}
                        &quot;
                      </p>
                      {duplicateSessionTotal != null && duplicateSessionTotal > 1 ? (
                        <p className="shrink-0 text-xs text-amber-900/60 dark:text-amber-200/70">
                          {duplicatePairSerial} of {duplicateSessionTotal} duplicates
                        </p>
                      ) : null}
                    </div>
                    <div className="mt-3 flex w-full flex-wrap items-center justify-between gap-2 gap-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          className="rounded-lg border border-amber-700/30 bg-white px-3 py-1.5 text-sm font-medium text-amber-950 hover:bg-amber-100 dark:border-amber-600/40 dark:bg-amber-900/50 dark:text-amber-50 dark:hover:bg-amber-900/80"
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
                        <button
                          type="button"
                          className="rounded-lg border border-amber-700/30 bg-white px-3 py-1.5 text-sm font-medium text-amber-950 hover:bg-amber-100 dark:border-amber-600/40 dark:bg-amber-900/50 dark:text-amber-50 dark:hover:bg-amber-900/80"
                          onClick={() => {
                            setDuplicateExemptPairs((prev) =>
                              new Set(prev).add(`${duplicatePair[0]}-${duplicatePair[1]}`),
                            );
                            setDupFeedback("kept");
                          }}
                        >
                          Keep Both
                        </button>
                      </div>
                      {remainingDuplicatePairsCount > 1 ? (
                        <button
                          type="button"
                          className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-600 hover:border-red-400 hover:bg-red-50 dark:border-red-700/50 dark:bg-zinc-950 dark:text-red-400 dark:hover:border-red-500 dark:hover:bg-red-950/30"
                          onClick={() => {
                            if (!resolvedListType) return;
                            const base = previewRowsOverride ?? displayRows;
                            const pairCountBefore = listAllDuplicatePairs(
                              base,
                              resolvedListType,
                              duplicateExemptPairs,
                            ).length;
                            const duplicateBannerTotal =
                              duplicateSessionTotal ?? pairCountBefore;
                            const { rows: next } = removeAllDuplicateRows(
                              base,
                              resolvedListType,
                            );
                            setPreviewRowsOverride(next);
                            setDuplicateExemptPairs(new Set());
                            setDupFeedback(null);
                            if (removeAllDupMsgTimeoutRef.current) {
                              clearTimeout(removeAllDupMsgTimeoutRef.current);
                            }
                            const dupWord =
                              duplicateBannerTotal === 1 ? "duplicate" : "duplicates";
                            setRemoveAllDupConfirm(
                              `Removed ${duplicateBannerTotal} ${dupWord} from this import.`,
                            );
                            removeAllDupMsgTimeoutRef.current = setTimeout(() => {
                              setRemoveAllDupConfirm(null);
                              removeAllDupMsgTimeoutRef.current = null;
                            }, 4000);
                          }}
                        >
                          Remove All Duplicates
                        </button>
                      ) : null}
                    </div>
                    {dupFeedback ? (
                      <p className="mt-2 text-xs text-amber-800 dark:text-amber-200">
                        {dupFeedback === "removed"
                          ? "Removed the later duplicate row from this import."
                          : "Kept both rows for this pair."}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {removeAllDupConfirm ? (
                  <div
                    className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950 dark:border-emerald-800/50 dark:bg-emerald-950/35 dark:text-emerald-100"
                    role="status"
                    aria-live="polite"
                  >
                    {removeAllDupConfirm}
                  </div>
                ) : null}

                <div className="space-y-2">
                  <div className="flex items-end justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-(--text-primary)">
                        Preview — your uploaded data as parsed
                      </p>
                      <p className="text-xs text-(--text-muted)">
                        This is your raw data before any enrichment. Column headers have been mapped to standard field names where recognized.
                      </p>
                    </div>
                    <p className="text-xs font-medium text-(--text-secondary)">{effectiveRowCount} records found</p>
                  </div>
                <div className="max-h-72 overflow-y-auto overflow-x-auto rounded-lg border border-(--border-default)">
                    <table className="min-w-full border-collapse text-left text-xs sm:text-sm">
                      <thead className="sticky top-0 z-1 bg-(--bg-muted)">
                        <tr>
                          {previewColumnMeta.map((col) => (
                            <th
                              key={col.key}
                              className="whitespace-nowrap border-b border-(--border-default) px-3 py-2 font-semibold text-(--text-secondary)"
                            >
                              <div className="flex flex-col">
                                <span className="font-semibold text-(--text-primary)">{col.label}</span>
                                {col.recognized ? (
                                  <span className="text-[11px] font-normal text-(--text-muted)">
                                    {col.originalHeader}
                                  </span>
                                ) : (
                                  <span className="text-[11px] font-normal text-(--text-muted)">
                                    {col.originalHeader} - Extra column - will be carried through.
                                  </span>
                                )}
                              </div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {previewRowsForTable.map((row, ri) => (
                          <tr
                            key={ri}
                            className={ri % 2 === 0 ? "bg-(--bg-card)" : "bg-(--bg-page)"}
                          >
                            {previewColumnMeta.map((col) => (
                              <td
                                key={col.key}
                                className="border-b border-(--border-default) px-3 py-2 text-(--text-primary)"
                              >
                                {(row as Record<string, string | undefined>)[col.key] ?? ""}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                </div>
                <div className="text-xs text-(--text-muted)">
                  {effectiveListType === "unknown"
                    ? "Could not detect list type — please select below."
                    : `Detected as: ${effectiveListType === "contacts" ? "Contact list" : "Company list"}`}
                </div>
                {effectiveListType === "unknown" ? (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      className={`${PRIMARY_ACTION_BUTTON} px-3 py-1.5 text-xs`}
                      onClick={() => {
                        if (!file) return;
                        void parseFile(file, "companies");
                      }}
                    >
                      Company list
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      className={`${PRIMARY_ACTION_BUTTON} px-3 py-1.5 text-xs`}
                      onClick={() => {
                        if (!file) return;
                        void parseFile(file, "contacts");
                      }}
                    >
                      Contact list
                    </button>
                  </div>
                ) : null}
                </div>

                {!showBulkSmallListWarning ? (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      disabled={!resolvedListType || effectiveRowCount === 0}
                      onClick={() => setStep("context")}
                      className={PRIMARY_ACTION_BUTTON}
                    >
                      Continue →
                    </button>
                  </div>
                ) : null}
              </section>
            )}
            </div>
          </div>
        )}

        {step === "context" && resolvedListType && (
          <div className="flex w-full flex-1 flex-col justify-center gap-4 py-6">
            <button
              type="button"
              onClick={() => {
                setStep("upload");
                setEnrichError(null);
              }}
              className="self-start text-sm text-(--text-muted) hover:text-(--text-primary)"
            >
              ← Back
            </button>
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
              sourceFileName={file?.name ?? null}
              initialValues={eventContext}
              importMode={wizardImportMode}
              onSubmit={(ctx) =>
                wizardImportMode === "bulk"
                  ? void startBulkJob(ctx)
                  : void runEnrichment(ctx)
              }
            />
          </div>
        )}

        {step === "enriching" && wizardImportMode === "bulk" && bulkJobId ? (
          <BulkProgressScreen
            jobState={bulkJobState}
            onCancel={() => {
              void cancelBulkJob();
            }}
            onContinueToReview={() => void handleContinueToReview()}
            continueLoading={bulkRowsContinueLoading}
          />
        ) : null}

        {step === "enriching" && wizardImportMode === "event" && progress && (
          <div className="flex flex-col gap-4">
            <div className="rounded-xl border border-(--border-default) bg-(--bg-card) p-5 shadow-(--shadow-card)">
              <p
                className="mb-2 text-center text-base font-semibold text-(--realm-navy)"
                role="status"
              >
                {progress.fromCache
                  ? `Loaded from cache: rows ${progress.startRow}–${progress.endRow} of ${progress.totalRows}...`
                  : `AI analyzing rows ${progress.startRow}–${progress.endRow} of ${progress.totalRows}...`}
              </p>
              <div
                className="h-2 w-full overflow-hidden rounded-full bg-(--bg-muted)"
                aria-hidden
              >
                <div
                  className="h-full max-w-full rounded-full bg-(--realm-purple) transition-all duration-400 ease-out"
                  style={{ width: `${enrichmentBatchPercent}%` }}
                />
              </div>
              <p className="mt-3 text-center text-sm text-(--text-muted)">
                You can leave this tab. We&apos;ll notify you when enrichment is complete.
              </p>
            </div>
            <button
              type="button"
              className="self-center rounded-lg border border-(--border-default) bg-white px-4 py-2 text-sm font-medium text-(--text-primary) transition-colors hover:bg-(--bg-muted)"
              onClick={cancelEnrichmentToContext}
            >
              Cancel
            </button>
          </div>
        )}

        {step === "verifying" && progress && (
          <div className="flex flex-col gap-3">
            <EnrichmentProgress
              endRow={progress.endRow}
              totalRows={progress.totalRows}
              verifyDetail={progress.detail}
            />
            {wizardImportMode === "event" &&
            precheckHubspotSkipCount != null &&
            precheckHubspotSkipCount > 0 ? (
              <p className="text-center text-xs text-(--text-muted)" role="status">
                {precheckHubspotSkipCount} record{precheckHubspotSkipCount === 1 ? "" : "s"} found in
                HubSpot ✓
              </p>
            ) : null}
          </div>
        )}

        {step === "pushing" && pushProgress && (
          <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100" role="status">
              Pushing record {pushProgress.current} of {pushProgress.total} to HubSpot…
            </p>
            {pushListCreatedMeta ? (
              <p
                className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-950 dark:border-emerald-800/50 dark:bg-emerald-950/35 dark:text-emerald-100"
                role="status"
              >
                HubSpot list created: <span className="font-medium">{pushListCreatedMeta.listName}</span>{" "}
                — list ID <span className="font-mono">{pushListCreatedMeta.listId}</span>
                {pushListCreatedMeta.folderId ? (
                  <span className="block mt-1 text-emerald-900/80 dark:text-emerald-200/80">
                    Folder ID: <span className="font-mono">{pushListCreatedMeta.folderId}</span>
                  </span>
                ) : null}
              </p>
            ) : null}
            <p className="text-sm text-(--text-muted) text-center mt-2">
              You can leave this tab. We&apos;ll notify you when the push is complete.
            </p>
          </div>
        )}

        {step === "prereview" && enriched && enrichedListType && (
          <PreReviewGate
            rows={enriched}
            listType={enrichedListType}
            enrichmentSummary={eventEnrichmentSummary}
            onContinue={(updatedRows) => {
              const lt = enrichedListType!;
              const finalizeOpts = {
                importMode: eventContext?.importMode ?? wizardImportMode,
              };
              const finalized =
                lt === "companies"
                  ? finalizeRowsForReview(updatedRows as EnrichedCompany[], "companies", finalizeOpts)
                  : finalizeRowsForReview(updatedRows as EnrichedContact[], "contacts", finalizeOpts);
              setEnriched(finalized);
              setStep("enriched");
            }}
          />
        )}

        {step === "enriched" && enriched && enrichedListType && (
          <section className="rounded-xl border border-(--border-default) bg-(--bg-card) p-5 pb-24 shadow-(--shadow-card)">
            {pushError && (
              <div
                className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-100"
                role="alert"
              >
                {pushError}
              </div>
            )}
            {enrichError && (
              <div
                className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-700/80 dark:bg-amber-950/40 dark:text-amber-100"
                role="status"
              >
                {enrichError}
              </div>
            )}
            {zoomInfoVerifySummary?.kind === "credentials" ? (
              <div
                className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-700/80 dark:bg-amber-950/40 dark:text-amber-100"
                role="alert"
              >
                ZoomInfo: credentials not configured
              </div>
            ) : null}
            <div className="mt-4">
              <ReviewTable
                rows={reviewRows}
                listType={enrichedListType}
                onRowsChange={setReviewRows}
                onApprove={() => {
                  setPushError(null);
                  setStep("prepush");
                }}
              />
            </div>
          </section>
        )}

        {step === "prepush" &&
          enriched &&
          enrichedListType &&
          eventContext &&
          approvedRowsForPush.length > 0 && (
          <PrePushScreen
            listType={enrichedListType}
            approvedRows={approvedRowsForPush}
            defaultListName={eventContext.eventName}
            defaultLeadSourceDescription={
              enrichedListType === "contacts"
                ? formatContactDefaultLeadSourceDescription(eventContext)
                : ""
            }
            onBack={() => setStep("enriched")}
            onPush={(settings) => void runHubSpotPush(settings)}
          />
        )}

        {step === "complete" && pushResult && (
          <SuccessScreen
            result={pushResult}
            rowsById={approvedRowsById}
            leadSourceUsed={lastPushLeadSource ?? undefined}
            onStartNew={startNewImport}
          />
        )}
      </main>

    </div>
  );
}
