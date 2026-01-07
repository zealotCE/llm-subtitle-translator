import fs from "fs/promises";
import path from "path";
import { getAuthFromRequest } from "@/lib/server/auth";
import { loadEnv, resolvePath } from "@/lib/server/env";
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
  if (run.log_ref) {
    try {
      const content = await fs.readFile(run.log_ref, "utf-8");
      if (content) {
        return Response.json({ ok: true, log: content });
      }
    } catch {
      // fallback to worker log
    }
  }
  const media = state.media[run.media_id];
  if (!media) {
    return Response.json({ ok: true, log: "" });
  }
  const log = await extractWorkerLog(env, media.path, run.started_at || 0);
  return Response.json({ ok: true, log });
}

type LogEntry = {
  ts?: string;
  level?: string;
  message?: string;
  path?: string;
  [key: string]: unknown;
};

async function extractWorkerLog(env: Record<string, string>, mediaPath: string, startedAt: number) {
  const logFile = env.LOG_FILE_NAME || "worker.log";
  const logPaths = await resolveLogPaths(env, logFile);
  if (!logPaths.length) return "";
  let content = "";
  for (const logPath of logPaths) {
    try {
      content = await fs.readFile(logPath, "utf-8");
      if (content) break;
    } catch {
      continue;
    }
  }
  if (!content) return "";
  const lines = content.trim().split("\n").slice(-4000);
  const selected: string[] = [];
  for (const line of lines) {
    let entry: LogEntry | null = null;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!entry || entry.path !== mediaPath || !entry.message || !entry.ts) continue;
    const ts = Date.parse(entry.ts);
    if (!Number.isFinite(ts)) continue;
    const sec = Math.floor(ts / 1000);
    if (startedAt && sec + 5 < startedAt) continue;
    const { ts: _ts, level, message, path: _path, ...rest } = entry;
    const extra = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : "";
    selected.push(`[${level || "INFO"}] ${message}${extra}`);
  }
  return selected.join("\n");
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
