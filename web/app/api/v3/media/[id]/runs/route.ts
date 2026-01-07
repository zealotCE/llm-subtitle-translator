import { getAuthFromRequest } from "@/lib/server/auth";
import { loadEnv, resolvePath } from "@/lib/server/env";
import { getMedia, listRuns, scanAndSync } from "@/lib/server/v3/store";

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
  const runs = listRuns(state, media.id).sort((a, b) => b.started_at - a.started_at);
  return Response.json({ ok: true, runs });
}
