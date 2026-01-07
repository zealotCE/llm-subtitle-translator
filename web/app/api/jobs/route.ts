import { getAuthFromRequest } from "@/lib/server/auth";
import { loadEnv, resolvePath } from "@/lib/server/env";
import { getOutputDir, getWatchDirs, inferStatus, loadJobMeta, scanVideosCached } from "@/lib/server/media";
import fs from "fs/promises";
import path from "path";

const CONFIG_PATH = process.env.WEB_CONFIG_PATH || ".env";

export async function GET(request: Request) {
  const env = await loadEnv(resolvePath(CONFIG_PATH));
  const auth = getAuthFromRequest(request, env);
  if (!auth.ok) {
    return Response.json({ ok: false, message: "未登录" }, { status: 401 });
  }
  const url = new URL(request.url);
  const keyword = url.searchParams.get("q") || "";
  const watchDirs = getWatchDirs(env);
  const items = await scanVideosCached(env, watchDirs, (env.WATCH_RECURSIVE || "true") === "true");
  const jobs = await Promise.all(
    items
    .filter((item) => (keyword ? item.path.includes(keyword) : true))
    .map(async (item) => {
      const outputDir = getOutputDir(env, item.path);
      const status = outputDir ? inferStatus(item.path, outputDir) : "pending";
      const meta = await loadJobMeta(item.path);
      return {
        path: item.path,
        status,
        mtime: item.mtime,
        asr_mode: meta.asr_mode || "",
        segment_mode: meta.segment_mode || "",
      };
    })
  );
  return Response.json({ jobs });
}

export async function POST(request: Request) {
  const env = await loadEnv(resolvePath(CONFIG_PATH));
  const auth = getAuthFromRequest(request, env);
  if (!auth.ok) {
    return Response.json({ ok: false, message: "未登录" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  if (body?.action !== "trigger_scan") {
    return Response.json({ ok: false, message: "不支持的操作" }, { status: 400 });
  }
  const watchDirs = getWatchDirs(env);
  const triggerName = env.TRIGGER_SCAN_FILE || ".scan_now";
  if (!triggerName) {
    return Response.json({ ok: false, message: "未配置触发文件名" }, { status: 400 });
  }
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
  return Response.json({ ok: true });
}
