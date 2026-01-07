import fs from "fs/promises";
import path from "path";
import { getAuthFromRequest } from "@/lib/server/auth";
import { loadEnv, resolvePath } from "@/lib/server/env";

export const runtime = "nodejs";

type VersionEntry = {
  name: string;
  created_at: number;
  values: Record<string, string>;
};

type VersionStore = {
  versions: VersionEntry[];
};

export async function GET(request: Request) {
  const env = await loadEnv(resolvePath(".env"));
  const auth = getAuthFromRequest(request, env);
  if (!auth.ok) {
    return Response.json({ ok: false, message: "未登录" }, { status: 401 });
  }
  const store = await loadStore(env);
  const versions = store.versions
    .slice()
    .sort((a, b) => b.created_at - a.created_at)
    .map((item) => ({ name: item.name, created_at: item.created_at }));
  return Response.json({ ok: true, versions });
}

export async function POST(request: Request) {
  const env = await loadEnv(resolvePath(".env"));
  const auth = getAuthFromRequest(request, env);
  if (!auth.ok) {
    return Response.json({ ok: false, message: "未登录" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const action = String(body?.action || "save");
  const store = await loadStore(env);
  if (action === "save") {
    const name = String(body?.name || "").trim();
    const values = body?.values || {};
    if (!name) {
      return Response.json({ ok: false, message: "缺少版本名称" }, { status: 400 });
    }
    const next: VersionEntry = { name, created_at: Math.floor(Date.now() / 1000), values };
    const filtered = store.versions.filter((item) => item.name !== name);
    filtered.unshift(next);
    store.versions = filtered.slice(0, 20);
    await saveStore(env, store);
    return Response.json({ ok: true });
  }
  if (action === "load") {
    const name = String(body?.name || "").trim();
    const entry = store.versions.find((item) => item.name === name);
    if (!entry) {
      return Response.json({ ok: false, message: "未找到版本" }, { status: 404 });
    }
    return Response.json({ ok: true, values: entry.values });
  }
  if (action === "delete") {
    const name = String(body?.name || "").trim();
    store.versions = store.versions.filter((item) => item.name !== name);
    await saveStore(env, store);
    return Response.json({ ok: true });
  }
  return Response.json({ ok: false, message: "不支持的操作" }, { status: 400 });
}

async function loadStore(env: Record<string, string>): Promise<VersionStore> {
  const filePath = resolvePath(env.WEB_CONFIG_VERSIONS_PATH || ".web/config_versions.json");
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const data = JSON.parse(raw) as VersionStore;
    if (data && Array.isArray(data.versions)) {
      return data;
    }
  } catch {
    // ignore
  }
  return { versions: [] };
}

async function saveStore(env: Record<string, string>, store: VersionStore) {
  const filePath = resolvePath(env.WEB_CONFIG_VERSIONS_PATH || ".web/config_versions.json");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(store, null, 2), "utf-8");
}
