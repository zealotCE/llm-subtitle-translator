import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { resolvePath } from "@/lib/server/env";
import { getOutputDir, getWatchDirs, scanVideos } from "@/lib/server/media";
import type {
  ActivityItem,
  MediaItem,
  MediaOutput,
  MediaOutputs,
  MediaStatus,
  RunItem,
  RunStatus,
  RunType,
  StoreState,
} from "@/lib/server/v3/types";

const STATE_FILE = process.env.WEB_V3_STATE_FILE || ".web/v3.json";

export async function loadState(): Promise<StoreState> {
  const filePath = resolvePath(STATE_FILE);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const data = JSON.parse(raw) as StoreState;
    return {
      media: data.media || {},
      runs: data.runs || {},
      activity: data.activity || [],
    };
  } catch {
    return { media: {}, runs: {}, activity: [] };
  }
}

export async function saveState(state: StoreState) {
  const filePath = resolvePath(STATE_FILE);
  await fs.mkdir(path.dirname(filePath) || ".", { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(state, null, 2), "utf-8");
}

export async function scanAndSync(env: Record<string, string>) {
  const state = await loadState();
  const watchDirs = getWatchDirs(env);
  const items = await scanVideos(watchDirs, (env.WATCH_RECURSIVE || "true") === "true");
  const now = Math.floor(Date.now() / 1000);

  for (const item of items) {
    const id = hashPath(item.path);
    const existing = state.media[id];
    const outputs = await collectOutputs(env, item.path);
    const failedLog = findTranslateFailedLog(env, item.path);
    const status = resolveStatus(env, item.path, outputs, existing?.archived || false);
    if (!existing) {
      state.media[id] = {
        id,
        path: item.path,
        title: path.basename(item.path),
        status,
        archived: false,
        outputs,
        created_at: now,
        updated_at: now,
      };
      state.activity.unshift({
        id: `${id}-added-${now}`,
        media_id: id,
        type: "media_added",
        status: "info",
        message: "发现新媒体",
        created_at: now,
      });
    } else {
      const changed = existing.status !== status || outputsChanged(existing.outputs, outputs);
      if (changed) {
        const updated = { ...existing, status, outputs, updated_at: now };
        const result = syncRunForStatus(state, updated, status, now, failedLog);
        state.media[id] = { ...updated, last_run_id: result.lastRunId };
        if (existing.status !== status) {
          state.activity.unshift({
            id: `${id}-status-${now}`,
            media_id: id,
            run_id: result.lastRunId,
            type: "status_change",
            status,
            message: `状态变更为 ${status}`,
            created_at: now,
          });
        }
      } else {
        state.media[id] = { ...existing, outputs };
      }
    }
  }

  await saveState(state);
  return state;
}

export function listMedia(
  state: StoreState,
  options: {
    query?: string;
    filters?: string[];
    sort?: string;
    page?: number;
    pageSize?: number;
  }
) {
  const query = (options.query || "").toLowerCase();
  const filters = options.filters || [];
  let items = Object.values(state.media);
  if (query) {
    items = items.filter(
      (item) => item.title.toLowerCase().includes(query) || item.path.toLowerCase().includes(query)
    );
  }
  if (filters.length) {
    const filterSet = new Set(filters);
    items = items.filter((item) => {
      if (filterSet.has("missing_zh") && item.outputs.zh) return false;
      if (filterSet.has("archived") && !item.archived) return false;
      if (filterSet.has("failed") && item.status !== "failed") return false;
      if (filterSet.has("running") && item.status !== "running") return false;
      if (filterSet.has("pending") && item.status !== "pending") return false;
      if (filterSet.has("done") && item.status !== "done") return false;
      return true;
    });
  }
  items = sortMedia(items, options.sort);
  const total = items.length;
  const pageSize = Math.max(1, Math.min(options.pageSize || 50, 200));
  const page = Math.max(1, options.page || 1);
  const start = (page - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    total,
    page,
    page_size: pageSize,
  };
}

export function getMedia(state: StoreState, id: string) {
  return state.media[id] || null;
}

export function listMediaOutputs(media: MediaItem) {
  const items: MediaOutput[] = [];
  if (media.outputs.raw) items.push(media.outputs.raw);
  if (media.outputs.zh) items.push(media.outputs.zh);
  if (media.outputs.bi) items.push(media.outputs.bi);
  if (media.outputs.other.length) {
    items.push(...media.outputs.other);
  }
  return items;
}

export function findMediaOutput(media: MediaItem, outputId: string) {
  return listMediaOutputs(media).find((item) => item.id === outputId) || null;
}

export function listRuns(state: StoreState, mediaId?: string) {
  const runs = Object.values(state.runs);
  return mediaId ? runs.filter((run) => run.media_id === mediaId) : runs;
}

export function listActivity(
  state: StoreState,
  options: { type?: string; status?: string; page?: number; pageSize?: number }
) {
  const type = (options.type || "").trim();
  const status = (options.status || "").trim();
  let items = state.activity;
  if (type) {
    items = items.filter((item) => item.type === type);
  }
  if (status) {
    items = items.filter((item) => item.status === status);
  }
  const total = items.length;
  const pageSize = Math.max(1, Math.min(options.pageSize || 50, 200));
  const page = Math.max(1, options.page || 1);
  const start = (page - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    total,
    page,
    page_size: pageSize,
  };
}

export function buildSummary(state: StoreState) {
  const items = Object.values(state.media);
  const counts = {
    total: items.length,
    pending: 0,
    running: 0,
    failed: 0,
    done: 0,
    archived: 0,
    missing_zh: 0,
  };
  for (const item of items) {
    switch (item.status) {
      case "pending":
        counts.pending += 1;
        break;
      case "running":
        counts.running += 1;
        break;
      case "failed":
        counts.failed += 1;
        break;
      case "done":
        counts.done += 1;
        break;
      case "archived":
        counts.archived += 1;
        break;
      default:
        break;
    }
    if (!item.outputs.zh) {
      counts.missing_zh += 1;
    }
  }
  const recentFailed = items
    .filter((item) => item.status === "failed")
    .sort((a, b) => b.updated_at - a.updated_at)
    .slice(0, 5);
  const recentDone = items
    .filter((item) => item.status === "done")
    .sort((a, b) => b.updated_at - a.updated_at)
    .slice(0, 5);
  return {
    counts,
    recent_failed: recentFailed,
    recent_done: recentDone,
  };
}

export function appendRun(state: StoreState, mediaId: string, type: RunType, status: RunStatus) {
  const now = Math.floor(Date.now() / 1000);
  const id = `${mediaId}-${type}-${now}`;
  const run: RunItem = {
    id,
    media_id: mediaId,
    type,
    status,
    started_at: now,
    finished_at: status === "running" ? undefined : now,
  };
  state.runs[id] = run;
  return run;
}

export function appendActivity(state: StoreState, activity: ActivityItem) {
  state.activity.unshift(activity);
  state.activity = state.activity.slice(0, 5000);
}

function sortMedia(items: MediaItem[], sort?: string) {
  const key = sort || "updated_desc";
  if (key === "created_desc") {
    return items.sort((a, b) => b.created_at - a.created_at);
  }
  if (key === "failed_first") {
    return items.sort((a, b) => {
      if (a.status === "failed" && b.status !== "failed") return -1;
      if (a.status !== "failed" && b.status === "failed") return 1;
      return b.updated_at - a.updated_at;
    });
  }
  return items.sort((a, b) => b.updated_at - a.updated_at);
}

async function collectOutputs(env: Record<string, string>, videoPath: string): Promise<MediaOutputs> {
  const outDir = getOutputDir(env, videoPath);
  const base = path.basename(videoPath, path.extname(videoPath));
  const suffix = env.OUTPUT_LANG_SUFFIX || "";
  const rawName = `${base}${suffix}`;
  const outputs: MediaOutputs = { other: [] };
  if (!outDir) {
    return outputs;
  }
  const rawPath = path.join(outDir, `${rawName}.srt`);
  const raw = await buildOutput("raw", rawPath);
  if (raw) {
    outputs.raw = raw;
  }
  const simp = (env.SIMPLIFIED_LANG || "zh").trim();
  if (simp) {
    const llmPath = path.join(outDir, `${base}.llm.${simp}.srt`);
    const plainPath = path.join(outDir, `${base}.${simp}.srt`);
    const zh = (await buildOutput("zh", llmPath, simp)) || (await buildOutput("zh", plainPath, simp));
    if (zh) outputs.zh = zh;
  }
  const biPath = path.join(outDir, `${base}.bi.srt`);
  const bi = await buildOutput("bi", biPath);
  if (bi) outputs.bi = bi;

  try {
    const entries = await fs.readdir(outDir);
    for (const name of entries) {
      if (!name.toLowerCase().endsWith(".srt")) continue;
      if (name === `${rawName}.srt`) continue;
      if (outputs.zh && name === path.basename(outputs.zh.path)) continue;
      if (outputs.bi && name === path.basename(outputs.bi.path)) continue;
      if (!name.startsWith(`${base}.`)) continue;
      const full = path.join(outDir, name);
      const other = await buildOutput("other", full);
      if (other) outputs.other.push(other);
    }
  } catch {
    // ignore
  }
  return outputs;
}

function resolveStatus(
  env: Record<string, string>,
  videoPath: string,
  outputs: MediaOutputs,
  archived: boolean
): MediaStatus {
  if (archived) return "archived";
  const outDir = getOutputDir(env, videoPath);
  if (!outDir) return "pending";
  const base = path.basename(videoPath, path.extname(videoPath));
  const suffix = env.OUTPUT_LANG_SUFFIX || "";
  const marker = `${base}${suffix}`;
  const lockPath = path.join(outDir, `${marker}.lock`);
  const donePath = path.join(outDir, `${marker}.done`);
  if (exists(lockPath)) return "running";
  if (hasTranslateFailed(outDir, base)) return "failed";
  if (exists(donePath)) return "done";
  if (outputs.raw || outputs.zh || outputs.bi) return "done";
  return "pending";
}

function hasTranslateFailed(outDir: string, base: string) {
  try {
    const entries = require("fs").readdirSync(outDir);
    return entries.some((name: string) => name.startsWith(`${base}.translate_failed`));
  } catch {
    return false;
  }
}

function findTranslateFailedLog(env: Record<string, string>, videoPath: string) {
  const outDir = getOutputDir(env, videoPath);
  if (!outDir) return "";
  const base = path.basename(videoPath, path.extname(videoPath));
  try {
    const entries = require("fs").readdirSync(outDir);
    const match = entries.find((name: string) => name.startsWith(`${base}.translate_failed`));
    return match ? path.join(outDir, match) : "";
  } catch {
    return "";
  }
}

function outputsChanged(a: MediaOutputs, b: MediaOutputs) {
  const key = (output?: MediaOutput) => output?.path || "";
  return (
    key(a.raw) !== key(b.raw) ||
    key(a.zh) !== key(b.zh) ||
    key(a.bi) !== key(b.bi) ||
    a.other.length !== b.other.length
  );
}

function syncRunForStatus(
  state: StoreState,
  media: MediaItem,
  status: MediaStatus,
  now: number,
  failedLog?: string
) {
  let lastRunId = media.last_run_id;
  if (status === "running") {
    const run = appendRun(state, media.id, "pipeline", "running");
    lastRunId = run.id;
  } else if (status === "done" || status === "failed") {
    if (lastRunId && state.runs[lastRunId]) {
      const run = state.runs[lastRunId];
      if (run.status === "running") {
        state.runs[lastRunId] = {
          ...run,
          status: status === "done" ? "done" : "failed",
          error: status === "failed" ? "translate_failed" : undefined,
          log_ref: status === "failed" ? failedLog || run.log_ref : run.log_ref,
          finished_at: now,
        };
      }
    } else {
      const run = appendRun(state, media.id, "pipeline", status === "done" ? "done" : "failed");
      if (status === "failed") {
        run.error = "translate_failed";
        run.log_ref = failedLog || "";
        state.runs[run.id] = run;
      }
      lastRunId = run.id;
    }
  }
  return { lastRunId };
}

async function buildOutput(kind: "raw" | "zh" | "bi" | "other", filePath: string, lang?: string) {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return null;
    return {
      id: hashPath(filePath),
      kind,
      lang,
      path: filePath,
      updated_at: Math.floor(stat.mtimeMs / 1000),
      size: stat.size,
    } as MediaOutput;
  } catch {
    return null;
  }
}

function hashPath(value: string) {
  return crypto.createHash("sha1").update(value).digest("hex");
}

function exists(p: string) {
  try {
    return require("fs").existsSync(p);
  } catch {
    return false;
  }
}
