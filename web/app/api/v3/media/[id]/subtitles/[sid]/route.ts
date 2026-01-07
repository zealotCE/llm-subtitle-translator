import fs from "fs/promises";
import { getAuthFromRequest } from "@/lib/server/auth";
import { loadEnv, resolvePath } from "@/lib/server/env";
import { findMediaOutput, getMedia, scanAndSync } from "@/lib/server/v3/store";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: { id: string; sid: string } }) {
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
  const output = findMediaOutput(media, context.params.sid);
  if (!output) {
    return Response.json({ ok: false, message: "未找到字幕" }, { status: 404 });
  }
  try {
    const content = await fs.readFile(output.path, "utf-8");
    return Response.json({ ok: true, content });
  } catch {
    return Response.json({ ok: false, message: "读取字幕失败" }, { status: 500 });
  }
}
