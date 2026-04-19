/** List classification after parsing uploaded files */
export type ListType = "companies" | "contacts" | "unknown";

/** Company list input */
export interface RawCompanyRow {
  rawName: string;
  [key: string]: string;
}

/** Contact list input */
export interface RawContactRow {
  firstName: string;
  lastName: string;
  email?: string;
  title?: string;
  company?: string;
  location?: string;
  notes?: string;
  /** CSV "Membership Notes" / notes columns mapped for import review. */
  membershipNotes?: string;
  leadSource?: string;
  leadSourceDescription?: string;
  [key: string]: string | undefined;
}

/** Enriched Company Record */
export interface EnrichedCompany {
  id: string;
  rawInput: string;
  resolvedName: string;
  confidenceScore: "high" | "medium" | "low" | "unresolved";
  aiReasoning: string;
  needsReview: boolean;
  domain: string;
  website: string;
  state: string;
  numberOfEmployees: number | null;
  linkedinUrl: string;
  enrichedByZoomInfo: boolean;
  enrichedByCommonRoom: boolean;
  enrichedByAI: boolean;
  status: "pending" | "approved" | "skipped" | "error";
  hubspotId?: string;
  hubspotAction?: "create" | "update";
}

/** Enriched Contact Record */
export interface EnrichedContact {
  id: string;
  firstName: string;
  lastName: string;
  rawEmail: string;
  rawCompany: string;
  resolvedEmail: string;
  isPersonalEmail: boolean;
  resolvedCompany: string;
  confidenceScore: "high" | "medium" | "low" | "unresolved";
  aiReasoning: string;
  needsReview: boolean;
  title: string;
  linkedinUrl: string;
  companyDomain: string;
  location: string;
  leadSource: string;
  leadSourceDescription: string;
  notes: string;
  membershipNotes: string;
  enrichedByZoomInfo: boolean;
  enrichedByCommonRoom: boolean;
  enrichedByAI: boolean;
  status: "pending" | "approved" | "skipped" | "error";
  hubspotId?: string;
  hubspotAction?: "create" | "update";
}

/** Event context passed to AI enrichment (lead source is set at pre-push import). */
export interface EventContext {
  eventName: string;
  /** Month and year for prompts, e.g. "March 2026". */
  eventDate: string;
  /** State / region (full name from state list, or National / International). */
  region: string;
  audienceLevel: string;
  listType: "companies" | "contacts";
}

/** One segment when a CSV contains multiple header blocks */
export interface ParseMultiEventSegment {
  label: string;
  /** 1-based file line of the header row for this segment */
  headerLine: number;
  listType: ListType;
  rows: Array<RawCompanyRow | RawContactRow>;
}

/** JSON body from GET /api/hubspot/folders */
export interface HubSpotFoldersApiResponse {
  folders?: Array<{ id: string; name: string }>;
  error?: string;
}

/** Successful parse response from POST /api/parse */
export interface ParseResponse {
  listType: ListType;
  rows: Array<RawCompanyRow | RawContactRow>;
  totalRows: number;
  warnings: string[];
  /** Normalized header strings from the primary (first) segment */
  headers?: string[];
  /** Present when a second header row splits the file */
  multiEvent?: {
    segments: ParseMultiEventSegment[];
  };
}
