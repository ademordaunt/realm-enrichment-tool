import Anthropic from "@anthropic-ai/sdk";
import { v4 as uuidv4 } from "uuid";
import type {
  EnrichedCompany,
  EnrichedContact,
  EventContext,
  RawCompanyRow,
  RawContactRow,
} from "@/lib/utils/types";

const BATCH_SIZE = 10;

export const COMPANY_MODEL = "claude-sonnet-4-6" as const;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/** Strip ```json ... ``` or ``` ... ``` fences from model output */
export function stripMarkdownFences(text: string): string {
  let s = text.trim();
  const fence = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/im;
  const m = s.match(fence);
  if (m?.[1]) {
    s = m[1].trim();
  }
  return s;
}

export function parseJsonArray<T = unknown>(text: string): T[] {
  const cleaned = stripMarkdownFences(text);
  const parsed: unknown = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) {
    throw new Error("Expected a JSON array from the model.");
  }
  return parsed as T[];
}

function normalizeConfidence(
  v: unknown,
): "high" | "medium" | "low" | "unresolved" {
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
}

export function buildCompanySystemPrompt(context: EventContext): string {
  return `You are a B2B data researcher specializing in identifying companies from partial or abbreviated names. You are working with a list from ${context.eventName}, a ${context.audienceLevel} event focused on cybersecurity, held in ${context.region} (${context.eventDate}).

For each company name provided, identify the most likely real company, return its official name, website domain, HQ state, approximate employee count, and LinkedIn company page URL.

IMPORTANT REASONING RULES:
- Use event context heavily. A "RUSH" on a Midwest CISO event is almost certainly Rush University Medical Center, not Rush Communications.
- For acronyms like "HCSC", reason from context: this is Health Care Service Corporation, a major Chicago-based health insurer.
- Return confidence: HIGH (you are certain), MEDIUM (most likely but could be wrong), LOW (best guess), UNRESOLVED (genuinely cannot determine).
- Always explain your reasoning in 1-2 sentences.
- Use web search to verify domain names and LinkedIn URLs.

Return a JSON array only. No markdown, no preamble. Each element must be an object with keys:
rawInput (string), resolvedName (string), domain (string), website (string), state (string), numberOfEmployees (number or null), linkedinUrl (string), confidenceScore ("high"|"medium"|"low"|"unresolved"), aiReasoning (string), enrichedByAI (boolean, always true).`;
}

export function buildCompanyUserPrompt(batch: RawCompanyRow[]): string {
  const lines = batch.map((r, i) => `${i + 1}. ${r.rawName}`);
  return `Resolve these company names:\n${lines.join("\n")}`;
}

export function buildContactSystemPrompt(context: EventContext): string {
  return `You are a B2B contact researcher. Given a person's name, title, and company, find their professional work email, company domain, and LinkedIn profile.

Context — these contacts attended ${context.eventName}, a ${context.audienceLevel} cybersecurity event.
Region: ${context.region}. Event date: ${context.eventDate}.

For each contact:
- If the email looks personal (gmail, yahoo, hotmail, icloud), find their likely work email based on company email patterns.
- Find the LinkedIn profile URL using name + company + title.
- Return confidence score and reasoning.

Return a JSON array only. No markdown, no preamble. Each element must be an object with keys:
resolvedEmail (string), isPersonalEmail (boolean), resolvedCompany (string), companyDomain (string), linkedinUrl (string), confidenceScore ("high"|"medium"|"low"|"unresolved"), aiReasoning (string), enrichedByAI (boolean, always true).`;
}

export function buildContactUserPrompt(batch: RawContactRow[]): string {
  const lines = batch.map((r, i) => {
    const bits = [
      `${i + 1}.`,
      [r.firstName, r.lastName].filter(Boolean).join(" "),
      r.email ? `email: ${r.email}` : "",
      r.title ? `title: ${r.title}` : "",
      r.company ? `company: ${r.company}` : "",
      r.location ? `location: ${r.location}` : "",
    ].filter(Boolean);
    return bits.join(" ");
  });
  return `Resolve these contacts:\n${lines.join("\n")}`;
}

