import fs from "fs/promises";
import { getAuthFromRequest } from "@/lib/server/auth";
import { loadEnv, resolvePath } from "@/lib/server/env";

const CONFIG_PATH = process.env.WEB_CONFIG_PATH || ".env";

export async function GET(request: Request) {
  const env = await loadEnv(resolvePath(CONFIG_PATH));
  const auth = getAuthFromRequest(request, env);
  if (!auth.ok) {
    return Response.json({ ok: false, message: "未登录" }, { status: 401 });
  }

  const rawPath = env.HEALTHCHECK_FILE || "/output/worker.heartbeat";
  const heartbeatPath = resolvePath(rawPath);
  const ttl = Number(env.HEALTHCHECK_TTL || 120);
  const now = Date.now();

  try {
    const stats = await fs.stat(heartbeatPath);
    const ageSeconds = Math.max(0, (now - stats.mtimeMs) / 1000);
    const status = ageSeconds <= ttl ? "online" : "offline";
    return Response.json({
      ok: true,
      status,
      updated_at: Math.floor(stats.mtimeMs / 1000),
      age_seconds: Math.round(ageSeconds),
    });
  } catch {
    return Response.json({
      ok: true,
      status: "unknown",
    });
  }
}
