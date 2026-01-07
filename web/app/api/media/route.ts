import { getAuthFromRequest } from "@/lib/server/auth";
import { loadEnv, resolvePath } from "@/lib/server/env";
import { getMediaDirs, getSimplifiedSubtitlePaths, scanVideos } from "@/lib/server/media";
import { loadMediaState, saveMediaState } from "@/lib/server/storage";
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
  const dirs = getMediaDirs(env);
  const recursive = (env.WEB_MEDIA_RECURSIVE || "true") === "true";
  const items = await scanVideos(dirs, recursive);
  const state = await loadMediaState();
  const rows = await Promise.all(
    items
      .filter((item) => (keyword ? item.path.includes(keyword) : true))
      .map(async (item) => {
        const simplified = getSimplifiedSubtitlePaths(env, item.path);
        return {
          ...item,
          archived: state[item.path]?.archived || false,
          label: state[item.path]?.label || "",
          simplified_present: simplified.length > 0,
          simplified_paths: simplified,
        };
      })
  );
  return Response.json({ media: rows });
}

export async function POST(request: Request) {
  const env = await loadEnv(resolvePath(CONFIG_PATH));
  const auth = getAuthFromRequest(request, env);
  if (!auth.ok) {
    return Response.json({ ok: false, message: "未登录" }, { status: 401 });
  }
  const body = await request.json();
  const action = body?.action;
  const pathValue = body?.path || "";
  const state = await loadMediaState();
  if (action === "archive" && pathValue) {
    if (env.WEB_ARCHIVE_DIR) {
      const dest = resolvePath(path.join(env.WEB_ARCHIVE_DIR, path.basename(pathValue)));
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.rename(pathValue, dest);
      delete state[pathValue];
      state[dest] = { archived: true };
    } else {
      state[pathValue] = { ...state[pathValue], archived: true };
    }
  }
  if (action === "unarchive" && pathValue) {
    state[pathValue] = { ...state[pathValue], archived: false };
  }
  if (action === "delete" && pathValue && env.WEB_ALLOW_DELETE === "true") {
    await fs.rm(pathValue, { force: true });
    delete state[pathValue];
  }
  if (action === "scan") {
    // nothing to do, GET will scan
  }
  await saveMediaState(state);
  return Response.json({ ok: true });
}
