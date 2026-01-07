import fs from "fs/promises";
import path from "path";

const VIDEO_EXTS = new Set([".mp4", ".mkv", ".webm", ".mov", ".avi"]);

export function parseDirs(raw: string) {
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((value) => value.replace(/^['"]|['"]$/g, ""));
}

export function getWatchDirs(env: Record<string, string>) {
  return parseDirs(env.WATCH_DIRS || "");
}

export function getMediaDirs(env: Record<string, string>) {
  return parseDirs(env.WEB_MEDIA_DIRS || env.WATCH_DIRS || "");
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

function exists(p: string) {
  try {
    return require("fs").existsSync(p);
  } catch {
    return false;
  }
}
