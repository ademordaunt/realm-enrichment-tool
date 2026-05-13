import Anthropic from "@anthropic-ai/sdk";
import { v4 as uuidv4 } from "uuid";
import {
  getCachedCompany,
  getCachedContact,
  setCachedCompany,
  setCachedContact,
} from "@/lib/cache/enrichment-cache";
import { chunk } from "@/lib/utils/array";
import { isPersonalEmail } from "@/lib/utils/contacts";
import type {
  EnrichedCompany,
  EnrichedContact,
  EventContext,
  IdentityConfidence,
  RawCompanyRow,
  RawContactRow,
} from "@/lib/utils/types";

/** Batch size for AI enrichment (client batched requests + streaming generator; keep in sync with progress UI). */
import { ENRICHMENT_BATCH_SIZE } from "@/lib/enrichment/enrichment-utils";
const BATCH_SIZE = ENRICHMENT_BATCH_SIZE;

export const COMPANY_MODEL = "claude-sonnet-4-6" as const;

function toTitleCase(str: string): string {
  return str.replace(/\w\S*/g, (txt) =>
    txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase(),
  );
}

/** Old cache rows may have `linkedinUrl` without `linkedinSource`; infer from enrichment flags. */
function withInferredLinkedinSource<T extends EnrichedCompany | EnrichedContact>(cached: T): T {
  const url = cached.linkedinUrl?.trim();
  const src = cached.linkedinSource?.trim();
  if (!url || src) return cached;
  if (cached.enrichedByZoomInfo) return { ...cached, linkedinSource: "zoominfo" };
  if (cached.enrichedByCommonRoom) return { ...cached, linkedinSource: "commonroom" };
  if (cached.enrichedByAI) return { ...cached, linkedinSource: "ai_search" };
  return cached;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Strip ```json ... ``` or ``` ... ``` fences from model output */
function stripMarkdownFences(text: string): string {
  let s = text.trim();
  const fence = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/im;
  const m = s.match(fence);
  if (m?.[1]) {
    s = m[1].trim();
  }
  return s;
}

function parseJsonArray<T = unknown>(text: string): T[] {
  const rawText = text;
  const cleaned = stripMarkdownFences(text);

  // 1) Try strict JSON parse first.
  try {
    const parsed: unknown = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      return parsed as T[];
    }
  } catch {
    // Continue to recovery strategies below.
  }

  // 2) Try parsing only the detected array slice between first `[` and last `]`.
  try {
    const firstBracket = cleaned.indexOf("[");
    const lastBracket = cleaned.lastIndexOf("]");
    if (firstBracket >= 0 && lastBracket > firstBracket) {
      const arraySlice = cleaned.slice(firstBracket, lastBracket + 1);
      const parsedSlice: unknown = JSON.parse(arraySlice);
      if (Array.isArray(parsedSlice)) {
        return parsedSlice as T[];
      }
    }
  } catch {
    // Continue to recovery strategies below.
  }

  // 3) Best-effort object recovery: split on "},{" and parse each object individually.
  try {
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      const objectBlob = cleaned.slice(firstBrace, lastBrace + 1);
      const chunks = objectBlob.split(/\}\s*,\s*\{/g);
      const recovered: T[] = [];
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]!;
        const candidate =
          i === 0
            ? `${chunk.trim()}${i === chunks.length - 1 ? "" : "}"}`
            : `${i === chunks.length - 1 ? "" : "{"}${chunk.trim()}`;
        const normalized = candidate.startsWith("{")
          ? candidate
          : `{${candidate}`;
        const finalized = normalized.endsWith("}")
          ? normalized
          : `${normalized}}`;
        try {
          const parsedObj = JSON.parse(finalized) as T;
          if (parsedObj && typeof parsedObj === "object") {
            recovered.push(parsedObj);
          }
        } catch {
          // Skip malformed object and continue.
        }
      }
      if (recovered.length > 0) {
        return recovered;
      }
    }
  } catch {
    // Fall through to final empty-array fallback.
  }

  // 4) Hard fail fallback: log and continue the import flow with an empty batch.
  console.error(
    "[AI Enricher] JSON parse failed for batch, raw response:",
    rawText.slice(0, 500),
  );
  return [];
}

