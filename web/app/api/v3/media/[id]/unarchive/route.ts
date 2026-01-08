import { getAuthFromRequest } from "@/lib/server/auth";
import { loadEnv, resolvePath } from "@/lib/server/env";
import { setArchivedMarker } from "@/lib/server/media";
import { getMedia, loadState, saveState } from "@/lib/server/v3/store";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: { id: string } }) {
  const env = await loadEnv(resolvePath(".env"));
  const auth = getAuthFromRequest(request, env);
  if (!auth.ok) {
    return Response.json({ ok: false, message: "未登录" }, { status: 401 });
  }
  const state = await loadState();
  const media = getMedia(state, context.params.id);
  if (!media) {
    return Response.json({ ok: false, message: "未找到媒体" }, { status: 404 });
  }
  media.archived = false;
  media.status = "pending";
  media.updated_at = Math.floor(Date.now() / 1000);
  state.media[media.id] = media;
  await setArchivedMarker(env, media.path, false);
  await saveState(state);
  return Response.json({ ok: true, media });
}
