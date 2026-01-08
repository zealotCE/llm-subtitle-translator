import { getAuthFromRequest } from "@/lib/server/auth";
import { loadEnv, resolvePath } from "@/lib/server/env";
import { listActivity, loadState } from "@/lib/server/v3/store";
import { loadRunMeta } from "@/lib/server/media";

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
  const typeCounts: Record<string, number> = {};
  const statusCounts: Record<string, number> = {};
  const allItems = state.activity;
  const typeFiltered = type ? allItems.filter((item) => item.type === type) : allItems;
  for (const item of allItems) {
    typeCounts[item.type] = (typeCounts[item.type] || 0) + 1;
  }
  for (const item of typeFiltered) {
    statusCounts[item.status] = (statusCounts[item.status] || 0) + 1;
  }
  const total = allItems.length;
  const processingCount = (statusCounts.pending || 0) + (statusCounts.running || 0);
  const items = await Promise.all(
    data.items.map(async (item) => {
      if (!item.media_id) {
        return item;
      }
      const media = state.media[item.media_id];
      if (!media) {
        return item;
      }
      const runMeta = await loadRunMeta(env, media.path);
      return {
        ...item,
        media_title: media.title,
        media_path: media.path,
        progress: typeof runMeta?.progress === "number" ? runMeta.progress : null,
        stage: typeof runMeta?.stage === "string" ? runMeta.stage : "",
        asr_model: typeof runMeta?.asr_model === "string" ? runMeta.asr_model : undefined,
        llm_model: typeof runMeta?.llm_model === "string" ? runMeta.llm_model : undefined,
      };
    })
  );
  return Response.json({
    ok: true,
    ...data,
    items,
    counts: {
      total,
      type: typeCounts,
      status: statusCounts,
      processing: processingCount,
    },
  });
}
