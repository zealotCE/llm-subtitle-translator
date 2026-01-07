import { getAuthFromRequest } from "@/lib/server/auth";
import { isSensitiveKey, loadEnv, resolvePath, saveEnv } from "@/lib/server/env";

export const runtime = "nodejs";

const SETTINGS_KEYS = [
  "WATCH_DIRS",
  "WATCH_RECURSIVE",
  "SCAN_INTERVAL",
  "OUTPUT_TO_SOURCE_DIR",
  "ASR_MODE",
  "ASR_MODEL",
  "LANGUAGE_HINTS",
  "LLM_MODEL",
  "LLM_BASE_URL",
  "BATCH_LINES",
  "MAX_CONCURRENT_TRANSLATIONS",
  "OSS_ENDPOINT",
  "OSS_BUCKET",
  "OSS_URL_MODE",
  "WEB_AUTH_ENABLED",
  "WEB_AUTH_USER",
  "WEB_AUTH_PASSWORD",
];

export async function GET(request: Request) {
  const env = await loadEnv(resolvePath(".env"));
  const auth = getAuthFromRequest(request, env);
  if (!auth.ok) {
    return Response.json({ ok: false, message: "未登录" }, { status: 401 });
  }
  const values: Record<string, string> = {};
  for (const key of SETTINGS_KEYS) {
    values[key] = isSensitiveKey(key) ? "" : env[key] || "";
  }
  return Response.json({ ok: true, values });
}

export async function POST(request: Request) {
  const env = await loadEnv(resolvePath(".env"));
  const auth = getAuthFromRequest(request, env);
  if (!auth.ok) {
    return Response.json({ ok: false, message: "未登录" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const updates = body?.updates || {};
  const payload: Record<string, string> = {};
  for (const key of SETTINGS_KEYS) {
    if (Object.prototype.hasOwnProperty.call(updates, key)) {
      const value = String(updates[key] ?? "");
      if (isSensitiveKey(key) && value === "") {
        continue;
      }
      payload[key] = value;
    }
  }
  await saveEnv(resolvePath(".env"), { ...env, ...payload });
  return Response.json({ ok: true });
}
