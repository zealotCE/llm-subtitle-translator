export type LogSource = "web" | "worker" | "unknown";

export function detectLogSource(line: string): LogSource {
  const lower = line.toLowerCase();
  if (lower.includes("worker") || lower.includes("watcher")) return "worker";
  if (lower.includes("web") || lower.includes("next") || lower.includes("frontend")) return "web";
  return "unknown";
}
