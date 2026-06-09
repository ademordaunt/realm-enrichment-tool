export type LeadSourceOption = { label: string; value: string };

/** Fallback when HubSpot property fetch fails. Values are internal API values, not display labels. */
export const LEAD_SOURCE_OPTIONS: LeadSourceOption[] = [
  { label: "Marketing - Advertisement", value: "advertisement" },
  { label: "Marketing - CisoExecNet", value: "Marketing - CisoExecNet" },
  { label: "Marketing - CISO XC", value: "Marketing - CISO XC" },
  { label: "Marketing - Cyalliance", value: "Marketing - Cyalliance" },
  { label: "Marketing - Cybersecurity Summit", value: "Marekting - Cybersecurity Summit" },
  { label: "Marketing - ExecWeb", value: "Marketing - ExecWeb" },
  { label: "Marketing - FutureCon", value: "Marketing - FutureCon" },
  { label: "Marketing - SageTap", value: "Marketing - SageTap" },
  { label: "Marketing - Social Media", value: "social_media" },
  { label: "Marketing - Trade Show", value: "trade_show" },
  { label: "Marketing - Webinar", value: "Marketing - Webinar" },
  { label: "Marketing - Website", value: "website" },
];

function marketingLabelToInternalValue(label: string): string {
  const prefix = "Marketing - ";
  const rest = label.startsWith(prefix) ? label.slice(prefix.length).trim() : label.trim();
  if (rest.includes(" ")) {
    return rest.toLowerCase().replace(/\s+/g, "_");
  }
  return rest.toLowerCase();
}

/** Prefer HubSpot's internal value; fall back to canonical map when value equals label. */
export function resolveLeadSourceInternalValue(label: string, apiValue: string): string {
  const trimmedLabel = label.trim();
  const trimmedValue = apiValue.trim();
  if (trimmedValue && trimmedValue !== trimmedLabel) {
    return trimmedValue;
  }
  const canonical = LEAD_SOURCE_OPTIONS.find(
    (o) => o.label.trim().toLowerCase() === trimmedLabel.toLowerCase(),
  );
  return canonical?.value ?? marketingLabelToInternalValue(trimmedLabel);
}

export function normalizeLeadSourceOptions(
  options: LeadSourceOption[],
): LeadSourceOption[] {
  return options.map((opt) => ({
    label: opt.label,
    value: resolveLeadSourceInternalValue(opt.label, opt.value),
  }));
}

export function leadSourceLabelForValue(
  value: string,
  options: LeadSourceOption[] = LEAD_SOURCE_OPTIONS,
): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const opt = options.find((o) => o.value === trimmed);
  return opt?.label ?? trimmed;
}
