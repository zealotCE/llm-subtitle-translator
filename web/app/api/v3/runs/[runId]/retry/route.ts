import { getAuthFromRequest } from "@/lib/server/auth";
import { loadEnv, resolvePath } from "@/lib/server/env";
import { appendActivity, appendRun, loadState, saveState } from "@/lib/server/v3/store";
import { logEvent } from "@/lib/server/logger";
import { clearMediaMarkers } from "@/lib/server/markers";
import { triggerScan } from "@/lib/server/scan";

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
  await clearMediaMarkers(env, media.path);
  await logEvent(env, "INFO", "重试运行", { media_id: media.id, run_id: newRun.id });
  await saveState(state);
  const scanResult = await triggerScan(env);
  if (!scanResult.ok) {
    await logEvent(env, "WARN", "触发扫描失败", {
      media_id: media.id,
      run_id: newRun.id,
      error: scanResult.warning,
    });
  }
  return Response.json({ ok: true, run: newRun, warning: scanResult.ok ? "" : scanResult.warning });
}
