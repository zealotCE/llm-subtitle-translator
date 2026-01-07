import fs from "fs/promises";
import { getAuthFromRequest } from "@/lib/server/auth";
import { loadEnv, resolvePath } from "@/lib/server/env";

const CONFIG_PATH = process.env.WEB_CONFIG_PATH || ".env";

export async function GET(request: Request) {
  const env = await loadEnv(resolvePath(CONFIG_PATH));
  const auth = getAuthFromRequest(request, env);
  if (!auth.ok) {
    return Response.json({ ok: false, message: "未登录" }, { status: 401 });
  }
  const url = new URL(request.url);
  const keyword = url.searchParams.get("q") || "";
  const rawLimit = Number(url.searchParams.get("limit") || 200);
  const limit = Number.isFinite(rawLimit) ? Math.min(rawLimit, 5000) : 200;
  const logDir = env.LOG_DIR || "";
  const logName = env.LOG_FILE_NAME || "worker.log";
  if (!logDir) {
    return Response.json({ logs: [] });
  }
  const logPath = resolvePath(`${logDir}/${logName}`);
  try {
    const content = await fs.readFile(logPath, "utf-8");
    const lines = content
      .split(/\r?\n/)
      .filter((line) => line && (keyword ? line.includes(keyword) : true));
    const sliced = limit > 0 ? lines.slice(-limit) : lines;
    return Response.json({ logs: sliced });
  } catch {
    return Response.json({ logs: [] });
  }
}
