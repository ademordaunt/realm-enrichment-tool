/** List classification after parsing uploaded files */
export type ListType = "companies" | "contacts" | "unknown";

export type IdentityConfidence = "high" | "medium" | "low" | "unresolved";

export type DomainSource =
  | "zoominfo_verified"
  | "hubspot_verified"
  | "ai_guess"
  | "csv"
  | "";

export type LinkedInSource = "hubspot" | "zoominfo" | "commonroom" | "ai_search" | "manual" | "";

export type ReviewBucket = "trusted" | "needs_review" | "excluded";

export type ExclusionReason =
  | "international"
  | "government"
  | "low_confidence"
  | "unresolved"
  | "no_email"
  | "duplicate"
  | "incomplete"
  | "personal_email"
  | "missing_required_fields";

/** Company list input */
export interface RawCompanyRow {
  rawName: string;
  /** Domain / website pre-populated in CSV. */
  domain?: string;
  /** State / region pre-populated in CSV. */
  state?: string;
  /** Employee count pre-populated in CSV. */
  employees?: string;
  /** Industry pre-populated in CSV. */
  industry?: string;
  [key: string]: string | undefined;
}

/** Contact list input */
export interface RawContactRow {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  title?: string;
  company?: string;
  location?: string;
  notes?: string;
  /** CSV "Membership Notes" / notes columns mapped for import review. */
  membershipNotes?: string;
  leadSource?: string;
  leadSourceDescription?: string;
  /** Event attendance flag (e.g. "Yes" / "No") from event CSVs. */
  attended?: string;
  /** Event format (e.g. "In-Person", "Virtual") from event CSVs. */
  eventFormat?: string;
  /** Company domain / website pre-populated in CSV. */
  companyDomain?: string;
  /** State / region pre-populated in CSV. */
  state?: string;
  /** Employee count pre-populated in CSV. */
  employees?: string;
  /** Industry pre-populated in CSV. */
  industry?: string;
  [key: string]: string | undefined;
}

