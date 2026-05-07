/**
 * One-time connectivity test for the Upstash Redis (KV) cache.
 * Run with:  node test-cache.js
 *
 * Reads KV_REST_API_URL and KV_REST_API_TOKEN from .env.local in the project
 * root, then writes a value, reads it back, and deletes it.
 */

import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Parse .env.local (no dotenv dependency needed)
// ---------------------------------------------------------------------------
function loadEnvFile(filePath) {
  const env = {};
  if (!fs.existsSync(filePath)) return env;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, ".env.local");
const env = loadEnvFile(envPath);

const KV_URL   = (env.KV_REST_API_URL   || process.env.KV_REST_API_URL   || "").trim();
const KV_TOKEN = (env.KV_REST_API_TOKEN || process.env.KV_REST_API_TOKEN || "").trim();

if (!KV_URL || !KV_TOKEN) {
  console.error("❌  Missing KV_REST_API_URL or KV_REST_API_TOKEN");
  console.error("    Checked: .env.local and process.env");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Minimal Upstash REST client (uses built-in https — no npm deps)
// ---------------------------------------------------------------------------
function upstashRequest(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const base = KV_URL.replace(/\/$/, "");
    const fullUrl = new URL(urlPath, base + "/");
    const options = {
      method,
      headers: {
        Authorization: `Bearer ${KV_TOKEN}`,
        "Content-Type": "application/json",
      },
    };
    const req = https.request(fullUrl, options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${JSON.stringify(json)}`));
          } else {
            resolve(json);
          }
        } catch {
          reject(new Error(`Non-JSON response (status ${res.statusCode}): ${data}`));
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function kvSet(key, value, exSeconds) {
  // Upstash REST: POST /set/<key>/<value>?EX=<seconds>
  const encodedKey   = encodeURIComponent(key);
  const encodedValue = encodeURIComponent(JSON.stringify(value));
  const path = `/set/${encodedKey}/${encodedValue}?EX=${exSeconds}`;
  return upstashRequest("GET", path, null);
}

async function kvGet(key) {
  const encodedKey = encodeURIComponent(key);
  return upstashRequest("GET", `/get/${encodedKey}`, null);
}

async function kvDel(key) {
  const encodedKey = encodeURIComponent(key);
  return upstashRequest("GET", `/del/${encodedKey}`, null);
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------
const TEST_KEY   = "__realm_cache_test__";
const TEST_VALUE = { ok: true, ts: Date.now() };

(async () => {
  console.log(`\n🔗  Connecting to: ${KV_URL}`);
  console.log(`🔑  Token: ${KV_TOKEN.slice(0, 8)}…\n`);

  // --- Write ---
  console.log("1️⃣   Writing test key…");
  try {
    const setResult = await kvSet(TEST_KEY, TEST_VALUE, 60);
    if (setResult.result !== "OK") {
      throw new Error(`Expected result "OK", got: ${JSON.stringify(setResult)}`);
    }
    console.log("    ✅  Write succeeded (result: OK)");
  } catch (err) {
    console.error("    ❌  Write failed:", err.message);
    process.exit(1);
  }

  // --- Read back ---
  console.log("2️⃣   Reading test key back…");
  try {
    const getResult = await kvGet(TEST_KEY);
    const parsed = typeof getResult.result === "string"
      ? JSON.parse(getResult.result)
      : getResult.result;
    if (!parsed || parsed.ok !== true) {
      throw new Error(`Value mismatch — got: ${JSON.stringify(getResult)}`);
    }
    console.log("    ✅  Read succeeded — value matches:", JSON.stringify(parsed));
  } catch (err) {
    console.error("    ❌  Read failed:", err.message);
    process.exit(1);
  }

  // --- Clean up ---
  console.log("3️⃣   Deleting test key…");
  try {
    await kvDel(TEST_KEY);
    console.log("    ✅  Delete succeeded\n");
  } catch (err) {
    console.warn("    ⚠️   Delete failed (non-fatal):", err.message, "\n");
  }

  console.log("✅  Upstash KV is connected and working correctly.\n");
})();
