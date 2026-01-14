import test from "node:test";
import assert from "node:assert/strict";
import { detectLogSource } from "../lib/logs";

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
