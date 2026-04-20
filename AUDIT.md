

# Codebase audit report (read-only)

**Stack note:** `package.json` lists **Next.js 16.2.4** (not 15). TypeScript / Tailwind as described.

---

## 1. Type safety

| Severity | File | Issue |
|----------|------|--------|
| **Medium** | `src/lib/enrichment/zoominfo-enricher.ts` (~508) | **`(u: any)`** in `externalUrls.find` — should be `unknown` + narrow (e.g. `isRecord(u)`) instead of `any`. |
| **Low** | Multiple API / lib files | Widespread **`as { ... }`** on `res.json()` — fine if responses match, but wrong shapes fail silently or yield `undefined` (e.g. HubSpot / ZoomInfo). |
| **Medium** | `src/lib/enrichment/zoominfo-enricher.ts` (~73–74) | **`JSON.parse(init.body)`** in logging — malformed body string would **throw** inside `zoomInfoFetch` (not guarded). |
| **Low** | `src/components/ReviewTable.tsx`, `src/app/api/enrich/zoominfo/route.ts` | **`rows as EnrichedCompany[]` / `as EnrichedContact`** — relies on caller passing correct `listType`; wrong combo could mis-render. |
| **Low** | Many exported functions | **Implicit / missing explicit return types** on helpers (e.g. parsers, components) — increases drift risk; not exhaustive here. |
| **Medium** | `src/app/page.tsx` (`consumeEnrichmentNdjson`, LinkedIn passes) | **`JSON.parse(t)`** on NDJSON lines — bad line throws; **`res.json()`** after failed fetch not always checked before parse in LinkedIn passes (see §2). |
| **Low** | Client `page.tsx` | **`payload as { linkedInUrl?: ... }`** — assumes API shape. |

---

## 2. Error handling

| Severity | File | Issue |
|----------|------|--------|
| **Medium** | `src/app/page.tsx` — `runLinkedInLookupPass` / `runCompanyLinkedInLookupPass` (~364–420) | **`fetch` to `/api/enrich/linkedin-search`**: no branch for `!res.ok`; failures are **silent** (row unchanged, progress still advances). |
| **Medium** | `src/app/page.tsx` — enrichment / parse / push flows | Some paths use **`try/catch`** with user-visible errors; others rely on **`res.ok`** only — **inconsistent** user feedback for network vs 4xx/5xx. |
| **Low** | `src/lib/enrichment/commonroom-enricher.ts` | By design: **errors swallowed** (`catch { return {} }`) — enrichment degrades with **no visibility** to user (acceptable for optional CR, but opaque). |
| **Low** | `src/lib/zoominfo/auth.ts` | **`getZoomInfoToken`** throws on failure — callers (e.g. zoominfo route stream) **catch** and emit NDJSON error; OK. |
| **High** | `src/app/api/enrich/zoominfo/route.ts` | **`maxDuration = 9`** with **per-row work + `delayBetweenZoomInfoCalls(200)`** — large lists can **hit timeout** before `done` (see §5). |
| **Low** | `src/app/api/parse/route.ts` | **Top-level `try/catch`** — returns 500 with message; OK. |
| **Low** | `src/app/api/enrich/ai/route.ts` | Batch mode **`try/catch`** returns JSON error; streaming mode enqueues **`type: "error"`** — OK. |
| **Low** | `src/lib/hubspot/http.ts` | **`hubspotFetch`** throws on missing token / failed read — callers must catch (push handler does). |

---

## 3. Security

| Severity | File | Issue |
|----------|------|--------|
| **Low** (by design) | All `src/app/api/**/route.ts` | **No auth / session** on routes — acceptable for a **single-user local** tool; **High** if this app were exposed on the public internet without protection. |
| **Low** | `src/components/SuccessScreen.tsx` | **`NEXT_PUBLIC_HUBSPOT_PORTAL_ID`** — public by prefix; **not a secret** (portal id). |
| **Medium** | `src/lib/zoominfo/auth.ts` (~14–17) | **`console.log` with `hasClientId` / `hasClientSecret`** — booleans only, but **signals env layout** in server logs. |
| **Medium** | `src/app/api/zoominfo-lookup/route.ts` | **GET diagnostic** returns parsed ZoomInfo JSON to client — **no auth**; could leak **field metadata** or errors if deployed publicly. |
| **Low** | API routes | **Body validation** varies: many routes check `listType`, arrays, shapes; **row objects** are largely **trusted** (typed casts) — malicious huge payloads could stress memory (no explicit size cap on JSON body beyond platform limits). |
| **Low** | `parse/route.ts` | **File size** capped (5 MB); **good**. |

