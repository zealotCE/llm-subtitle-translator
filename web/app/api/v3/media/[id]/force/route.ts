import fs from "fs/promises";
import path from "path";
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
  const body = await request.json().catch(() => ({}));
  const ignoreSimplified = readBool(body.ignore_simplified_subtitle, true);
  const forceTranslate = readBool(body.force_translate, false);
  const forceAsr = readBool(body.force_asr, false);
  const useExisting = readBool(body.use_existing_subtitle, true);
  const effectiveIgnoreSimplified = forceTranslate ? true : ignoreSimplified;
  const effectiveUseExisting = forceAsr ? false : useExisting;
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
    id: `${media.id}-force-${media.updated_at}`,
    media_id: media.id,
    run_id: run.id,
    type: "force",
    status: "running",
    message: "触发强制运行",
    created_at: media.updated_at,
  });
  const base = path.basename(media.path, path.extname(media.path));
  const jobPath = path.join(path.dirname(media.path), `${base}.job.json`);
  try {
    await fs.writeFile(
      jobPath,
      JSON.stringify(
        {
          force_once: true,
          force_asr: forceAsr,
          force_translate: forceTranslate,
          ignore_simplified_subtitle: effectiveIgnoreSimplified,
          use_existing_subtitle: effectiveUseExisting,
        },
        null,
        2
      ),
      "utf-8"
    );
  } catch {
    // ignore
  }
  await clearMediaMarkers(env, media.path);
  await logEvent(env, "INFO", "触发强制运行", { media_id: media.id, run_id: run.id });
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

function readBool(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
    if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  }
  if (typeof value === "number") return value !== 0;
  return fallback;
}
