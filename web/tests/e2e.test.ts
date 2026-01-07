import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";

const PORT = 3100;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const CWD = path.resolve(__dirname, "..");

let proc: ReturnType<typeof spawn> | null = null;

async function waitForServer(url: string, timeoutMs = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        return;
      }
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Server not ready");
}

before(async () => {
  const nextBin = path.join(CWD, "node_modules", ".bin", "next");
  proc = spawn(nextBin, ["dev", "-p", String(PORT)], {
    cwd: CWD,
    env: {
      ...process.env,
      WEB_AUTH_ENABLED: "false",
      WATCH_DIRS: "",
      WEB_MEDIA_DIRS: "",
    },
    stdio: "ignore",
  });
  await waitForServer(`${BASE_URL}/api/v3/summary`);
});

after(() => {
  if (proc) {
    proc.kill("SIGTERM");
    proc = null;
  }
});

test("summary api responds", async () => {
  const res = await fetch(`${BASE_URL}/api/v3/summary`);
  const data = await res.json();
  assert.equal(data.ok, true);
});
