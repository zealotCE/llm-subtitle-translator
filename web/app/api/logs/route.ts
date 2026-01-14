import fs from "fs/promises";
import { getAuthFromRequest } from "@/lib/server/auth";
import { loadEnv, resolvePath } from "@/lib/server/env";
import { parseLogLine } from "@/lib/logs";

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
  const logDir = env.LOG_DIR || "/output/logs";
  const logName = env.LOG_FILE_NAME || "worker.log";
  if (!logDir) {
    return Response.json({ ok: true, logs: [] });
  }
  const logPath = resolvePath(`${logDir}/${logName}`);
  try {
    const content = await fs.readFile(logPath, "utf-8");
    const entries = content
      .split(/\r?\n/)
      .filter((line) => line)
      .map((line) => parseLogLine(line))
      .filter((entry) =>
        keyword ? entry.raw.includes(keyword) || entry.message.includes(keyword) : true
      );
    const sliced = limit > 0 ? entries.slice(-limit) : entries;
    return Response.json({ ok: true, logs: sliced });
  } catch {
    return Response.json({ ok: true, logs: [] });
  }
}
