import fs from "fs/promises";
import path from "path";
import { getAuthFromRequest } from "@/lib/server/auth";
import { loadEnv, resolvePath } from "@/lib/server/env";
import { appendActivity, appendRun, getMedia, loadState, saveState } from "@/lib/server/v3/store";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: { id: string } }) {
  const env = await loadEnv(resolvePath(".env"));
  const auth = getAuthFromRequest(request, env);
  if (!auth.ok) {
    return Response.json({ ok: false, message: "未登录" }, { status: 401 });
  }
  const state = await loadState();
  const media = getMedia(state, context.params.id);
  if (!media) {
    return Response.json({ ok: false, message: "未找到媒体" }, { status: 404 });
  }
  const run = appendRun(state, media.id, "translate", "running");
  media.last_run_id = run.id;
  media.status = "running";
  media.updated_at = Math.floor(Date.now() / 1000);
  state.media[media.id] = media;
  appendActivity(state, {
    id: `${media.id}-translate-${media.updated_at}`,
    media_id: media.id,
    run_id: run.id,
    type: "translate",
    status: "running",
    message: "触发翻译",
    created_at: media.updated_at,
  });
  await triggerScan(env);
  await saveState(state);
  return Response.json({ ok: true, run, media });
}

async function triggerScan(env: Record<string, string>) {
  const watchDirs = (env.WATCH_DIRS || "")
    .split(",")
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
  const triggerName = env.TRIGGER_SCAN_FILE || ".scan_now";
  if (!watchDirs.length || !triggerName) return;
  for (const dir of watchDirs) {
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, triggerName), "scan", "utf-8");
    } catch {
      // ignore
    }
  }
}
