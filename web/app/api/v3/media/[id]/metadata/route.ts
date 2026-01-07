import fs from "fs/promises";
import path from "path";
import { getAuthFromRequest } from "@/lib/server/auth";
import { loadEnv, resolvePath } from "@/lib/server/env";
import { metadataPathFor } from "@/lib/server/media";
import { getMedia, scanAndSync } from "@/lib/server/v3/store";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: { id: string } }) {
  const env = await loadEnv(resolvePath(".env"));
  const auth = getAuthFromRequest(request, env);
  if (!auth.ok) {
    return Response.json({ ok: false, message: "未登录" }, { status: 401 });
  }
  const state = await scanAndSync(env);
  const media = getMedia(state, context.params.id);
  if (!media) {
    return Response.json({ ok: false, message: "未找到媒体" }, { status: 404 });
  }
  const metaPath = metadataPathFor(env, media.path);
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

export async function POST(request: Request, context: { params: { id: string } }) {
  const env = await loadEnv(resolvePath(".env"));
  const auth = getAuthFromRequest(request, env);
  if (!auth.ok) {
    return Response.json({ ok: false, message: "未登录" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const state = await scanAndSync(env);
  const media = getMedia(state, context.params.id);
  if (!media) {
    return Response.json({ ok: false, message: "未找到媒体" }, { status: 404 });
  }
  const metaPath = metadataPathFor(env, media.path);
  if (!metaPath) {
    return Response.json({ ok: false, message: "无法确定元数据路径" }, { status: 400 });
  }
  const data = body?.data ?? {};
  await fs.mkdir(path.dirname(metaPath) || ".", { recursive: true });
  await fs.writeFile(metaPath, JSON.stringify(data, null, 2), "utf-8");
  return Response.json({ ok: true, path: metaPath });
}
