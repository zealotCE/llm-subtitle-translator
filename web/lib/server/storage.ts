import fs from "fs/promises";
import path from "path";
import { resolvePath } from "@/lib/server/env";

const STATE_DIR = process.env.WEB_STATE_DIR || ".web";
const MEDIA_STATE = "media.json";

export async function loadMediaState() {
  try {
    const filePath = path.join(resolvePath(STATE_DIR), MEDIA_STATE);
    const data = await fs.readFile(filePath, "utf-8");
    return JSON.parse(data) as Record<string, { archived?: boolean; label?: string }>;
  } catch {
    return {};
  }
}

export async function saveMediaState(state: Record<string, { archived?: boolean; label?: string }>) {
  const dir = resolvePath(STATE_DIR);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, MEDIA_STATE);
  await fs.writeFile(filePath, JSON.stringify(state, null, 2), "utf-8");
}
