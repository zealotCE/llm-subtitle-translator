import fs from "fs/promises";
import path from "path";
import { getAuthFromRequest } from "@/lib/server/auth";
import { loadEnv, resolvePath } from "@/lib/server/env";
import { appendActivity, appendRun, loadState, saveState } from "@/lib/server/v3/store";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: { runId: string } }) {
  const env = await loadEnv(resolvePath(".env"));
  const auth = getAuthFromRequest(request, env);
  if (!auth.ok) {
    return Response.json({ ok: false, message: "未登录" }, { status: 401 });
  }
  const state = await loadState();
  const run = state.runs[context.params.runId];
  if (!run) {
    return Response.json({ ok: false, message: "未找到运行记录" }, { status: 404 });
  }
  const media = state.media[run.media_id];
  if (!media) {
    return Response.json({ ok: false, message: "未找到媒体" }, { status: 404 });
  }
  const newRun = appendRun(state, media.id, run.type, "running");
  media.last_run_id = newRun.id;
  media.status = "running";
  media.updated_at = Math.floor(Date.now() / 1000);
  state.media[media.id] = media;
  appendActivity(state, {
    id: `${media.id}-run-retry-${media.updated_at}`,
    media_id: media.id,
    run_id: newRun.id,
    type: "retry",
    status: "running",
    message: "重试运行",
    created_at: media.updated_at,
  });
  await saveState(state);
  await triggerScan(env);
  return Response.json({ ok: true, run: newRun });
}

async function triggerScan(env: Record<string, string>) {
  const watchDirs = (env.WATCH_DIRS || "")
    .split(",")
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
  const triggerName = env.TRIGGER_SCAN_FILE || ".scan_now";
  if (!watchDirs.length) return;
  for (const dir of watchDirs) {
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, triggerName), "scan", "utf-8");
    } catch {
      // ignore
    }
  }
}
