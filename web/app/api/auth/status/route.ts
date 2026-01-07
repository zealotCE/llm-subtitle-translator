import { getAuthFromRequest, isAuthEnabled } from "@/lib/server/auth";
import { loadEnv, resolvePath } from "@/lib/server/env";

const CONFIG_PATH = process.env.WEB_CONFIG_PATH || ".env";

export async function GET(request: Request) {
  const env = await loadEnv(resolvePath(CONFIG_PATH));
  if (!isAuthEnabled(env)) {
    return Response.json({ enabled: false, ok: true, user: "public" });
  }
  const auth = getAuthFromRequest(request, env);
  if (!auth.ok) {
    return Response.json({ enabled: true, ok: false, user: "" }, { status: 401 });
  }
  return Response.json({ enabled: true, ok: true, user: auth.user });
}
