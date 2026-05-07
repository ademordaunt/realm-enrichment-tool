/**
 * One-time cleanup script for contact cache keys in Upstash Redis (KV).
 * Run with: node clear-contact-cache.js
 *
 * Reads KV_REST_API_URL and KV_REST_API_TOKEN from .env.local in the project
 * root, scans all keys matching contact:*, and deletes them.
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
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
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

const KV_URL = (env.KV_REST_API_URL || process.env.KV_REST_API_URL || "").trim();
const KV_TOKEN = (env.KV_REST_API_TOKEN || process.env.KV_REST_API_TOKEN || "").trim();

if (!KV_URL || !KV_TOKEN) {
  console.error("Missing KV_REST_API_URL or KV_REST_API_TOKEN");
  console.error("Checked: .env.local and process.env");
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
      res.on("data", (chunk) => {
        data += chunk;
      });
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

async function kvScan(cursor, matchPattern, count) {
  const encodedMatch = encodeURIComponent(matchPattern);
  return upstashRequest("GET", `/scan/${cursor}?match=${encodedMatch}&count=${count}`, null);
}

async function kvDel(key) {
  const encodedKey = encodeURIComponent(key);
  return upstashRequest("GET", `/del/${encodedKey}`, null);
}

function parseScanResult(scanResult) {
  const payload = scanResult && scanResult.result;

  if (Array.isArray(payload)) {
    const nextCursor = String(payload[0] ?? "0");
    const keys = Array.isArray(payload[1]) ? payload[1] : [];
    return { nextCursor, keys };
  }

  const nextCursor = String(payload?.cursor ?? scanResult?.cursor ?? "0");
  const keys = Array.isArray(payload?.keys)
    ? payload.keys
    : Array.isArray(scanResult?.keys)
      ? scanResult.keys
      : [];
  return { nextCursor, keys };
}

async function getAllContactKeys() {
  const allKeys = [];
  let cursor = "0";

  do {
    const scanResult = await kvScan(cursor, "contact:*", 1000);
    const { nextCursor, keys } = parseScanResult(scanResult);
    allKeys.push(...keys);
    cursor = nextCursor;
  } while (cursor !== "0");

  return allKeys;
}

(async () => {
  console.log(`Connecting to: ${KV_URL}`);
  const keys = await getAllContactKeys();

  if (keys.length === 0) {
    console.log("Deleted 0 keys matching contact:*");
    return;
  }

  let deletedCount = 0;
  for (const key of keys) {
    try {
      await kvDel(key);
      deletedCount += 1;
    } catch (error) {
      console.warn(`Failed to delete key ${key}: ${error.message}`);
    }
  }

  console.log(`Deleted ${deletedCount} keys matching contact:*`);
})().catch((error) => {
  console.error("Failed to clear contact cache:", error.message);
  process.exit(1);
});
