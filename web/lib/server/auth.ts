import crypto from "crypto";

const DEFAULT_COOKIE = "autosub_auth";

type AuthResult = { ok: true; user: string; exp: number } | { ok: false; reason: string };

export function isAuthEnabled(env: Record<string, string>) {
  return (env.WEB_AUTH_ENABLED || "false") === "true";
}

export function getAuthCookie(env: Record<string, string>) {
  return env.WEB_AUTH_COOKIE || DEFAULT_COOKIE;
}

export function getAuthSecret(env: Record<string, string>) {
  return env.WEB_AUTH_SECRET || "change-me";
}

export function getAuthTtl(env: Record<string, string>) {
  const raw = Number(env.WEB_AUTH_TTL || "86400");
  return Number.isFinite(raw) && raw > 0 ? raw : 86400;
}

export function createToken(user: string, ttlSeconds: number, secret: string, nowSec?: number) {
  const issuedAt = nowSec ?? Math.floor(Date.now() / 1000);
  const exp = issuedAt + ttlSeconds;
  const payload = `${user}|${exp}`;
  const signature = sign(payload, secret);
  const token = `${base64UrlEncode(payload)}.${signature}`;
  return { token, exp };
}

export function verifyToken(token: string, secret: string, nowSec?: number): AuthResult {
  if (!token || !token.includes(".")) {
    return { ok: false, reason: "missing" };
  }
  const [payloadEncoded, signature] = token.split(".");
  if (!payloadEncoded || !signature) {
    return { ok: false, reason: "malformed" };
  }
  const payload = base64UrlDecode(payloadEncoded);
  if (!payload) {
    return { ok: false, reason: "malformed" };
  }
  const expected = sign(payload, secret);
  if (!timingSafeEqual(expected, signature)) {
    return { ok: false, reason: "signature" };
  }
  const [user, expRaw] = payload.split("|");
  const exp = Number(expRaw);
  if (!user || !Number.isFinite(exp)) {
    return { ok: false, reason: "payload" };
  }
  const now = nowSec ?? Math.floor(Date.now() / 1000);
  if (exp < now) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, user, exp };
}

export function readCookie(header: string | null, name: string) {
  if (!header) return "";
  const parts = header.split(";");
  for (const part of parts) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) {
      return rest.join("=");
    }
  }
  return "";
}

export function getAuthFromRequest(request: Request, env: Record<string, string>) {
  if (!isAuthEnabled(env)) {
    return { ok: true, user: "public" };
  }
  const token = readCookie(request.headers.get("cookie"), getAuthCookie(env));
  return verifyToken(token, getAuthSecret(env));
}

export function buildAuthCookie(env: Record<string, string>, token: string, maxAge: number) {
  const name = getAuthCookie(env);
  return `${name}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;
}

export function buildLogoutCookie(env: Record<string, string>) {
  const name = getAuthCookie(env);
  return `${name}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

function sign(payload: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function timingSafeEqual(a: string, b: string) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function base64UrlEncode(value: string) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value: string) {
  try {
    return Buffer.from(value, "base64url").toString("utf-8");
  } catch {
    return "";
  }
}
