import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import crypto from "crypto";
import { resolvePath } from "@/lib/server/env";

const VIDEO_EXTS = new Set([".mp4", ".mkv", ".webm", ".mov", ".avi"]);
const SUBTITLE_EXTS = new Set([".srt", ".ass", ".ssa", ".vtt", ".sub", ".sup"]);
const execFileAsync = promisify(execFile);
const DEFAULT_MEDIA_SCAN_CACHE_TTL = 10;
const DEFAULT_FFPROBE_CACHE_TTL = 3600;

export function parseDirs(raw: string) {
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((value) => value.replace(/^['"]|['"]$/g, ""));
}

export function getWatchDirs(env: Record<string, string>) {
  return parseDirs(env.WATCH_DIRS || process.env.WATCH_DIRS || "");
}

export function getMediaDirs(env: Record<string, string>) {
  return parseDirs(
    env.WEB_MEDIA_DIRS || process.env.WEB_MEDIA_DIRS || env.WATCH_DIRS || process.env.WATCH_DIRS || ""
  );
}

export function getOutputDir(env: Record<string, string>, videoPath: string) {
  const outputToSource = (env.OUTPUT_TO_SOURCE_DIR || "true") === "true";
  if (outputToSource) {
    return path.dirname(videoPath);
  }
  return env.OUT_DIR || "";
}

export function isSafePath(env: Record<string, string>, targetPath: string) {
  const roots: string[] = [];
  roots.push(...getWatchDirs(env));
  if (env.OUT_DIR) {
    roots.push(env.OUT_DIR);
  }
  const absTarget = path.resolve(targetPath);
  return roots.some((root) => {
    if (!root) return false;
    const absRoot = path.resolve(root);
    return absTarget === absRoot || absTarget.startsWith(`${absRoot}${path.sep}`);
  });
}

export function isMediaPath(env: Record<string, string>, targetPath: string) {
  const absTarget = path.resolve(targetPath);
  return getMediaDirs(env).some((root) => {
    if (!root) return false;
    const absRoot = path.resolve(root);
    return absTarget === absRoot || absTarget.startsWith(`${absRoot}${path.sep}`);
  });
}

export async function findSubtitleCandidates(env: Record<string, string>, videoPath: string) {
  const outDir = getOutputDir(env, videoPath);
  if (!outDir) {
    return [];
  }
  const base = path.basename(videoPath, path.extname(videoPath));
  try {
    const entries = await fs.readdir(outDir);
    return entries
      .filter((name) => name.toLowerCase().endsWith(".srt"))
      .filter((name) => {
        const stem = path.basename(name, path.extname(name));
        return stem === base || stem.startsWith(`${base}.`);
      })
      .map((name) => path.join(outDir, name))
      .sort();
  } catch {
    return [];
  }
}

export async function detectSubtitleHints(env: Record<string, string>, videoPath: string) {
  const external = await findExternalSubtitles(env, videoPath);
  const embeddedCount = await findEmbeddedSubtitles(videoPath);
  return {
    external_count: external.length,
    embedded_count: embeddedCount,
    has_subtitle: external.length > 0 || embeddedCount > 0,
  };
}

export async function loadRunMeta(env: Record<string, string>, videoPath: string) {
  const outDir = getOutputDir(env, videoPath);
  if (!outDir) return null;
  const metaPath = runMetaPathFor(videoPath, outDir);
  try {
    const raw = await fs.readFile(metaPath, "utf-8");
    const data = JSON.parse(raw);
    if (data && typeof data === "object") {
      return data as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

export function runMetaPathFor(videoPath: string, outDir: string) {
  const base = path.basename(videoPath, path.extname(videoPath));
  const token = crypto.createHash("sha1").update(videoPath).digest("hex").slice(0, 8);
  return path.join(outDir, `${base}.${token}.run.json`);
}

async function findExternalSubtitles(env: Record<string, string>, videoPath: string) {
  const base = path.basename(videoPath, path.extname(videoPath)).toLowerCase();
  const dirs = new Set<string>();
  dirs.add(path.dirname(videoPath));
  const outDir = getOutputDir(env, videoPath);
  if (outDir) {
    dirs.add(outDir);
  }
  const matches = new Set<string>();
  for (const dir of dirs) {
    try {
      const entries = await fs.readdir(dir);
      for (const name of entries) {
        const ext = path.extname(name).toLowerCase();
        if (!SUBTITLE_EXTS.has(ext)) continue;
        const stem = path.basename(name, ext).toLowerCase();
        if (stem === base || stem.startsWith(`${base}.`)) {
          matches.add(path.join(dir, name));
        }
      }
    } catch {
      continue;
    }
  }
  return Array.from(matches);
}

async function findEmbeddedSubtitles(videoPath: string) {
  const ttlRaw = parseInt(process.env.WEB_FFPROBE_CACHE_TTL || "", 10);
  const ttl = Number.isFinite(ttlRaw) ? ttlRaw : DEFAULT_FFPROBE_CACHE_TTL;
  const cachePath = resolvePath(process.env.WEB_FFPROBE_CACHE_PATH || ".web/ffprobe_cache.json");
  const stat = await safeStat(videoPath);
  if (!stat) return 0;
  const cache = await loadFfprobeCache(cachePath);
  const now = Math.floor(Date.now() / 1000);
  const key = `${videoPath}:${stat.mtimeMs}`;
  if (ttl > 0 && cache[key] && now - cache[key].ts <= ttl) {
    return cache[key].count;
  }
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "s",
        "-show_entries",
        "stream=index",
        "-of",
        "json",
        videoPath,
      ],
      { timeout: 5000 }
    );
    const data = JSON.parse(stdout || "{}") as { streams?: unknown[] };
    const streams = Array.isArray(data.streams) ? data.streams : [];
    if (ttl > 0) {
      cache[key] = { ts: now, count: streams.length };
      pruneFfprobeCache(cache, now, ttl);
      await saveFfprobeCache(cachePath, cache);
    }
    return streams.length;
  } catch {
    return 0;
  }
}

export function metadataPathFor(env: Record<string, string>, videoPath: string) {
  const outDir = getOutputDir(env, videoPath);
  if (!outDir) {
    return "";
  }
  const metaDir = env.WEB_METADATA_DIR || env.MANUAL_METADATA_DIR || "metadata";
  const base = path.basename(videoPath, path.extname(videoPath));
  const dir = path.isAbsolute(metaDir) ? metaDir : path.join(outDir, metaDir);
  return path.join(dir, `${base}.manual.json`);
}

export function getSimplifiedSubtitlePaths(env: Record<string, string>, videoPath: string) {
  const outDir = getOutputDir(env, videoPath);
  if (!outDir) {
    return [];
  }
  const lang = (env.SIMPLIFIED_LANG || "zh").trim();
  if (!lang) {
    return [];
  }
  const base = path.basename(videoPath, path.extname(videoPath));
  const candidates = [
    path.join(outDir, `${base}.${lang}.srt`),
    path.join(outDir, `${base}.llm.${lang}.srt`),
  ];
  return candidates.filter((p) => exists(p));
}

export async function scanVideos(dirs: string[], recursive: boolean) {
  const results: { path: string; size: number; mtime: number }[] = [];
  for (const base of dirs) {
    try {
      const stat = await fs.stat(base);
      if (!stat.isDirectory()) {
        continue;
      }
    } catch {
      continue;
    }
    if (recursive) {
      const stack = [base];
      while (stack.length) {
        const current = stack.pop() as string;
        const entries = await fs.readdir(current, { withFileTypes: true });
        for (const entry of entries) {
          const full = path.join(current, entry.name);
          if (entry.isDirectory()) {
            stack.push(full);
            continue;
          }
          if (!entry.isFile()) {
            continue;
          }
          if (!VIDEO_EXTS.has(path.extname(entry.name).toLowerCase())) {
            continue;
          }
          const fileStat = await fs.stat(full);
          results.push({ path: full, size: fileStat.size, mtime: Math.floor(fileStat.mtimeMs / 1000) });
        }
      }
    } else {
      const entries = await fs.readdir(base, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) {
          continue;
        }
        if (!VIDEO_EXTS.has(path.extname(entry.name).toLowerCase())) {
          continue;
        }
        const full = path.join(base, entry.name);
        const fileStat = await fs.stat(full);
        results.push({ path: full, size: fileStat.size, mtime: Math.floor(fileStat.mtimeMs / 1000) });
      }
    }
  }
  return results.sort((a, b) => b.mtime - a.mtime);
}

export async function scanVideosCached(
  env: Record<string, string>,
  dirs: string[],
  recursive: boolean
) {
  const ttl = parseInt(env.WEB_MEDIA_SCAN_CACHE_TTL || "", 10);
  const cacheTtl = Number.isFinite(ttl) ? ttl : DEFAULT_MEDIA_SCAN_CACHE_TTL;
  if (cacheTtl <= 0) {
    return scanVideos(dirs, recursive);
  }
  const cachePath = resolvePath(env.WEB_MEDIA_SCAN_CACHE_PATH || ".web/media_scan_cache.json");
  const cache = await loadScanCache(cachePath);
  const now = Math.floor(Date.now() / 1000);
  if (
    cache &&
    now - cache.cached_at <= cacheTtl &&
    cache.recursive === recursive &&
    arraysEqual(cache.dirs, dirs)
  ) {
    return cache.items;
  }
  const items = await scanVideos(dirs, recursive);
  await saveScanCache(cachePath, {
    cached_at: now,
    dirs,
    recursive,
    items,
  });
  return items;
}

export function inferStatus(videoPath: string, outputDir: string) {
  const base = path.basename(videoPath, path.extname(videoPath));
  const done = path.join(outputDir, `${base}.done`);
  const lock = path.join(outputDir, `${base}.lock`);
  if (exists(done)) return "done";
  if (exists(lock)) return "running";
  return "pending";
}

export async function loadJobMeta(videoPath: string) {
  const base = path.basename(videoPath, path.extname(videoPath));
  const metaPath = path.join(path.dirname(videoPath), `${base}.job.json`);
  try {
    const raw = await fs.readFile(metaPath, "utf-8");
    const data = JSON.parse(raw);
    if (data && typeof data === "object") {
      return data as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  return {};
}

type ScanCache = {
  cached_at: number;
  dirs: string[];
  recursive: boolean;
  items: { path: string; size: number; mtime: number }[];
};

async function loadScanCache(cachePath: string): Promise<ScanCache | null> {
  try {
    const raw = await fs.readFile(cachePath, "utf-8");
    const data = JSON.parse(raw) as ScanCache;
    if (!data || !Array.isArray(data.items) || !Array.isArray(data.dirs)) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

async function saveScanCache(cachePath: string, data: ScanCache) {
  try {
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(cachePath, JSON.stringify(data), "utf-8");
  } catch {
    // ignore
  }
}

function arraysEqual(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  return a.every((value, idx) => value === b[idx]);
}

type FfprobeCache = Record<string, { ts: number; count: number }>;

async function loadFfprobeCache(cachePath: string): Promise<FfprobeCache> {
  try {
    const raw = await fs.readFile(cachePath, "utf-8");
    const data = JSON.parse(raw) as FfprobeCache;
    return data || {};
  } catch {
    return {};
  }
}

async function saveFfprobeCache(cachePath: string, cache: FfprobeCache) {
  try {
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(cachePath, JSON.stringify(cache), "utf-8");
  } catch {
    // ignore
  }
}

function pruneFfprobeCache(cache: FfprobeCache, now: number, ttl: number) {
  for (const [key, entry] of Object.entries(cache)) {
    if (!entry || now - entry.ts > ttl) {
      delete cache[key];
    }
  }
}

async function safeStat(targetPath: string) {
  try {
    return await fs.stat(targetPath);
  } catch {
    return null;
  }
}

function exists(p: string) {
  try {
    return require("fs").existsSync(p);
  } catch {
    return false;
  }
}
