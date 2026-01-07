import fs from "fs/promises";
import path from "path";

export async function triggerScan(env: Record<string, string>) {
  const watchDirs = (env.WATCH_DIRS || "")
    .split(",")
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
  const triggerName = env.TRIGGER_SCAN_FILE || ".scan_now";
  if (!watchDirs.length) {
    return { ok: false, warning: "未配置 WATCH_DIRS" };
  }
  if (!triggerName) {
    return { ok: false, warning: "未配置 TRIGGER_SCAN_FILE" };
  }
  const errors: string[] = [];
  for (const dir of watchDirs) {
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, triggerName), "scan", "utf-8");
    } catch (err) {
      errors.push(`${dir}: ${(err as Error).message}`);
    }
  }
  if (errors.length) {
    return { ok: false, warning: errors.join("; ") };
  }
  return { ok: true };
}
