import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { getAuthFromRequest } from "@/lib/server/auth";
import { loadEnv, resolvePath } from "@/lib/server/env";
import { getWatchDirs } from "@/lib/server/media";
import { logEvent } from "@/lib/server/logger";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const env = await loadEnv(resolvePath(".env"));
  const auth = getAuthFromRequest(request, env);
  if (!auth.ok) {
    return Response.json({ ok: false, message: "未登录" }, { status: 401 });
  }
  const form = await request.formData();
  const file = form.get("file");
  if (!file || typeof file === "string") {
    return Response.json({ ok: false, message: "请选择文件" }, { status: 400 });
  }
  const maxMb = Number(env.WEB_MAX_UPLOAD_MB || "512");
  if (maxMb > 0 && file.size > maxMb * 1024 * 1024) {
    return Response.json({ ok: false, message: "文件过大" }, { status: 413 });
  }
  const asrMode = String(form.get("asr_mode") || env.WEB_UPLOAD_ASR_MODE_DEFAULT || "offline").trim();
  const segmentMode = String(form.get("segment_mode") || env.WEB_UPLOAD_SEGMENT_MODE_DEFAULT || "post").trim();
  const watchDirs = getWatchDirs(env);
  const targetDir = env.WEB_UPLOAD_DIR || watchDirs[0] || "";
  if (!targetDir) {
    return Response.json({ ok: false, message: "未配置上传目录" }, { status: 400 });
  }
  await fs.mkdir(targetDir, { recursive: true });
  const filename = path.basename(file.name);
  const destPath = path.join(targetDir, filename);
  const overwrite = (env.WEB_UPLOAD_OVERWRITE || "false") === "true";
  try {
    if (!overwrite) {
      await fs.access(destPath);
      return Response.json({ ok: false, message: "文件已存在" }, { status: 409 });
    }
  } catch {
    // ok
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(destPath, buffer);
  const meta = {
    asr_mode: asrMode,
    segment_mode: segmentMode,
    created_at: Math.floor(Date.now() / 1000),
  };
  const metaPath = path.join(targetDir, `${path.parse(filename).name}.job.json`);
  try {
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), "utf-8");
  } catch {
    // ignore
  }
  await triggerScan(env, watchDirs);
  const mediaId = hashPath(destPath);
  await logEvent(env, "INFO", "导入媒体", { media_id: mediaId, path: destPath });
  return Response.json({ ok: true, path: destPath, id: mediaId });
}

function hashPath(value: string) {
  return crypto.createHash("sha1").update(value).digest("hex");
}

async function triggerScan(env: Record<string, string>, watchDirs: string[]) {
  const triggerName = env.TRIGGER_SCAN_FILE || ".scan_now";
  if (!triggerName || !watchDirs.length) return;
  try {
    for (const dir of watchDirs) {
      await fs.writeFile(path.join(dir, triggerName), "scan", "utf-8");
    }
  } catch {
    // ignore
  }
}
