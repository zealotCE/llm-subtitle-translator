import { getAuthFromRequest } from "@/lib/server/auth";
import { loadEnv, resolvePath } from "@/lib/server/env";
import { loadState } from "@/lib/server/v3/store";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: { runId: string } }) {
  const env = await loadEnv(resolvePath(".env"));
  const auth = getAuthFromRequest(request, env);
  if (!auth.ok) {
    return Response.json({ ok: false, message: "未登录" }, { status: 401 });
  }
  const state = await loadState();
  const run = state.runs[context.params.runId];
  if (!run) {
    return Response.json({ ok: false, message: "未找到运行记录" }, { status: 404 });
  }
  return Response.json({ ok: true, run });
}
