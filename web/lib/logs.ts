export type LogSource = "web" | "worker" | "unknown";
export type LogLevel = "debug" | "info" | "warn" | "error" | "unknown";

export type LogEntry = {
  raw: string;
  source: LogSource;
  message: string;
  level: LogLevel;
  ts?: string;
};

const SOURCE_HINTS = [
  { source: "worker", tokens: ["worker", "watcher"] },
  { source: "web", tokens: ["web", "next", "frontend"] },
] as const;

const LEVEL_MAP: Record<string, LogLevel> = {
  debug: "debug",
  info: "info",
  warn: "warn",
  warning: "warn",
  error: "error",
};

export function detectLogSource(text: string): LogSource {
  const lower = text.toLowerCase();
  for (const hint of SOURCE_HINTS) {
    if (hint.tokens.some((token) => lower.includes(token))) {
      return hint.source;
    }
  }
  return "unknown";
}

export function parseLogLine(line: string): LogEntry {
  let message = line;
  let level: LogLevel = "unknown";
  let ts: string | undefined;
  let source: LogSource = "unknown";

  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    const rawMessage = parsed.message ?? parsed.msg ?? parsed.text ?? parsed.event;
    if (typeof rawMessage === "string" && rawMessage.trim()) {
      message = rawMessage;
    }
    const rawLevel = parsed.level ?? parsed.severity ?? parsed.lvl;
    if (typeof rawLevel === "string") {
      level = LEVEL_MAP[rawLevel.toLowerCase()] ?? "unknown";
    }
    const rawTs = parsed.ts ?? parsed.timestamp ?? parsed.time;
    if (typeof rawTs === "string") {
      ts = rawTs;
    }
    const rawSource = parsed.source ?? parsed.service ?? parsed.app;
    if (typeof rawSource === "string" && rawSource.trim()) {
      source = detectLogSource(rawSource);
    } else {
      source = detectLogSource(`${message} ${line}`);
    }
  } catch {
    source = detectLogSource(line);
  }

  return {
    raw: line,
    source,
    message,
    level,
    ts,
  };
}
