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
  return Response.json({ ok: true, ...data });
}
