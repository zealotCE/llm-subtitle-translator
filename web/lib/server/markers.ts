import fs from "fs/promises";
import path from "path";
import { getOutputDir } from "@/lib/server/media";

export async function clearMediaMarkers(env: Record<string, string>, mediaPath: string) {
  const base = path.basename(mediaPath, path.extname(mediaPath));
  const suffixRaw = (env.OUTPUT_LANG_SUFFIX || "").trim();
  const suffix = suffixRaw ? (suffixRaw.startsWith(".") ? suffixRaw : `.${suffixRaw}`) : "";
  const marker = `${base}${suffix}`;
  const candidateDirs = new Set<string>();
  const outDir = getOutputDir(env, mediaPath);
  if (outDir) candidateDirs.add(outDir);
  if (env.OUT_DIR) candidateDirs.add(env.OUT_DIR);
  for (const dir of candidateDirs) {
    const donePath = path.join(dir, `${marker}.done`);
    const lockPath = path.join(dir, `${marker}.lock`);
    try {
      await fs.unlink(donePath);
    } catch {
      // ignore
    }
    try {
      await fs.unlink(lockPath);
    } catch {
      // ignore
    }
    try {
      const entries = await fs.readdir(dir);
      for (const name of entries) {
        if (!name.startsWith(`${base}.translate_failed`)) continue;
        try {
          await fs.unlink(path.join(dir, name));
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
  }
}