export function normalizeConfidence(
  v: unknown,
): IdentityConfidence {
  const s = String(v ?? "").toLowerCase();
  if (s === "high" || s === "medium" || s === "low" || s === "unresolved") {
    return s;
  }
  if (s.includes("high")) return "high";
  if (s.includes("medium")) return "medium";
  if (s.includes("low")) return "low";
  if (s.includes("unresolved")) return "unresolved";
  return "medium";
}

function extractTextFromMessage(msg: {
  content: Array<{ type: string; text?: string }>;
}): string {
  const parts: string[] = [];
  for (const block of msg.content) {
    if (block.type === "text" && block.text) {
      parts.push(block.text);
    }
  }
  return parts.join("\n").trim();
}

/**
 * Standard Claude completion (no tools).
 */
export async function runClaudeWithWebSearch(
  client: Anthropic,
  system: string,
  userText: string,
): Promise<string> {
  for (let attempt = 0; attempt <= 3; attempt++) {
    try {
      const response = await client.messages.create({
        model: COMPANY_MODEL,
        max_tokens: 4096,
        system,
        messages: [{ role: "user", content: userText }],
      });

      const text = extractTextFromMessage(response);
      if (!text) {
        throw new Error("No text content in Claude response; try again or check API logs.");
      }
      return text;
    } catch (err) {
      if (err instanceof Anthropic.APIError && err.status === 529 && attempt < 3) {
        await sleep(1000 * Math.pow(2, attempt)); // 1000, 2000, 4000
        continue;
      }
      throw err;
    }
  }
  // Unreachable: loop always returns or throws, but satisfies TypeScript.
  throw new Error("Unexpected exit from retry loop.");
}

/** Location/date clause for company prompts — avoids a blank region when none was provided. */
function companyEventLocationClause(context: EventContext): string {
  const r = String(context.region ?? "").trim();
  const d = String(context.eventDate ?? "").trim();
  const dateSuffix = d ? ` (${d})` : "";
  if (r) return `held in ${r}${dateSuffix}`;
  return d
    ? `(${d}). This is a virtual/national event with no specific region`
    : "This is a virtual/national event with no specific region";
}

/** Region line for contact prompts — explicit copy when region is omitted. */
function contactRegionContextLine(context: EventContext): string {
  const r = String(context.region ?? "").trim();
  if (r) return `Region: ${r}.`;
  return "This is a virtual/national event with no specific region.";
}

export function buildCompanySystemPrompt(context: EventContext): string {
  return `You resolve company identities from partial or abbreviated names for ${context.eventName}, a ${context.audienceLevel} cybersecurity event, ${companyEventLocationClause(context)}.

For each company name, do ONLY the following:
- Resolve the raw input to the official company name the row most likely refers to.
- Find the most likely corporate website domain (no protocol, e.g. example.com).
- Assign confidence: HIGH if you are certain, MEDIUM if it is the most likely match but could be wrong, LOW if it is only a best guess, UNRESOLVED if you cannot determine a defensible match.
- Give one plain-English sentence in aiReasoning explaining WHY you chose that confidence level.

Do NOT return or guess: LinkedIn URLs, employee counts, industry, revenue, description, city, state, or full website URLs. Those are filled from other systems.

Use event context when disambiguating (e.g. acronyms, regional names).

Return a JSON array only. No markdown, no preamble. Each element must be an object with keys:
rawInput (string), resolvedName (string), domain (string), confidenceScore ("high"|"medium"|"low"|"unresolved"), aiReasoning (string), enrichedByAI (boolean, always true).`;
}

export function buildCompanyUserPrompt(batch: RawCompanyRow[]): string {
  const lines = batch.map((r, i) => `${i + 1}. ${r.rawName}`);
  return `Resolve these company names:\n${lines.join("\n")}`;
}

