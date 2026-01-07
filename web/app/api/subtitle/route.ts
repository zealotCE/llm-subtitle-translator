import fs from "fs/promises";
import path from "path";
import { getAuthFromRequest } from "@/lib/server/auth";
import { loadEnv, resolvePath } from "@/lib/server/env";
import { findSubtitleCandidates, getOutputDir, isMediaPath, isSafePath } from "@/lib/server/media";
import { readTextFile, writeTextFile } from "@/lib/server/files";

export const runtime = "nodejs";

const CONFIG_PATH = process.env.WEB_CONFIG_PATH || ".env";

function timestamp() {
  const now = new Date();
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(
    now.getMinutes()
  )}${pad(now.getSeconds())}`;
}

export async function GET(request: Request) {
  const env = await loadEnv(resolvePath(CONFIG_PATH));
  const auth = getAuthFromRequest(request, env);
  if (!auth.ok) {
    return Response.json({ ok: false, message: "未登录" }, { status: 401 });
  }
  const url = new URL(request.url);
  const video = url.searchParams.get("video") || "";
  let targetPath = url.searchParams.get("path") || "";
  let candidates: string[] = [];
  if (video) {
    if (!isMediaPath(env, video)) {
      return Response.json({ ok: false, message: "路径不允许" }, { status: 400 });
    }
    candidates = await findSubtitleCandidates(env, video);
    if (!targetPath && candidates.length) {
      targetPath = candidates[0];
    }
  }
  if (targetPath && !isSafePath(env, targetPath)) {
    return Response.json({ ok: false, message: "路径不允许" }, { status: 400 });
  }
  let content = "";
  if (targetPath) {
    try {
      content = await readTextFile(targetPath);
    } catch {
      content = "";
    }
  }
  return Response.json({ ok: true, video, path: targetPath, candidates, content });
}

export async function POST(request: Request) {
  const env = await loadEnv(resolvePath(CONFIG_PATH));
  const auth = getAuthFromRequest(request, env);
  if (!auth.ok) {
    return Response.json({ ok: false, message: "未登录" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const action = body?.action || "save";
  const content = String(body?.content || "");
  const video = String(body?.video || "");
  let targetPath = String(body?.path || "");
  if (!targetPath && video) {
    const candidates = await findSubtitleCandidates(env, video);
    targetPath = candidates[0] || "";
  }
  if (!targetPath) {
    return Response.json({ ok: false, message: "缺少字幕路径" }, { status: 400 });
  }
  if (!isSafePath(env, targetPath)) {
    return Response.json({ ok: false, message: "路径不允许" }, { status: 400 });
  }
  let savePath = targetPath;
  if (action === "save_as") {
    const outputDir = video ? getOutputDir(env, video) : path.dirname(targetPath);
    const base = path.basename(targetPath, path.extname(targetPath));
    savePath = path.join(outputDir || path.dirname(targetPath), `${base}.edited.srt`);
  }
  if (!isSafePath(env, savePath)) {
    return Response.json({ ok: false, message: "保存路径不允许" }, { status: 400 });
  }
  if (action === "save") {
    try {
      await fs.copyFile(targetPath, `${targetPath}.bak.${timestamp()}`);
    } catch {
      // ignore
    }
  }
  await writeTextFile(savePath, content);
  return Response.json({ ok: true, path: savePath });
}
