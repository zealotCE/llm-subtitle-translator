import { buildLogoutCookie } from "@/lib/server/auth";
import { loadEnv, resolvePath } from "@/lib/server/env";

const CONFIG_PATH = process.env.WEB_CONFIG_PATH || ".env";

export async function POST() {
  const env = await loadEnv(resolvePath(CONFIG_PATH));
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Set-Cookie": buildLogoutCookie(env) },
  });
}
