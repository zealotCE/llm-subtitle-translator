import { getAuthFromRequest } from "@/lib/server/auth";
import { loadEnv, resolvePath } from "@/lib/server/env";
import path from "path";
import fs from "fs/promises";
import { loadRunMeta } from "@/lib/server/media";
import { loadState } from "@/lib/server/v3/store";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: { runId: string } }) {
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
  let runMeta: Record<string, unknown> | null = null;
  if (media) {
    runMeta = await loadRunMeta(env, media.path);
  }
  const enriched = media
    ? {
        ...run,
        media_title: media.title,
        media_path: media.path,
        outputs: media.outputs,
        progress: typeof runMeta?.progress === "number" ? runMeta.progress : null,
        stage: typeof runMeta?.stage === "string" ? runMeta.stage : run.stage,
        asr_model: typeof runMeta?.asr_model === "string" ? runMeta.asr_model : undefined,
        llm_model: typeof runMeta?.llm_model === "string" ? runMeta.llm_model : undefined,
      }
    : run;
  const pipeline = {
    asr_mode: env.ASR_MODE || "",
    segment_mode: env.SEGMENT_MODE || "",
    subtitle_mode: env.SUBTITLE_MODE || "",
    use_existing_subtitle: env.USE_EXISTING_SUBTITLE || "",
    ignore_simplified_subtitle: env.IGNORE_SIMPLIFIED_SUBTITLE || "",
  };
  const stages = media ? await extractStages(env, media.path, run.started_at, run.log_ref || "") : [];
  return Response.json({ ok: true, run: enriched, pipeline, stages });
}

type StageEvent = { ts: number; message: string; level?: string };

async function extractStages(
  env: Record<string, string>,
  mediaPath: string,
  startedAt: number,
  runLogPath: string
) {
  const logFile = env.LOG_FILE_NAME || "worker.log";
  const logPaths = runLogPath
    ? [runLogPath]
    : await resolveLogPaths(env, logFile);
  if (!logPaths.length) {
    return [];
  }
  let content = "";
  for (const logPath of logPaths) {
    try {
      content = await fs.readFile(logPath, "utf-8");
      if (content) break;
    } catch {
      continue;
    }
  }
  if (!content) {
    return [];
  }
  const lines = content.trim().split("\n").slice(-2000);
  const stages: StageEvent[] = [];
  const messages = new Set([
    "开始处理",
    "选择音轨",
    "选择字幕轨",
    "发现现有字幕",
    "已保存现有字幕",
    "检测到简体中文字幕，跳过识别与翻译",
    "评估模式：跳过覆盖主 SRT",
    "忽略现有字幕，继续语音识别",
    "使用已生成字幕进行简体生成",
    "强制 ASR，忽略已生成字幕",
    "ASR 热词启用",
    "热词词表创建",
    "强制翻译",
    "开始翻译",
    "翻译完成",
    "翻译失败",
    "翻译初始化失败",
    "识别完成并保存字幕",
    "已保存简体字幕",
    "处理完成",
    "处理失败",
  ]);
  for (const line of lines) {
    let entry: { ts?: string; message?: string; path?: string; level?: string } | null = null;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!entry || entry.path !== mediaPath || !entry.message || !messages.has(entry.message)) {
      continue;
    }
    if (!entry.ts) continue;
    const ts = Date.parse(entry.ts);
    if (!Number.isFinite(ts)) continue;
    const sec = Math.floor(ts / 1000);
    if (sec + 5 < startedAt) continue;
    stages.push({ ts: sec, message: entry.message, level: entry.level });
  }
  return stages.sort((a, b) => a.ts - b.ts);
}

async function resolveLogPaths(env: Record<string, string>, logFile: string) {
  const outDir = env.OUT_DIR || "/output";
  const candidates = [
    env.LOG_DIR,
    path.join(outDir, "logs"),
    "/app/logs",
    "/logs",
  ]
    .filter(Boolean)
    .map((dir) => path.join(dir as string, logFile));
  const existing: string[] = [];
  for (const filePath of candidates) {
    try {
      await fs.stat(filePath);
      existing.push(filePath);
    } catch {
      continue;
    }
  }
  return existing;
}