/** Enriched Company Record */
export interface EnrichedCompany {
  id: string;
  rawInput: string;
  resolvedName: string;
  confidenceScore: "high" | "medium" | "low" | "unresolved";
  identityConfidence: IdentityConfidence;
  aiReasoning: string;
  needsReview: boolean;
  domain: string;
  domainSource: DomainSource;
  website: string;
  state: string;
  numberOfEmployees: number | null;
  linkedinUrl: string;
  linkedinSource: LinkedInSource;
  reviewBucket: ReviewBucket;
  exclusionReason?: ExclusionReason;
  enrichedByZoomInfo: boolean;
  enrichedByCommonRoom: boolean;
  enrichedByAI: boolean;
  status: "pending" | "approved" | "skipped" | "error";
  hubspotId?: string | null;
  hubspotComplete?: boolean;
  hubspotAction?: "create" | "update";
  existingData?: Record<string, string>;
  revenue?: number;
  industry?: string;
  description?: string;
  city?: string;
  phone?: string;
  companyType?: string;
  /** CSV-sourced domain (Phase 1 source — lower trust than ZoomInfo). */
  csvDomain?: string;
  /** CSV-sourced state (Phase 1 fallback). */
  csvState?: string;
  /** CSV-sourced employee count (Phase 1 fallback). */
  csvEmployees?: string;
  /** CSV-sourced industry (Phase 1 fallback). */
  csvIndustry?: string;
  /** True when LinkedIn URL came from AI web search — row stays Trusted but flagged amber. */
  linkedinAmberFlag?: boolean;
  /** Sort tier within Trusted bucket: 1 = amber flag (top), 2 = clean. */
  trustedSortTier?: number;
  /** True when row was matched by company name only (no domain). Low-confidence match. */
  matchedByName?: boolean;
  /** Manual override from Excluded international -> Needs Review. */
  manuallyIncluded?: boolean;
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
  identityConfidence: IdentityConfidence;
  aiReasoning: string;
  needsReview: boolean;
  title: string;
  linkedinUrl: string;
  linkedinSource: LinkedInSource;
  reviewBucket: ReviewBucket;
  exclusionReason?: ExclusionReason;
  companyDomain: string;
  location: string;
  leadSource: string;
  leadSourceDescription: string;
  notes: string;
  membershipNotes: string;
  phone?: string;
  enrichedByZoomInfo: boolean;
  enrichedByCommonRoom: boolean;
  enrichedByAI: boolean;
  status: "pending" | "approved" | "skipped" | "error";
  hubspotId?: string | null;
  hubspotComplete?: boolean;
  hubspotAction?: "create" | "update";
  existingData?: Record<string, string>;
  /** ZoomInfo → HubSpot only (push); not shown in review UI. */
  ziManagementLevel?: string;
  ziJobFunction?: string;
  ziCompanyEmployeeCount?: string;
  ziCompanyPrimaryIndustry?: string;
  ziCompanyWebsite?: string;
  /** ZoomInfo contact accuracy score (0–100). Internal signal — never pushed to HubSpot. */
  ziContactAccuracyScore?: number;
  /** True when ziContactAccuracyScore < 25 — ZoomInfo enrichment data discarded for this contact. */
  ziMatchDiscarded?: boolean;
  /** Personal email captured from CSV when ZoomInfo returned a work email. */
  personalEmail?: string;
  /** Source of resolvedEmail: "csv" | "zoominfo" | "personal". */
  emailSource?: "csv" | "zoominfo" | "personal";
  /** HubSpot company id resolved via domain lookup for association. */
  hubspotCompanyId?: string;
  /** CSV-sourced title (highest trust for contacts). */
  csvTitle?: string;
  /** CSV-sourced company domain (Phase 1 fallback). */
  csvDomain?: string;
  /** CSV-sourced state (Phase 1 fallback). */
  csvState?: string;
  /** CSV-sourced employee count (Phase 1 fallback). */
  csvEmployees?: string;
  /** CSV-sourced industry (Phase 1 fallback). */
  csvIndustry?: string;
  /** True when LinkedIn URL came from AI web search — row stays Trusted but flagged amber. */
  linkedinAmberFlag?: boolean;
  /** Sort tier within Trusted bucket: 1 = amber flag (top), 2 = clean. */
  trustedSortTier?: number;
  /** Event attendance flag from CSV. */
  attended?: string;
  /** Event format from CSV. */
  eventFormat?: string;
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
  /** Browser-driven event list vs large bulk list (cost estimate UI only until Phase 3). */
  importMode: "event" | "bulk";
}

export interface BulkJobState {
  jobId: string;
  status: "queued" | "running" | "complete" | "failed" | "cancelled";
  importMode: "bulk";
  listType: "companies" | "contacts";
  eventContext: EventContext;
  totalRows: number;
  processedRows: number;
  currentPhase: "ai" | "precheck" | "zoominfo" | "linkedin" | "complete";
  aiComplete: boolean;
  precheckComplete: boolean;
  zoomInfoComplete: boolean;
  linkedInComplete: boolean;
  enrichedCount: number;
  cachedCount: number;
  hubspotSkippedCount: number;
  creditsUsed: number;
  linkedInFromAiCount?: number;
  checkpointChunk: number;
  totalAiChunks: number;
  totalZoomChunks: number;
  /** Unix timestamp (ms) for the latest worker heartbeat written at chunk start. */
  lastHeartbeatAt?: number;
  /** User-facing failure reason for terminal failed states (including watchdog transitions). */
  failureReason?: string;
  error?: string;
  startedAt: string;
  completedAt?: string;
}

/** One segment when a CSV contains multiple header blocks */
export interface ParseMultiEventSegment {
  label: string;
  /** 1-based file line of the header row for this segment */
  headerLine: number;
  listType: ListType;
  rows: Array<RawCompanyRow | RawContactRow>;
  /** Normalized header keys used by parser mapping. */
  headers?: string[];
  /** Original uploaded header labels for this segment. */
  originalHeaders?: string[];
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
  /** Original uploaded header labels from the primary (first) segment. */
  originalHeaders?: string[];
  /** Present when a second header row splits the file */
  multiEvent?: {
    segments: ParseMultiEventSegment[];
  };
}

export interface EnrichmentSummary {
  totalRows: number;
  hubspotFound: number;
  creditsUsed: number;
  linkedInFound: number;
  elapsedMinutes: number;
  commonRoomFound?: number;
}
