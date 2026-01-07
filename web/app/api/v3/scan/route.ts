import fs from "fs/promises";
import path from "path";
import { getAuthFromRequest } from "@/lib/server/auth";
import { loadEnv, resolvePath } from "@/lib/server/env";
import { logEvent } from "@/lib/server/logger";
import { appendActivity, loadState, saveState } from "@/lib/server/v3/store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const env = await loadEnv(resolvePath(".env"));
  const auth = getAuthFromRequest(request, env);
  if (!auth.ok) {
    return Response.json({ ok: false, message: "未登录" }, { status: 401 });
  }
  const watchDirs = (env.WATCH_DIRS || "")
    .split(",")
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
  const triggerName = env.TRIGGER_SCAN_FILE || ".scan_now";
  if (!watchDirs.length) {
    return Response.json({ ok: false, message: "未配置 WATCH_DIRS" }, { status: 400 });
  }
  const errors: string[] = [];
  for (const dir of watchDirs) {
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, triggerName), "scan", "utf-8");
    } catch (err) {
      errors.push(`${dir}: ${(err as Error).message}`);
    }
  }
  if (errors.length) {
    return Response.json({ ok: false, message: errors.join("; ") }, { status: 500 });
  }
  const state = await loadState();
  const now = Math.floor(Date.now() / 1000);
  appendActivity(state, {
    id: `scan-${now}`,
    type: "scan",
    status: "info",
    message: "触发扫描",
    created_at: now,
  });
  await saveState(state);
  await logEvent(env, "INFO", "触发扫描");
  return Response.json({ ok: true });
}
