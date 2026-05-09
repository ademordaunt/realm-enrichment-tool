import { getManualEdits } from "@/lib/cache/enrichment-cache";

type ListType = "companies" | "contacts";

const MAX_BATCH_SIZE = 500;
const MAX_KEY_LENGTH = 500;

function asListType(value: string): ListType | null {
  if (value === "companies" || value === "contacts") return value;
  return null;
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const payload = body as { keys?: unknown; listType?: unknown };

  if (!Array.isArray(payload.keys)) {
    return Response.json({ error: "Expected `keys` array" }, { status: 400 });
  }

  const listTypeRaw = typeof payload.listType === "string" ? payload.listType.trim() : "";
  const listType = asListType(listTypeRaw);
  if (!listType) {
    return Response.json({ error: "Missing or invalid `listType`" }, { status: 400 });
  }

  const keys = (payload.keys as unknown[])
    .filter((k): k is string => typeof k === "string" && k.trim() !== "" && k.length <= MAX_KEY_LENGTH)
    .slice(0, MAX_BATCH_SIZE);

  const entries = await Promise.all(
    keys.map(async (key) => {
      const edits = await getManualEdits(key, listType);
      return [key, edits] as const;
    }),
  );

  const edits: Record<string, Record<string, unknown>> = {};
  for (const [key, edit] of entries) {
    if (edit && typeof edit === "object" && !Array.isArray(edit)) {
      edits[key] = edit as Record<string, unknown>;
    }
  }

  return Response.json({ edits });
}
