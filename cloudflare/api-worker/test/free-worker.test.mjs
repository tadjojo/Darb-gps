import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.mjs";

const env = {
  ALLOWED_ORIGINS: "https://darb-gps-web-2026.tadjojo.workers.dev",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
};

test("liveness reports runtime is up", async () => {
  const res = await worker.fetch(new Request("https://worker.test/api/v1/health/live"), env);
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.status, "ok");
  assert.equal(payload.runtime, "cloudflare-worker");
});

test("readiness reports missing config as not ready", async () => {
  const res = await worker.fetch(new Request("https://worker.test/api/v1/health/ready"), {});
  assert.equal(res.status, 503);
  assert.equal((await res.json()).status, "not_ready");
});

test("readiness only confirms configured settings, not database connectivity", async () => {
  const res = await worker.fetch(new Request("https://worker.test/api/v1/health/ready"), env);
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.status, "ready");
  assert.equal(payload.supabaseConfigured, true);
  assert.match(payload.note, /no database connectivity test/);
});

test("CORS denies unapproved origins", async () => {
  const res = await worker.fetch(new Request("https://worker.test/api/v1/health/live", {
    headers: { Origin: "https://malicious.example" },
  }), env);
  assert.equal(res.status, 403);
});

test("CORS preflight for approved origin", async () => {
  const res = await worker.fetch(new Request("https://worker.test/api/v1/auth/login", {
    method: "OPTIONS",
    headers: { Origin: "https://darb-gps-web-2026.tadjojo.workers.dev" },
  }), env);
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "https://darb-gps-web-2026.tadjojo.workers.dev");
});

test("unmigrated API routes are explicit and not falsely successful", async () => {
  const res = await worker.fetch(new Request("https://worker.test/api/v1/organizations"), env);
  assert.equal(res.status, 501);
  const payload = await res.json();
  assert.equal(payload.status, "not_implemented");
});

test("login validates required fields before contacting Supabase", async () => {
  const res = await worker.fetch(new Request("https://worker.test/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: "", password: "" }),
  }), env);
  assert.equal(res.status, 400);
});


test("logout requests Supabase local-session sign-out and forwards bearer", async () => {
  const originalFetch = globalThis.fetch;
  let calledUrl = "";
  let calledAuthorization = "";
  globalThis.fetch = async (input, init = {}) => {
    calledUrl = String(input);
    calledAuthorization = new Headers(init.headers).get("Authorization") || "";
    return new Response(null, { status: 204 });
  };
  try {
    const res = await worker.fetch(new Request("https://worker.test/api/v1/auth/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer user-access-token" },
      body: JSON.stringify({ refreshToken: "refresh-token" }),
    }), env);
    assert.equal(res.status, 204);
    assert.equal(new URL(calledUrl).searchParams.get("scope"), "local");
    assert.equal(calledAuthorization, "Bearer user-access-token");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
