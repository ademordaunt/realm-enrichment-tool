"use client";

import { useCallback, useEffect, useRef } from "react";
import type { EnrichedCompany, EnrichedContact, ParseResponse, RawCompanyRow, RawContactRow } from "@/lib/utils/types";
import type { EventContext } from "@/lib/utils/types";
import type { HubSpotPushDonePayload } from "@/lib/hubspot/push-result";

type Step =
  | "starter" | "upload" | "context" | "enriching" | "verifying"
  | "costestimate" | "prereview" | "enriched" | "prepush" | "pushing" | "complete";

type ProgressState = {
  startRow: number;
  endRow: number;
  totalRows: number;
  detail?: string | null;
  fromCache?: boolean;
} | null;

const SESSION_STORAGE_KEY = "realm-enrichment-session-v1";
const BULK_JOB_SESSION_KEY = "realm-bulk-job-id";

type PersistedSession = {
  step: Step;
  wizardImportMode?: "event" | "bulk";
  enrichedData: EnrichedCompany[] | EnrichedContact[] | null;
  approvedRows: Array<EnrichedCompany | EnrichedContact>;
  eventContext: EventContext | null;
  listType: "companies" | "contacts" | null;
  parseResult: ParseResponse | null;
};

interface WizardSessionOptions {
  // Data for session write
  step: Step;
  wizardImportMode: "event" | "bulk";
  enriched: EnrichedCompany[] | EnrichedContact[] | null;
  approvedRowsForPush: Array<EnrichedCompany | EnrichedContact>;
  eventContext: EventContext | null;
  enrichedListType: "companies" | "contacts" | null;
  result: ParseResponse | null;

  // Setters used during restore
  setStep: (s: Step) => void;
  setWizardImportMode: (m: "event" | "bulk") => void;
  setEnriched: (e: EnrichedCompany[] | EnrichedContact[] | null) => void;
  setEnrichedListType: (lt: "companies" | "contacts" | null) => void;
  setListOverride: (lt: "companies" | "contacts" | null) => void;
  setEventContext: (ctx: EventContext | null) => void;
  setResult: (r: ParseResponse | null) => void;
  setShowEnrichmentInterruptedBanner: (b: boolean) => void;
  setBulkJobId: (id: string | null) => void;

  // Setters used during full reset
  setSegmentIndex: (i: number) => void;
  setFile: (f: File | null) => void;
  setReviewRows: (rows: EnrichedCompany[] | EnrichedContact[]) => void;
  setPushResult: (r: HubSpotPushDonePayload | null) => void;
  setPushError: (e: string | null) => void;
  setLastPushLeadSource: (s: string | null) => void;
  setEnrichError: (e: string | null) => void;
  setError: (e: string | null) => void;
  setProgress: (p: ProgressState) => void;
  setPreviewRowsOverride: (rows: Array<RawCompanyRow | RawContactRow> | null) => void;
  setDuplicateExemptPairs: (s: Set<string>) => void;
  setDupFeedback: (f: "removed" | "kept" | null) => void;
  setDuplicateSessionTotal: (n: number | null) => void;
  setRemoveAllDupConfirm: (s: string | null) => void;
  setShowSuccessFlash: (b: boolean) => void;
  setShowEnrichmentCompleteBanner: (b: boolean) => void;
  setBulkSmallListBypass: (b: boolean) => void;

  // Cross-hook reset callbacks
  onResetEnrichment: () => void;
  onResetBulkJob: () => void;

  // Ref passed in from caller (React Compiler disallows mutating refs returned from hooks)
  restoredApprovedIdsRef: React.MutableRefObject<Set<string> | null>;

  // Timeout refs for cleanup during reset
  enrichmentBannerTimeoutRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  uploadFlashTimeoutRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  removeAllDupMsgTimeoutRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
}

