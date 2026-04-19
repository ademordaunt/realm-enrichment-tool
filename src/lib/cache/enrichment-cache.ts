import { kv } from "@vercel/kv";
import type { EnrichedCompany, EnrichedContact } from "@/lib/utils/types";

const COMPANY_TTL = 60 * 60 * 24 * 30; // 30 days in seconds
const CONTACT_TTL = 60 * 60 * 24 * 30;

function normalizeCompanyKey(name: string): string {
  return `company:${name.toLowerCase().trim().replace(/[^a-z0-9]/g, "_")}`;
}

function normalizeContactKey(email: string): string {
  return `contact:${email.toLowerCase().trim()}`;
}

export async function getCachedCompany(name: string): Promise<EnrichedCompany | null> {
  try {
    const result = await kv.get<EnrichedCompany>(normalizeCompanyKey(name));
    return result ?? null;
  } catch {
    return null; // Never let cache errors block enrichment
  }
}

export async function setCachedCompany(name: string, data: EnrichedCompany): Promise<void> {
  try {
    await kv.set(normalizeCompanyKey(name), data, { ex: COMPANY_TTL });
  } catch {
    // Silently fail — caching is best-effort
  }
}

export async function getCachedContact(email: string): Promise<EnrichedContact | null> {
  try {
    const result = await kv.get<EnrichedContact>(normalizeContactKey(email));
    return result ?? null;
  } catch {
    return null;
  }
}

export async function setCachedContact(email: string, data: EnrichedContact): Promise<void> {
  try {
    await kv.set(normalizeContactKey(email), data, { ex: CONTACT_TTL });
  } catch {
    // Silently fail
  }
}
