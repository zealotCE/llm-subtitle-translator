import { getAuthFromRequest } from "@/lib/server/auth";
import { loadEnv, resolvePath } from "@/lib/server/env";
import { listActivity, loadState } from "@/lib/server/v3/store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const env = await loadEnv(resolvePath(".env"));
  const auth = getAuthFromRequest(request, env);
  if (!auth.ok) {
    return Response.json({ ok: false, message: "未登录" }, { status: 401 });
  }
  const url = new URL(request.url);
  const type = url.searchParams.get("type") || "";
  const status = url.searchParams.get("status") || "";
  const page = Number(url.searchParams.get("page") || "1");
  const pageSize = Number(url.searchParams.get("page_size") || "50");
  const state = await loadState();
  const data = listActivity(state, { type, status, page, pageSize });
  const items = data.items.map((item) => {
    if (!item.media_id) {
      return item;
    }
    const media = state.media[item.media_id];
    if (!media) {
      return item;
    }
    return {
      ...item,
      media_title: media.title,
      media_path: media.path,
    };
  });
  return Response.json({ ok: true, ...data, items });
}