export function buildContactSystemPrompt(context: EventContext): string {
  const d = String(context.eventDate ?? "").trim();
  const dateLine = d ? ` Event date: ${d}.` : "";
  return `You resolve B2B contact identity from list data. Contacts attended ${context.eventName}, a ${context.audienceLevel} cybersecurity event.
${contactRegionContextLine(context)}${dateLine}

For each contact, do ONLY the following:
- Confirm or correct first name, last name, and company name as they apply to the same person implied by the input.
- Set resolvedEmail to the email from the input when present; never invent a different work email.
- Set title to the title from the input when present; if the input has no title, return an empty string — do not guess a title.
- Assign confidence: HIGH if you are certain this is a real, correctly identified person; MEDIUM if likely but could be wrong; LOW for a weak guess; UNRESOLVED if identity cannot be determined.
- Give one plain-English sentence in aiReasoning explaining WHY you chose that confidence level.

Do NOT return LinkedIn URLs. Do not guess titles when absent.

Return a JSON array only. No markdown, no preamble. Same order and count as the input list. Each element must be an object with keys:
rawInput (string), firstName (string), lastName (string), resolvedCompany (string), resolvedEmail (string), title (string), confidenceScore ("high"|"medium"|"low"|"unresolved"), aiReasoning (string), enrichedByAI (boolean, always true).`;
}

export function buildContactUserPrompt(batch: RawContactRow[]): string {
  const lines = batch.map((r, i) => formatContactPromptLine(r, i));
  return `Resolve these contacts in order (output array must have one object per line, same order). Each object rawInput must exactly match the corresponding line below:\n${lines.join("\n")}`;
}

function mapCompanyAiToEnriched(
  raw: Record<string, unknown>,
  row: RawCompanyRow,
): EnrichedCompany {
  const confidenceScore = normalizeConfidence(raw.confidenceScore);
  const domain = String(raw.domain ?? "").trim();
  return {
    id: uuidv4(),
    rawInput: String(raw.rawInput ?? row.rawName),
    resolvedName: String(raw.resolvedName ?? row.rawName),
    confidenceScore,
    identityConfidence: confidenceScore,
    aiReasoning: String(raw.aiReasoning ?? ""),
    needsReview: confidenceScore !== "high",
    domain,
    domainSource: domain ? "ai_guess" : "",
    website: "",
    state: "",
    numberOfEmployees: null,
    linkedinUrl: "",
    linkedinSource: "",
    reviewBucket: "needs_review",
    enrichedByZoomInfo: false,
    enrichedByCommonRoom: false,
    enrichedByAI: true,
    status: "pending",
    // Carry CSV pre-enriched fields as Phase 1 source
    csvDomain: row.domain?.trim() || undefined,
    csvState: row.state?.trim() || undefined,
    csvEmployees: row.employees?.trim() || undefined,
    csvIndustry: row.industry?.trim() || undefined,
  };
}

function mapContactAiToEnriched(
  raw: Record<string, unknown>,
  row: RawContactRow,
): EnrichedContact {
  const confidenceScore = normalizeConfidence(raw.confidenceScore);
  const rawEmail = row.email?.trim() ?? "";
  const aiResolved = String(raw.resolvedEmail ?? "").trim();
  const resolvedEmail = rawEmail || aiResolved;
  const firstNameRaw = String(raw.firstName ?? row.firstName ?? "").trim() || row.firstName;
  const lastNameRaw = String(raw.lastName ?? row.lastName ?? "").trim() || row.lastName;
  const firstName = toTitleCase(firstNameRaw);
  const lastName = toTitleCase(lastNameRaw);
  const existingCompany = row.resolvedCompany?.trim() || row.company?.trim() || "";
  const resolvedCompany =
    String(raw.resolvedCompany ?? "").trim() || existingCompany;
  const titleFromRow = row.title?.trim() ?? "";
  const titleFromAi = String(raw.title ?? "").trim();
  const title = titleFromRow || titleFromAi;
  const phone = row.phone?.trim() ?? "";
  const emailForPersonal = resolvedEmail || rawEmail;
  return {
    id: uuidv4(),
    firstName,
    lastName,
    rawEmail,
    rawCompany: row.company?.trim() ?? "",
    resolvedEmail,
    isPersonalEmail: isPersonalEmail(emailForPersonal),
    resolvedCompany,
    confidenceScore,
    identityConfidence: confidenceScore,
    aiReasoning: String(raw.aiReasoning ?? ""),
    needsReview: confidenceScore !== "high",
    title,
    linkedinUrl: "",
    linkedinSource: "",
    reviewBucket: "needs_review",
    companyDomain: row.companyDomain?.trim() ?? "",
    location: row.location?.trim() ?? "",
    leadSource: row.leadSource?.trim() ?? "",
    leadSourceDescription: row.leadSourceDescription?.trim() ?? "",
    notes: row.notes?.trim() ?? "",
    membershipNotes: row.membershipNotes?.trim() ?? "",
    phone: phone || undefined,
    enrichedByZoomInfo: false,
    enrichedByCommonRoom: false,
    enrichedByAI: true,
    status: "pending",
    attended: row.attended?.trim() || undefined,
    eventFormat: row.eventFormat?.trim() || undefined,
    // Carry CSV pre-enriched fields as Phase 1 source
    csvTitle: row.title?.trim() || undefined,
    csvDomain: row.companyDomain?.trim() || undefined,
    csvState: row.state?.trim() || undefined,
    csvEmployees: row.employees?.trim() || undefined,
    csvIndustry: row.industry?.trim() || undefined,
    emailSource: rawEmail ? "csv" : undefined,
  };
}