**Secrets in client bundle:** `grep` shows **`ANTHROPIC_API_KEY` / ZoomInfo / HubSpot** only under **`src/app/api`** and **`src/lib`** (server). **`NEXT_PUBLIC_*`** only for HubSpot portal in **`SuccessScreen`**. No raw API keys in `src/components` except env **names** in error strings (messages, not values).

---

## 4. Consistency

| Severity | File / area | Issue |
|----------|-------------|--------|
| **Medium** | `ReviewTable.tsx` vs `ai-enricher` / parsers | **Sanitization** (`unknown`, `Self`, `sanitizeContact`, etc.) is **centralized in ReviewTable** for review — similar semantics may be **duplicated or divergent** elsewhere if new entry points appear. |
| **Low** | HubSpot `src/lib/hubspot/*.ts` | **`hubspotFetch` wrapper** vs raw **`fetch`** only in zoominfo internal server (ZoomInfo URLs) — **mixed but intentional**. |
| **Low** | Naming | Mix of **`linkedInUrl` / `linkedinUrl`**, **`lead_source__deal_source`** (HubSpot) vs app fields — **external API vs app** naming, mostly consistent. |
| **Low** | Files | Mostly **`kebab-case`** route segments, **`PascalCase`** components — **consistent**. |

---

## 5. Architecture & scalability

| Severity | File | Issue |
|----------|------|--------|
| **High** | `src/app/api/enrich/zoominfo/route.ts` | **Sequential** loop over **all rows** with **200 ms delay** between rows + external calls — **57 → 500 rows** scales **linearly in time**; **very likely to exceed 9s** on Vercel for non-trivial counts. |
| **High** | `src/app/api/enrich/linkedin-search/route.ts`, `page.tsx` | **Per-row** LinkedIn search (Anthropic + web search) — **N sequential HTTP round-trips** from browser → app; **slow and timeout-prone** at scale. |
| **Medium** | `src/app/api/enrich/ai/route.ts` | **Batched** mode mitigates timeout; **streaming** legacy path still exists — **two patterns** for same operation. |
| **Medium** | `zoominfo-enricher.ts` / merger | Substantial **business logic in lib** — **good**; some **orchestration** still **in route** stream (acceptable). |
| **Low** | `page.tsx` | **Strict await order** (AI → verify → LinkedIn) — **correctness by ordering**; parallelization would change billing/credits behavior. |
| **Low** | `src/lib/cache/enrichment-cache.ts` | **KV** optional — reduces repeat cost; **cache key** strategy should stay aligned when fields change. |

---

## 6. Dead code & cleanup

| Severity | File | Issue |
|----------|------|--------|
| **Low** | Many under `src/lib/enrichment/*.ts`, `zoominfo-enricher.ts`, `ai-enricher.ts`, `merger.ts`, `EventContextForm.tsx`, `zoominfo-lookup/route.ts` | **`console.log` / `console.error`** — fine for dev; **noise and possible info leak** in production logs (PII in ZoomInfo logs). |
| **Low** | `src/lib/enrichment/merger.ts` (~38) | **`console.log`** for merge mode — debug-style. |
| **Medium** | `src/app/api/zoominfo-lookup/route.ts` | **Temporary diagnostic** — **safe to remove** for production if you no longer need **live ZoomInfo lookup probe**; **keep** if ops still use it behind private deploy. **Do not expose** on public internet without auth. |
| **Low** | Repo-wide | **Unused imports** — not exhaustively verified without `eslint --max-warnings 0` on full tree; recommend **lint CI** to catch. |

---

## Summary counts (approximate)

- **High:** ~4 (timeouts / scale: zoominfo + linkedin pipeline; public zoominfo-lookup if exposed).
- **Medium:** ~12 (silent fetch failures, type/parse hazards, duplicated sanitization risk, logging).
- **Low:** remainder (naming, assertions, console noise, missing explicit return types).

No files were modified; this is an audit only. If you want remediation in-repo, switch to **Agent mode** and prioritize **zoominfo route timeout strategy** and **LinkedIn pass error surfacing** first.