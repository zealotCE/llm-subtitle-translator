import test from "node:test";
import assert from "node:assert/strict";
import { detectLogSource, parseLogLine } from "../lib/logs";

test("detectLogSource identifies worker logs", () => {
  assert.equal(detectLogSource("worker: started job"), "worker");
  assert.equal(detectLogSource("Watcher found media"), "worker");
});

test("detectLogSource identifies web logs", () => {
  assert.equal(detectLogSource("web server ready"), "web");
  assert.equal(detectLogSource("Next.js compiled"), "web");
  assert.equal(detectLogSource("frontend action"), "web");
});

test("detectLogSource returns unknown for other logs", () => {
  assert.equal(detectLogSource("database connected"), "unknown");
});

test("parseLogLine extracts fields from json logs", () => {
  const line = JSON.stringify({
    ts: "2024-01-01T00:00:00Z",
    level: "info",
    message: "worker started",
    source: "watcher",
  });
  const parsed = parseLogLine(line);
  assert.equal(parsed.level, "info");
  assert.equal(parsed.message, "worker started");
  assert.equal(parsed.source, "worker");
  assert.equal(parsed.ts, "2024-01-01T00:00:00Z");
});

test("parseLogLine falls back to raw line", () => {
  const parsed = parseLogLine("plain log line");
  assert.equal(parsed.message, "plain log line");
  assert.equal(parsed.raw, "plain log line");
});
