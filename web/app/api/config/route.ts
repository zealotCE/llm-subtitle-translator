import { NextRequest } from "next/server";
import { getAuthFromRequest } from "@/lib/server/auth";
import { isSensitiveKey, loadEnv, saveEnv, resolvePath } from "@/lib/server/env";

const CONFIG_PATH = process.env.WEB_CONFIG_PATH || ".env";

export async function GET(request: Request) {
  const env = await loadEnv(resolvePath(CONFIG_PATH));
  const auth = getAuthFromRequest(request, env);
  if (!auth.ok) {
    return Response.json({ ok: false, message: "未登录" }, { status: 401 });
  }
  const masked: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    masked[key] = isSensitiveKey(key) ? "" : value;
  }
  return Response.json({ values: masked });
}

export async function POST(req: NextRequest) {
  const env = await loadEnv(resolvePath(CONFIG_PATH));
  const auth = getAuthFromRequest(req, env);
  if (!auth.ok) {
    return Response.json({ ok: false, message: "未登录" }, { status: 401 });
  }
  const body = await req.json();
  const updates = body?.updates || {};
  const payload: Record<string, string> = {};
  for (const [key, value] of Object.entries(updates)) {
    if (isSensitiveKey(key) && value === "") {
      continue;
    }
    if (isSensitiveKey(key) && value === "__clear__") {
      payload[key] = "";
      continue;
    }
    payload[key] = String(value ?? "");
  }
  await saveEnv(resolvePath(CONFIG_PATH), { ...env, ...payload });
  return Response.json({ ok: true });
}