function isCompleteCompanyRow(row: RawCompanyRow): boolean {
  const resolvedName = String(row.resolvedName ?? row.resolvedname ?? "").trim();
  const domain = String(row.domain ?? "").trim();
  const state = String(row.state ?? "").trim();
  const employees = String(row.numberOfEmployees ?? row.numberofemployees ?? "").trim();
  return Boolean(resolvedName && domain && state && employees);
}

function mapPresetCompanyRow(row: RawCompanyRow): EnrichedCompany {
  const resolvedName = String(row.resolvedName ?? row.resolvedname ?? row.rawName).trim();
  const domain = String(row.domain ?? "").trim();
  const state = String(row.state ?? "").trim();
  const website = String(row.website ?? "").trim();
  const linkedinUrl = String(row.linkedinUrl ?? row.linkedinurl ?? "").trim();
  const employeesRaw = row.numberOfEmployees ?? row.numberofemployees;
  const parsedEmployees = Number(employeesRaw);
  const numberOfEmployees =
    employeesRaw === null || employeesRaw === undefined || String(employeesRaw).trim() === ""
      ? null
      : Number.isFinite(parsedEmployees)
        ? parsedEmployees
        : null;
  return {
    id: uuidv4(),
    rawInput: row.rawName,
    resolvedName,
    confidenceScore: "high",
    identityConfidence: "high",
    aiReasoning: "All required company fields were pre-populated.",
    needsReview: false,
    domain,
    domainSource: domain ? "csv" : "",
    website,
    state,
    numberOfEmployees,
    linkedinUrl,
    linkedinSource: linkedinUrl ? "" : "",
    reviewBucket: "needs_review",
    enrichedByZoomInfo: false,
    enrichedByCommonRoom: false,
    enrichedByAI: false,
    status: "pending",
    csvDomain: row.domain?.trim() || undefined,
    csvState: row.state?.trim() || undefined,
    csvEmployees: row.employees?.trim() || undefined,
    csvIndustry: row.industry?.trim() || undefined,
  };
}

function mapPresetContactRow(
  row: RawContactRow,
  linkedInUrl = "",
  linkedInFromAi = false,
): EnrichedContact {
  const email = row.email?.trim() ?? "";
  const company = row.resolvedCompany?.trim() || row.company?.trim() || "";
  const phone = row.phone?.trim() ?? "";
  return {
    id: uuidv4(),
    firstName: toTitleCase(row.firstName),
    lastName: toTitleCase(row.lastName),
    rawEmail: email,
    rawCompany: row.company?.trim() ?? "",
    resolvedEmail: email,
    isPersonalEmail: isPersonalEmail(email),
    resolvedCompany: company,
    confidenceScore: "high",
    identityConfidence: "high",
    aiReasoning: linkedInFromAi
      ? "LinkedIn profile URL was resolved using AI web search."
      : "All required contact fields were pre-populated.",
    needsReview: false,
    title: row.title?.trim() ?? "",
    linkedinUrl: linkedInUrl,
    linkedinSource: linkedInUrl && linkedInFromAi ? "ai_search" : "",
    reviewBucket: "needs_review",
    companyDomain: row.companyDomain?.trim() ?? "",
    location: row.location?.trim() ?? "",
    leadSource: row.leadSource?.trim() ?? "",
    leadSourceDescription: row.leadSourceDescription?.trim() ?? "",
    notes: row.notes?.trim() ?? "",
    membershipNotes: row.membershipNotes?.trim() ?? "",
    phone: phone || undefined,
    enrichedByZoomInfo: false,
    enrichedByCommonRoom: false,
    enrichedByAI: linkedInFromAi,
    status: "pending",
    attended: row.attended?.trim() || undefined,
    eventFormat: row.eventFormat?.trim() || undefined,
    csvTitle: row.title?.trim() || undefined,
    csvDomain: row.companyDomain?.trim() || undefined,
    csvState: row.state?.trim() || undefined,
    csvEmployees: row.employees?.trim() || undefined,
    csvIndustry: row.industry?.trim() || undefined,
    emailSource: email ? "csv" : undefined,
  };
}

