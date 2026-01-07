import { getAuthFromRequest } from "@/lib/server/auth";
import { loadEnv, resolvePath } from "@/lib/server/env";
import { getMedia, listMediaOutputs, scanAndSync } from "@/lib/server/v3/store";

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
  const outputs = listMediaOutputs(media);
  return Response.json({ ok: true, outputs });
}
