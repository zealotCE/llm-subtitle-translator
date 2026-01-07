import { getAuthFromRequest } from "@/lib/server/auth";
import { loadEnv, resolvePath } from "@/lib/server/env";
import { findMediaOutput, getMedia, scanAndSync } from "@/lib/server/v3/store";
import fs from "fs/promises";
import path from "path";
import { writeTextFile } from "@/lib/server/files";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: { id: string; sid: string } }) {
  const env = await loadEnv(resolvePath(".env"));
  const auth = getAuthFromRequest(request, env);
  if (!auth.ok) {
    return Response.json({ ok: false, message: "未登录" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const content = String(body?.content || "");
  const mode = String(body?.mode || "save");
  const state = await scanAndSync(env);
  const media = getMedia(state, context.params.id);
  if (!media) {
    return Response.json({ ok: false, message: "未找到媒体" }, { status: 404 });
  }
  const output = findMediaOutput(media, context.params.sid);
  if (!output) {
    return Response.json({ ok: false, message: "未找到字幕" }, { status: 404 });
  }
  const targetPath =
    mode === "save_as"
      ? path.join(path.dirname(output.path), `${path.parse(output.path).name}.edited.srt`)
      : output.path;
  if (mode === "save") {
    try {
      await fs.copyFile(output.path, `${output.path}.bak.${Date.now()}`);
    } catch {
      // ignore
    }
  }
  await writeTextFile(targetPath, content);
  return Response.json({ ok: true, path: targetPath });
}
