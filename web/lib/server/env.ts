import fs from "fs/promises";
import fsSync from "fs";
import path from "path";

const SENSITIVE_KEYS = [
  "DASHSCOPE_API_KEY",
  "OSS_ACCESS_KEY_ID",
  "OSS_ACCESS_KEY_SECRET",
  "LLM_API_KEY",
  "TMDB_API_KEY",
  "TMDB_READ_TOKEN",
  "BANGUMI_ACCESS_TOKEN",
];
const SENSITIVE_PARTS = ["KEY", "SECRET", "TOKEN", "PASSWORD"];

export function isSensitiveKey(key: string) {
  if (SENSITIVE_KEYS.includes(key)) {
    return true;
  }
  const upper = key.toUpperCase();
  return SENSITIVE_PARTS.some((part) => upper.includes(part));
}

export async function loadEnv(filePath: string) {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const lines = content.split(/\r?\n/);
    const env: Record<string, string> = {};
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
        continue;
      }
      const [key, ...rest] = trimmed.split("=");
      let value = rest.join("=").trim();
      if (value.length >= 2 && value[0] === value[value.length - 1] && ["'", '"'].includes(value[0])) {
        value = value.slice(1, -1);
      }
      env[key.trim()] = value;
    }
    return env;
  } catch {
    return {};
  }
}

type EnvEntry = { type: "raw"; raw: string } | { type: "kv"; key: string };

export async function saveEnv(filePath: string, updates: Record<string, string>) {
  let raw = "";
  try {
    raw = await fs.readFile(filePath, "utf-8");
  } catch {
    raw = "";
  }
  const lines = raw.split(/\r?\n/);
  const entries: EnvEntry[] = [];
  const env = await loadEnv(filePath);
  const merged = { ...env, ...updates };
  const seen = new Set<string>();
  for (const line of lines) {
    if (!line.trim() || line.trimStart().startsWith("#") || !line.includes("=")) {
      entries.push({ type: "raw", raw: line });
      continue;
    }
    const [key] = line.split("=");
    const trimmedKey = key.trim();
    if (!trimmedKey) {
      entries.push({ type: "raw", raw: line });
      continue;
    }
    seen.add(trimmedKey);
    entries.push({ type: "kv", key: trimmedKey });
  }
  const output = entries.map((entry) => {
    if (entry.type === "raw") {
      return entry.raw;
    }
    const value = merged[entry.key] ?? "";
    return `${entry.key}=${formatEnvValue(value)}`;
  });
  for (const [key, value] of Object.entries(merged)) {
    if (seen.has(key)) {
      continue;
    }
    output.push(`${key}=${formatEnvValue(value)}`);
  }
  await fs.mkdir(path.dirname(filePath) || ".", { recursive: true });
  await fs.writeFile(filePath, output.join("\n").replace(/\n+$/g, "") + "\n", "utf-8");
}

function formatEnvValue(value: string) {
  if (value === "") {
    return '""';
  }
  if (/[\s#]/.test(value)) {
    return `"${value.replace(/\\/g, "\\\\").replace(/\"/g, "\\\"")}"`;
  }
  return value;
}

export function resolvePath(p: string) {
  if (path.isAbsolute(p)) {
    return p;
  }
  const roots = [
    process.env.WEB_PROJECT_ROOT,
    process.cwd(),
    path.join(process.cwd(), ".."),
  ].filter(Boolean) as string[];
  for (const root of roots) {
    const candidate = path.join(root, p);
    if (fsSync.existsSync(candidate)) {
      return candidate;
    }
  }
  return path.join(roots[0] || process.cwd(), p);
}
