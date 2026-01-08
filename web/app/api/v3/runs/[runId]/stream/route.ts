import { getAuthFromRequest } from "@/lib/server/auth";
import { loadEnv, resolvePath } from "@/lib/server/env";
import { loadRunMeta } from "@/lib/server/media";
import { loadState } from "@/lib/server/v3/store";
import { createClient } from "redis";

export const runtime = "nodejs";

async function buildRunPayload(env: Record<string, string>, runId: string) {
  const state = await loadState();
  const run = state.runs[runId];
  if (!run) return null;
  const media = state.media[run.media_id];
  const runMeta = media ? await loadRunMeta(env, media.path) : null;
  return {
    ok: true,
    run_id: run.id,
    status: typeof runMeta?.status === "string" ? runMeta.status : run.status,
    stage: typeof runMeta?.stage === "string" ? runMeta.stage : run.stage,
    progress: typeof runMeta?.progress === "number" ? runMeta.progress : null,
    asr_model: typeof runMeta?.asr_model === "string" ? runMeta.asr_model : undefined,
    llm_model: typeof runMeta?.llm_model === "string" ? runMeta.llm_model : undefined,
    ts: Math.floor(Date.now() / 1000),
  };
}

export async function GET(request: Request, context: { params: { runId: string } }) {
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
  const runId = context.params.runId;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let active = true;
      const client = createClient({ url: redisUrl });
      const sub = client.duplicate();
      await client.connect();
      await sub.connect();
      const push = async (payload: Record<string, unknown> | null) => {
        if (!active || !payload) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };
      await push(await buildRunPayload(env, runId));
      await sub.subscribe(redisChannel, async (message) => {
        let parsed: Record<string, unknown> | null = null;
        try {
          parsed = JSON.parse(message) as Record<string, unknown>;
        } catch {
          parsed = null;
        }
        if (!parsed) {
          await push(await buildRunPayload(env, runId));
          return;
        }
        const event = parsed.event;
        const msgRunId = typeof parsed.run_id === "string" ? parsed.run_id : "";
        if (event === "run_meta" || event === "run_progress") {
          if (msgRunId && msgRunId == runId) {
            await push({
              ok: true,
              run_id: msgRunId,
              status: typeof parsed.status === "string" ? parsed.status : undefined,
              stage: typeof parsed.stage === "string" ? parsed.stage : undefined,
              progress: typeof parsed.progress === "number" ? parsed.progress : null,
              ts: typeof parsed.ts === "number" ? parsed.ts : Math.floor(Date.now() / 1000),
            });
            return;
          }
        }
        await push(await buildRunPayload(env, runId));
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