function isFullyPopulatedContactRow(row: RawContactRow): boolean {
  const firstName = row.firstName?.trim() ?? "";
  const lastName = row.lastName?.trim() ?? "";
  const title = row.title?.trim() ?? "";
  const email = row.email?.trim() ?? "";
  const company = row.resolvedCompany?.trim() || row.company?.trim() || "";
  const companyDomain = row.companyDomain?.trim() ?? "";
  return Boolean(firstName && lastName && email && company && title && companyDomain);
}

/** One numbered line for prompts and matching `rawInput` from the model. */
function formatContactPromptLine(row: RawContactRow, index: number): string {
  const bits = [
    `${index + 1}.`,
    [row.firstName, row.lastName].filter(Boolean).join(" "),
    row.email ? `email: ${row.email}` : "",
    row.title ? `title: ${row.title}` : "",
    row.company ? `company: ${row.company}` : "",
    row.location ? `location: ${row.location}` : "",
  ].filter(Boolean);
  return bits.join(" ");
}

export async function enrichCompanyBatch(
  client: Anthropic,
  batch: RawCompanyRow[],
  context: EventContext,
): Promise<EnrichedCompany[]> {
  const partial: (EnrichedCompany | undefined)[] = new Array(batch.length);
  const toEnrich: RawCompanyRow[] = [];
  const positions: number[] = [];
  for (let i = 0; i < batch.length; i++) {
    const row = batch[i]!;
    if (isCompleteCompanyRow(row)) {
      partial[i] = mapPresetCompanyRow(row);
    } else {
      toEnrich.push(row);
      positions.push(i);
    }
  }
  if (toEnrich.length === 0) {
    return partial.map((r) => r!);
  }

  const system = buildCompanySystemPrompt(context);
  const user = buildCompanyUserPrompt(toEnrich);
  const text = await runClaudeWithWebSearch(client, system, user);
  const parsed = parseJsonArray<Record<string, unknown>>(text);
  const byInput = new Map<string, Record<string, unknown>>();
  for (const item of parsed) {
    const k = String(item.rawInput ?? "").trim().toLowerCase();
    if (k) byInput.set(k, item);
  }
  const aiRows = toEnrich.map((row, i) => {
    const k = row.rawName.trim().toLowerCase();
    const rec = byInput.get(k) ?? parsed[i] ?? {};
    return mapCompanyAiToEnriched(rec, row);
  });
  for (let i = 0; i < positions.length; i++) {
    partial[positions[i]!] = aiRows[i]!;
  }
  return partial.map((r) => r!);
}

