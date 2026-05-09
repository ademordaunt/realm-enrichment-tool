import type { EnrichedCompany, EnrichedContact } from "@/lib/utils/types";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isValidEnrichedCompany(row: unknown): row is EnrichedCompany {
  if (!isRecord(row)) return false;
  return typeof row.id === "string" && row.id.trim() !== "" && typeof row.reviewBucket === "string";
}

export function isValidEnrichedContact(row: unknown): row is EnrichedContact {
  if (!isRecord(row)) return false;
  return typeof row.id === "string" && row.id.trim() !== "" && typeof row.reviewBucket === "string";
}
