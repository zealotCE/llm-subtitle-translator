import test from "node:test";
import assert from "node:assert/strict";
import { createToken, verifyToken } from "../lib/server/auth";

test("auth token verifies before expiry", () => {
  const secret = "unit-test";
  const { token } = createToken("admin", 60, secret, 1_700_000_000);
  const result = verifyToken(token, secret, 1_700_000_010);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.user, "admin");
  }
});

test("auth token rejects expired tokens", () => {
  const secret = "unit-test";
  const { token } = createToken("admin", 10, secret, 1_700_000_000);
  const result = verifyToken(token, secret, 1_700_000_020);
  assert.equal(result.ok, false);
});

test("auth token rejects bad signature", () => {
  const secret = "unit-test";
  const { token } = createToken("admin", 60, secret, 1_700_000_000);
  const result = verifyToken(token + "bad", secret, 1_700_000_010);
  assert.equal(result.ok, false);
});