function mapCompanyAiToEnriched(
  raw: Record<string, unknown>,
  row: RawCompanyRow,
): EnrichedCompany {
  const confidenceScore = normalizeConfidence(raw.confidenceScore);
  return {
    id: uuidv4(),
    rawInput: String(raw.rawInput ?? row.rawName),
    resolvedName: String(raw.resolvedName ?? row.rawName),
    confidenceScore,
    aiReasoning: String(raw.aiReasoning ?? ""),
    needsReview: confidenceScore !== "high",
    domain: String(raw.domain ?? ""),
    website: String(raw.website ?? ""),
    state: String(raw.state ?? ""),
    numberOfEmployees:
      raw.numberOfEmployees === null || raw.numberOfEmployees === undefined
        ? null
        : Number(raw.numberOfEmployees),
    linkedinUrl: String(raw.linkedinUrl ?? ""),
    enrichedByZoomInfo: false,
    enrichedByCommonRoom: false,
    enrichedByAI: true,
    status: "pending",
  };
}

function mapContactAiToEnriched(
  raw: Record<string, unknown>,
  row: RawContactRow,
): EnrichedContact {
  const confidenceScore = normalizeConfidence(raw.confidenceScore);
  const rawEmail = row.email?.trim() ?? "";
  return {
    id: uuidv4(),
    firstName: row.firstName,
    lastName: row.lastName,
    rawEmail,
    rawCompany: row.company?.trim() ?? "",
    resolvedEmail: String(raw.resolvedEmail ?? rawEmail),
    isPersonalEmail: Boolean(raw.isPersonalEmail),
    resolvedCompany: String(raw.resolvedCompany ?? row.company ?? ""),
    confidenceScore,
    aiReasoning: String(raw.aiReasoning ?? ""),
    needsReview: confidenceScore !== "high",
    title: row.title?.trim() ?? "",
    linkedinUrl: String(raw.linkedinUrl ?? ""),
    companyDomain: String(raw.companyDomain ?? ""),
    location: row.location?.trim() ?? "",
    leadSource: row.leadSource?.trim() ?? "",
    leadSourceDescription: row.leadSourceDescription?.trim() ?? "",
    notes: row.notes?.trim() ?? "",
    enrichedByZoomInfo: false,
    enrichedByCommonRoom: false,
    enrichedByAI: true,
    status: "pending",
  };
}

export async function enrichCompanyBatch(
  client: Anthropic,
  batch: RawCompanyRow[],
  context: EventContext,
): Promise<EnrichedCompany[]> {
  const system = buildCompanySystemPrompt(context);
  const user = buildCompanyUserPrompt(batch);
  const text = await runClaudeWithWebSearch(client, system, user);
  const parsed = parseJsonArray<Record<string, unknown>>(text);
  const byInput = new Map<string, Record<string, unknown>>();
  for (const item of parsed) {
    const k = String(item.rawInput ?? "").trim().toLowerCase();
    if (k) byInput.set(k, item);
  }
  return batch.map((row, i) => {
    const k = row.rawName.trim().toLowerCase();
    const rec = byInput.get(k) ?? parsed[i] ?? {};
    return mapCompanyAiToEnriched(rec, row);
  });
}

export async function enrichContactBatch(
  client: Anthropic,
  batch: RawContactRow[],
  context: EventContext,
): Promise<EnrichedContact[]> {
  const system = buildContactSystemPrompt(context);
  const user = buildContactUserPrompt(batch);
  const text = await runClaudeWithWebSearch(client, system, user);
  const parsed = parseJsonArray<Record<string, unknown>>(text);
  return batch.map((row, idx) => {
    const rec = parsed[idx] ?? {};
    return mapContactAiToEnriched(rec, row);
  });
}

export async function* enrichRowsWithProgress(
  client: Anthropic,
  rows: RawCompanyRow[] | RawContactRow[],
  listType: "companies" | "contacts",
  context: EventContext,
): AsyncGenerator<
  | { type: "progress"; start: number; end: number; total: number }
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
      yield { type: "progress", start, end, total };

      if (listType === "companies") {
        const part = await enrichCompanyBatch(
          client,
          batch as RawCompanyRow[],
          context,
        );
        (accumulated as EnrichedCompany[]).push(...part);
      } else {
        const part = await enrichContactBatch(
          client,
          batch as RawContactRow[],
          context,
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
