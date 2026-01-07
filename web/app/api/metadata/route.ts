import fs from "fs/promises";
import path from "path";
import { getAuthFromRequest } from "@/lib/server/auth";
import { loadEnv, resolvePath } from "@/lib/server/env";
import { isMediaPath, metadataPathFor } from "@/lib/server/media";

export const runtime = "nodejs";

const CONFIG_PATH = process.env.WEB_CONFIG_PATH || ".env";

export async function GET(request: Request) {
  const env = await loadEnv(resolvePath(CONFIG_PATH));
  const auth = getAuthFromRequest(request, env);
  if (!auth.ok) {
    return Response.json({ ok: false, message: "未登录" }, { status: 401 });
  }
  const url = new URL(request.url);
  const video = url.searchParams.get("path") || "";
  if (!video) {
    return Response.json({ ok: false, message: "缺少路径" }, { status: 400 });
  }
  if (!isMediaPath(env, video)) {
    return Response.json({ ok: false, message: "路径不允许" }, { status: 400 });
  }
  const metaPath = metadataPathFor(env, video);
  if (!metaPath) {
    return Response.json({ ok: false, message: "无法确定元数据路径" }, { status: 400 });
  }
  let data = {};
  try {
    const raw = await fs.readFile(metaPath, "utf-8");
    data = JSON.parse(raw);
  } catch {
    data = {};
  }
  return Response.json({ ok: true, path: metaPath, data });
}

export async function POST(request: Request) {
  const env = await loadEnv(resolvePath(CONFIG_PATH));
  const auth = getAuthFromRequest(request, env);
  if (!auth.ok) {
    return Response.json({ ok: false, message: "未登录" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const video = String(body?.path || "");
  if (!video) {
    return Response.json({ ok: false, message: "缺少路径" }, { status: 400 });
  }
  if (!isMediaPath(env, video)) {
    return Response.json({ ok: false, message: "路径不允许" }, { status: 400 });
  }
  const metaPath = metadataPathFor(env, video);
  if (!metaPath) {
    return Response.json({ ok: false, message: "无法确定元数据路径" }, { status: 400 });
  }
  let data = body?.data ?? {};
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      data = {};
    }
  }
  await fs.mkdir(path.dirname(metaPath) || ".", { recursive: true });
  await fs.writeFile(metaPath, JSON.stringify(data, null, 2), "utf-8");
  return Response.json({ ok: true, path: metaPath });
}