export async function enrichContactBatch(
  client: Anthropic,
  batch: RawContactRow[],
  context: EventContext,
): Promise<EnrichedContact[]> {
  const partial: (EnrichedContact | undefined)[] = new Array(batch.length);
  const toEnrich: RawContactRow[] = [];
  const positions: number[] = [];
  for (let i = 0; i < batch.length; i++) {
    const row = batch[i]!;
    if (isFullyPopulatedContactRow(row)) {
      const existingLinkedIn =
        row.linkedinUrl?.trim() || row.linkedInUrl?.trim() || "";
      partial[i] = mapPresetContactRow(row, existingLinkedIn, false);
    } else {
      toEnrich.push(row);
      positions.push(i);
    }
  }
  if (toEnrich.length === 0) {
    return partial.map((r) => r!);
  }

  const system = buildContactSystemPrompt(context);
  const user = buildContactUserPrompt(toEnrich);
  const text = await runClaudeWithWebSearch(client, system, user);
  const parsed = parseJsonArray<Record<string, unknown>>(text);
  const byInput = new Map<string, Record<string, unknown>>();
  for (const item of parsed) {
    const k = String(item.rawInput ?? "").trim().toLowerCase();
    if (k) byInput.set(k, item);
  }
  const aiRows = toEnrich.map((row, i) => {
    const expected = formatContactPromptLine(row, i).trim().toLowerCase();
    const rec = byInput.get(expected) ?? parsed[i] ?? {};
    return mapContactAiToEnriched(rec, row);
  });
  for (let i = 0; i < positions.length; i++) {
    partial[positions[i]!] = aiRows[i]!;
  }
  return partial.map((r) => r!);
}

async function resolveCompanyBatchFromKv(batch: RawCompanyRow[]): Promise<{
  partial: (EnrichedCompany | undefined)[];
  toEnrich: RawCompanyRow[];
  enrichPositions: number[];
  allCacheHits: boolean;
}> {
  const partial: (EnrichedCompany | undefined)[] = new Array(batch.length);
  const toEnrich: RawCompanyRow[] = [];
  const enrichPositions: number[] = [];
  for (let i = 0; i < batch.length; i++) {
    const row = batch[i]!;
    const cacheKeyName = row.resolvedName ?? row.rawName;
    const cached = await getCachedCompany(cacheKeyName);
    if (cached) {
      const rowId = (row as { id?: string }).id;
      partial[i] = withInferredLinkedinSource({
        ...cached,
        id: typeof rowId === "string" && rowId ? rowId : cached.id,
      });
    } else {
      toEnrich.push(row);
      enrichPositions.push(i);
    }
  }
  const allCacheHits = batch.length > 0 && toEnrich.length === 0;
  return { partial, toEnrich, enrichPositions, allCacheHits };
}

async function fillCompanyBatchFromAi(
  client: Anthropic,
  context: EventContext,
  partial: (EnrichedCompany | undefined)[],
  toEnrich: RawCompanyRow[],
  enrichPositions: number[],
): Promise<EnrichedCompany[]> {
  if (toEnrich.length === 0) {
    return partial.map((r) => r!);
  }
  const aiPart = await enrichCompanyBatch(client, toEnrich, context);
  for (let j = 0; j < toEnrich.length; j++) {
    const row = toEnrich[j]!;
    const enrichedRow = aiPart[j]!;
    const cacheKeyName = row.resolvedName ?? row.rawName;
    await setCachedCompany(cacheKeyName, enrichedRow);
    partial[enrichPositions[j]!] = enrichedRow;
  }
  return partial.map((r) => r!);
}

export async function enrichCompanyBatchWithCache(
  client: Anthropic,
  batch: RawCompanyRow[],
  context: EventContext,
): Promise<{ rows: EnrichedCompany[]; allCacheHits: boolean }> {
  const resolved = await resolveCompanyBatchFromKv(batch);
  const rows = await fillCompanyBatchFromAi(
    client,
    context,
    resolved.partial,
    resolved.toEnrich,
    resolved.enrichPositions,
  );
  return { rows, allCacheHits: resolved.allCacheHits };
}

async function resolveContactBatchFromKv(batch: RawContactRow[]): Promise<{
  partial: (EnrichedContact | undefined)[];
  toEnrich: RawContactRow[];
  enrichPositions: number[];
  allCacheHits: boolean;
}> {
  const partial: (EnrichedContact | undefined)[] = new Array(batch.length);
  const toEnrich: RawContactRow[] = [];
  const enrichPositions: number[] = [];
  for (let i = 0; i < batch.length; i++) {
    const row = batch[i]!;
    if (isFullyPopulatedContactRow(row)) {
      const existingLinkedIn =
        row.linkedinUrl?.trim() || row.linkedInUrl?.trim() || "";
      partial[i] = mapPresetContactRow(row, existingLinkedIn, false);
      continue;
    }
    const email = row.email?.trim() ?? "";
    if (!email) {
      toEnrich.push(row);
      enrichPositions.push(i);
      continue;
    }
    const cached = await getCachedContact(email);
    if (cached) {
      const rowId = (row as { id?: string }).id;
      partial[i] = withInferredLinkedinSource({
        ...cached,
        id: typeof rowId === "string" && rowId ? rowId : cached.id,
      });
    } else {
      toEnrich.push(row);
      enrichPositions.push(i);
    }
  }
  const allCacheHits = batch.length > 0 && toEnrich.length === 0;
  return { partial, toEnrich, enrichPositions, allCacheHits };
}

