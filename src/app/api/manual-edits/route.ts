import { getManualEdits, setManualEdit } from "@/lib/cache/enrichment-cache";

type ListType = "companies" | "contacts";

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

  const payload = body as {
    stableKey?: unknown;
    listType?: unknown;
    field?: unknown;
    value?: unknown;
  };

  const stableKey = typeof payload.stableKey === "string" ? payload.stableKey.trim() : "";
  const listTypeRaw = typeof payload.listType === "string" ? payload.listType.trim() : "";
  const field = typeof payload.field === "string" ? payload.field.trim() : "";
  const listType = asListType(listTypeRaw);

  if (!stableKey || !listType || !field || payload.value === undefined) {
    return Response.json(
      { error: "Missing required fields: stableKey, listType, field, value" },
      { status: 400 },
    );
  }

  await setManualEdit(stableKey, listType, field, payload.value);
  return Response.json({ ok: true });
}

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const stableKey = (searchParams.get("stableKey") ?? "").trim();
  const listTypeRaw = (searchParams.get("listType") ?? "").trim();
  const listType = asListType(listTypeRaw);

  if (!stableKey || !listType) {
    return Response.json({ error: "Missing required query params: stableKey, listType" }, { status: 400 });
  }

  const edits = await getManualEdits(stableKey, listType);
  return Response.json({ edits });
}
