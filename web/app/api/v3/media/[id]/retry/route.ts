import { getAuthFromRequest } from "@/lib/server/auth";
import { loadEnv, resolvePath } from "@/lib/server/env";
import { appendActivity, appendRun, getMedia, loadState, saveState } from "@/lib/server/v3/store";
import { logEvent } from "@/lib/server/logger";
import { clearMediaMarkers } from "@/lib/server/markers";
import { triggerScan } from "@/lib/server/scan";

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
  const run = appendRun(state, media.id, "pipeline", "running");
  media.last_run_id = run.id;
  media.status = "running";
  media.updated_at = Math.floor(Date.now() / 1000);
  state.media[media.id] = media;
  appendActivity(state, {
    id: `${media.id}-retry-${media.updated_at}`,
    media_id: media.id,
    run_id: run.id,
    type: "retry",
    status: "running",
    message: "触发重试",
    created_at: media.updated_at,
  });
  await clearMediaMarkers(env, media.path);
  await logEvent(env, "INFO", "触发重试", { media_id: media.id, run_id: run.id });
  const scanResult = await triggerScan(env);
  if (!scanResult.ok) {
    await logEvent(env, "WARN", "触发扫描失败", {
      media_id: media.id,
      run_id: run.id,
      error: scanResult.warning,
    });
  }
  await saveState(state);
  return Response.json({ ok: true, run, media, warning: scanResult.ok ? "" : scanResult.warning });
}