async function fillContactBatchFromAi(
  client: Anthropic,
  batch: RawContactRow[],
  context: EventContext,
  partial: (EnrichedContact | undefined)[],
  toEnrich: RawContactRow[],
  enrichPositions: number[],
): Promise<EnrichedContact[]> {
  if (toEnrich.length === 0) {
    return partial.map((r) => r!);
  }
  const aiPart = await enrichContactBatch(client, toEnrich, context);
  for (let j = 0; j < toEnrich.length; j++) {
    const row = toEnrich[j]!;
    const enrichedRow = aiPart[j]!;
    const cacheEmail = row.email?.trim() ?? "";
    if (cacheEmail) {
      await setCachedContact(cacheEmail, enrichedRow);
    }
    partial[enrichPositions[j]!] = enrichedRow;
  }
  return partial.map((r) => r!);
}

export async function enrichContactBatchWithCache(
  client: Anthropic,
  batch: RawContactRow[],
  context: EventContext,
): Promise<{ rows: EnrichedContact[]; allCacheHits: boolean }> {
  const resolved = await resolveContactBatchFromKv(batch);
  const rows = await fillContactBatchFromAi(
    client,
    batch,
    context,
    resolved.partial,
    resolved.toEnrich,
    resolved.enrichPositions,
  );
  return { rows, allCacheHits: resolved.allCacheHits };
}

export async function* enrichRowsWithProgress(
  client: Anthropic,
  rows: RawCompanyRow[] | RawContactRow[],
  listType: "companies" | "contacts",
  context: EventContext,
): AsyncGenerator<
  | { type: "progress"; start: number; end: number; total: number; fromCache?: boolean }
  | {
      type: "done";
      listType: "companies" | "contacts";
      rows: EnrichedCompany[] | EnrichedContact[];
    }
  | { type: "error"; message: string },
  void,
  void
> {
  const total = rows.length;
  if (total === 0) {
    yield {
      type: "done",
      listType,
      rows: listType === "companies" ? [] : [],
    };
    return;
  }

  const batches =
    listType === "companies"
      ? chunk(rows as RawCompanyRow[], BATCH_SIZE)
      : chunk(rows as RawContactRow[], BATCH_SIZE);

  const accumulated: EnrichedCompany[] | EnrichedContact[] =
    listType === "companies" ? [] : [];

  let offset = 0;
  try {
    for (const batch of batches) {
      const start = offset + 1;
      const end = offset + batch.length;

      if (listType === "companies") {
        const rawBatch = batch as RawCompanyRow[];
        const resolved = await resolveCompanyBatchFromKv(rawBatch);
        yield {
          type: "progress",
          start,
          end,
          total,
          fromCache: resolved.allCacheHits,
        };
        const part = await fillCompanyBatchFromAi(
          client,
          context,
          resolved.partial,
          resolved.toEnrich,
          resolved.enrichPositions,
        );
        (accumulated as EnrichedCompany[]).push(...part);
      } else {
        const rawBatch = batch as RawContactRow[];
        const resolved = await resolveContactBatchFromKv(rawBatch);
        yield {
          type: "progress",
          start,
          end,
          total,
          fromCache: resolved.allCacheHits,
        };
        const part = await fillContactBatchFromAi(
          client,
          rawBatch,
          context,
          resolved.partial,
          resolved.toEnrich,
          resolved.enrichPositions,
        );
        (accumulated as EnrichedContact[]).push(...part);
      }
      offset += batch.length;
    }

    yield { type: "done", listType, rows: accumulated };
  } catch (e) {
    yield {
      type: "error",
      message: e instanceof Error ? e.message : "Enrichment failed.",
    };
  }
}