export function useWizardSession(options: WizardSessionOptions) {
  const sessionHydratedRef = useRef(false);

  const {
    step, wizardImportMode, enriched, approvedRowsForPush, eventContext, enrichedListType, result,
    setStep, setWizardImportMode, setEnriched, setEnrichedListType, setListOverride, setEventContext,
    setResult, setShowEnrichmentInterruptedBanner, setBulkJobId,
    setSegmentIndex, setFile, setReviewRows, setPushResult, setPushError, setLastPushLeadSource,
    setEnrichError, setError, setProgress, setPreviewRowsOverride, setDuplicateExemptPairs,
    setDupFeedback, setDuplicateSessionTotal, setRemoveAllDupConfirm, setShowSuccessFlash,
    setShowEnrichmentCompleteBanner, setBulkSmallListBypass,
    onResetEnrichment, onResetBulkJob,
    restoredApprovedIdsRef,
    enrichmentBannerTimeoutRef, uploadFlashTimeoutRef, removeAllDupMsgTimeoutRef,
  } = options;

  const clearSessionSnapshot = useCallback(() => {
    if (typeof window === "undefined") return;
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
  }, []);

  // Session hydration (once on mount)
  useEffect(() => {
    if (typeof window === "undefined" || sessionHydratedRef.current) return;
    sessionHydratedRef.current = true;
    const raw = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as PersistedSession;
      queueMicrotask(() => {
        if (saved.parseResult) setResult(saved.parseResult);
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
        if (saved.enrichedData) setEnriched(saved.enrichedData);
        if (saved.listType) {
          setEnrichedListType(saved.listType);
          setListOverride(saved.listType);
        }
      });
      if (Array.isArray(saved.approvedRows)) {
        restoredApprovedIdsRef.current = new Set(saved.approvedRows.map((r) => r.id));
      }
      let nextStep = (saved.step ?? "starter") as Step;
      if (nextStep === "enriching" || nextStep === "verifying") {
        nextStep = "context";
        queueMicrotask(() => setShowEnrichmentInterruptedBanner(true));
      }
      queueMicrotask(() => setStep(nextStep));
      const savedBulkJobId = window.sessionStorage.getItem(BULK_JOB_SESSION_KEY);
      if (savedBulkJobId) queueMicrotask(() => setBulkJobId(savedBulkJobId));
    } catch {
      clearSessionSnapshot();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Session persistence on state changes
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

  const resetToUpload = useCallback(
    (clearSession = false) => {
      if (clearSession) clearSessionSnapshot();
      onResetEnrichment();
      if (enrichmentBannerTimeoutRef.current) {
        clearTimeout(enrichmentBannerTimeoutRef.current);
        enrichmentBannerTimeoutRef.current = null;
      }
      if (uploadFlashTimeoutRef.current) {
        clearTimeout(uploadFlashTimeoutRef.current);
        uploadFlashTimeoutRef.current = null;
      }
      setWizardImportMode("event");
      setShowSuccessFlash(false);
      setShowEnrichmentCompleteBanner(false);
      setBulkSmallListBypass(false);
      setShowEnrichmentInterruptedBanner(false);
      onResetBulkJob();
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
    [
      clearSessionSnapshot, onResetEnrichment, onResetBulkJob,
      enrichmentBannerTimeoutRef, uploadFlashTimeoutRef, removeAllDupMsgTimeoutRef,
      setWizardImportMode, setShowSuccessFlash, setShowEnrichmentCompleteBanner, setBulkSmallListBypass,
      setShowEnrichmentInterruptedBanner, setStep, setFile, setResult, setListOverride,
      setSegmentIndex, setEnriched, setEnrichedListType, setReviewRows, setEventContext,
      setPushResult, setPushError, setLastPushLeadSource, setEnrichError, setError,
      setProgress, setPreviewRowsOverride, setDuplicateExemptPairs, setDupFeedback,
      setDuplicateSessionTotal, setRemoveAllDupConfirm,
    ],
  );

  const startNewImport = useCallback(() => {
    resetToUpload(true);
  }, [resetToUpload]);

  return {
    sessionHydratedRef,
    clearSessionSnapshot,
    resetToUpload,
    startNewImport,
  };
}
