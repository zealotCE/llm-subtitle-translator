import { getAuthFromRequest } from "@/lib/server/auth";
import { loadEnv, resolvePath } from "@/lib/server/env";
import { listActivity, loadState } from "@/lib/server/v3/store";
import { loadRunMeta } from "@/lib/server/media";
import { createClient } from "redis";

export const runtime = "nodejs";

function buildCounts(state: Awaited<ReturnType<typeof loadState>>) {
  const typeCounts: Record<string, number> = {};
  const statusCounts: Record<string, number> = {};
  const allItems = state.activity;
  for (const item of allItems) {
    typeCounts[item.type] = (typeCounts[item.type] || 0) + 1;
  }
  for (const item of allItems) {
    statusCounts[item.status] = (statusCounts[item.status] || 0) + 1;
  }
  return {
    total: allItems.length,
    type: typeCounts,
    status: statusCounts,
    processing: (statusCounts.pending || 0) + (statusCounts.running || 0),
  };
}

async function enrichItems(env: Record<string, string>, state: Awaited<ReturnType<typeof loadState>>) {
  return Promise.all(
    state.activity.map(async (item) => {
      if (!item.media_id) {
        return item;
      }
      const media = state.media[item.media_id];
      if (!media) {
        return item;
      }
      const runMeta = item.status === "running" ? await loadRunMeta(env, media.path) : null;
      return {
        ...item,
        media_title: media.title,
        media_path: media.path,
        progress: typeof runMeta?.progress === "number" ? runMeta.progress : null,
        stage: typeof runMeta?.stage === "string" ? runMeta.stage : "",
      };
    })
  );
}

export async function GET(request: Request) {
  const env = await loadEnv(resolvePath(".env"));
  const auth = getAuthFromRequest(request, env);
  if (!auth.ok) {
    return new Response("unauthorized", { status: 401 });
  }
  const redisUrl = env.REDIS_URL || process.env.REDIS_URL || "";
  const redisChannel = env.REDIS_CHANNEL || process.env.REDIS_CHANNEL || "autosub:activity";
  if (!redisUrl) {
    return new Response("redis not configured", { status: 400 });
  }
  const url = new URL(request.url);
  const type = url.searchParams.get("type") || "";
  const status = url.searchParams.get("status") || "";
  const page = Number(url.searchParams.get("page") || "1");
  const pageSize = Number(url.searchParams.get("page_size") || "50");
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let active = true;
      const client = createClient({ url: redisUrl });
      const sub = client.duplicate();
      await client.connect();
      await sub.connect();
      const push = async () => {
        if (!active) return;
        const state = await loadState();
        const counts = buildCounts(state);
        const data = listActivity(state, { type, status, page, pageSize });
        const items = await enrichItems(env, {
          ...state,
          activity: data.items,
        });
        const payload = JSON.stringify({
          ok: true,
          items,
          counts,
          total: data.total,
          page: data.page,
          page_size: data.page_size,
        });
        controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
      };
      await push();
      await sub.subscribe(redisChannel, async () => {
        await push();
      });
      return async () => {
        active = false;
        try {
          await sub.unsubscribe(redisChannel);
        } catch {
          // ignore
        }
        await sub.quit();
        await client.quit();
      };
    },
    cancel() {
      // no-op
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
