import { getAuthFromRequest } from "@/lib/server/auth";
import { loadEnv, resolvePath } from "@/lib/server/env";
import { listMedia, scanAndSync } from "@/lib/server/v3/store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const env = await loadEnv(resolvePath(".env"));
  const auth = getAuthFromRequest(request, env);
  if (!auth.ok) {
    return Response.json({ ok: false, message: "未登录" }, { status: 401 });
  }
  const url = new URL(request.url);
  const query = url.searchParams.get("query") || "";
  const filterRaw = url.searchParams.get("filter") || "";
  const sort = url.searchParams.get("sort") || "";
  const page = Number(url.searchParams.get("page") || "1");
  const pageSize = Number(url.searchParams.get("page_size") || "50");
  const filters = filterRaw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const state = await scanAndSync(env);
  const data = listMedia(state, { query, filters, sort, page, pageSize });
  return Response.json({ ok: true, ...data });
}
