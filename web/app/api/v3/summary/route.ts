import { getAuthFromRequest } from "@/lib/server/auth";
import { loadEnv, resolvePath } from "@/lib/server/env";
import { buildSummary, scanAndSync } from "@/lib/server/v3/store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const env = await loadEnv(resolvePath(".env"));
  const auth = getAuthFromRequest(request, env);
  if (!auth.ok) {
    return Response.json({ ok: false, message: "未登录" }, { status: 401 });
  }
  const state = await scanAndSync(env);
  const summary = buildSummary(state);
  return Response.json({ ok: true, ...summary });
}
