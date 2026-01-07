import { buildAuthCookie, createToken, getAuthSecret, getAuthTtl, isAuthEnabled } from "@/lib/server/auth";
import { loadEnv, resolvePath } from "@/lib/server/env";

const CONFIG_PATH = process.env.WEB_CONFIG_PATH || ".env";

export async function POST(request: Request) {
  const env = await loadEnv(resolvePath(CONFIG_PATH));
  if (!isAuthEnabled(env)) {
    return Response.json({ ok: true, user: "public" });
  }
  const body = await request.json().catch(() => ({}));
  const user = String(body?.user || "");
  const password = String(body?.password || "");
  const expectedUser = env.WEB_AUTH_USER || "admin";
  const expectedPassword = env.WEB_AUTH_PASSWORD || "";
  if (!user || !password || user !== expectedUser || password !== expectedPassword) {
    return Response.json({ ok: false, message: "用户名或密码错误" }, { status: 401 });
  }
  const ttl = getAuthTtl(env);
  const { token } = createToken(user, ttl, getAuthSecret(env));
  const cookie = buildAuthCookie(env, token, ttl);
  return new Response(JSON.stringify({ ok: true, user }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Set-Cookie": cookie },
  });
}
