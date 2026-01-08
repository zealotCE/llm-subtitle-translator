import fs from "fs/promises";
import path from "path";

type LogLevel = "INFO" | "WARN" | "ERROR";

export async function logEvent(
  env: Record<string, string>,
  level: LogLevel,
  message: string,
  data?: Record<string, unknown>
) {
  const logDir = env.LOG_DIR || "/output/logs";
  const logName = env.LOG_FILE_NAME || "worker.log";
  if (!logDir) return;
  const record = {
    ts: new Date().toISOString(),
    level,
    message,
    source: "web",
    ...(data || {}),
  };
  try {
    await fs.mkdir(logDir, { recursive: true });
    const line = JSON.stringify(record);
    await fs.appendFile(path.join(logDir, logName), line + "\n", "utf-8");
  } catch {
    // ignore
  }
}
