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


test("login proxies email credentials to Supabase and maps tokens", async () => {
  const originalFetch = globalThis.fetch;
  let url = "";
  let posted = {};
  globalThis.fetch = async (input, init = {}) => {
    url = String(input);
    posted = JSON.parse(init.body || "{}");
    return new Response(JSON.stringify({ access_token: "access", refresh_token: "refresh" }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const res = await worker.fetch(new Request("https://worker.test/api/v1/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: "person@example.com", password: "secret" }),
    }), env);
    assert.equal(res.status, 200);
    assert.match(url, /\/auth\/v1\/token\?grant_type=password$/);
    assert.deepEqual(posted, { email: "person@example.com", password: "secret" });
    assert.deepEqual(await res.json(), { accessToken: "access", refreshToken: "refresh" });
  } finally { globalThis.fetch = originalFetch; }
});

test("refresh proxies token to Supabase and maps rotated tokens", async () => {
  const originalFetch = globalThis.fetch;
  let posted = {};
  globalThis.fetch = async (_input, init = {}) => {
    posted = JSON.parse(init.body || "{}");
    return new Response(JSON.stringify({ access_token: "new-access", refresh_token: "new-refresh" }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const res = await worker.fetch(new Request("https://worker.test/api/v1/auth/refresh", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: "old-refresh" }),
    }), env);
    assert.equal(res.status, 200);
    assert.deepEqual(posted, { refresh_token: "old-refresh" });
    assert.deepEqual(await res.json(), { accessToken: "new-access", refreshToken: "new-refresh" });
  } finally { globalThis.fetch = originalFetch; }
});


test("auth/me rejects missing bearer token", async () => {
  const res = await worker.fetch(new Request("https://worker.test/api/v1/auth/me"), env);
  assert.equal(res.status, 401);
});

test("auth/me validates bearer with Supabase and returns safe user profile", async () => {
  const originalFetch = globalThis.fetch;
  let calledUrl = "";
  let authHeader = "";
  globalThis.fetch = async (input, init = {}) => {
    calledUrl = String(input);
    authHeader = new Headers(init.headers).get("Authorization") || "";
    return new Response(JSON.stringify({ id: "user-123", email: "test@example.org", phone: null, user_metadata: { display_name: "Tester" }, app_metadata: { provider: "email" } }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const res = await worker.fetch(new Request("https://worker.test/api/v1/auth/me", { headers: { Authorization: "Bearer sample-access" } }), env);
    assert.equal(res.status, 200);
    assert.match(calledUrl, /\/auth\/v1\/user$/);
    assert.equal(authHeader, "Bearer sample-access");
    assert.deepEqual(await res.json(), { id: "user-123", email: "test@example.org", phone: null, role: null });
  } finally { globalThis.fetch = originalFetch; }
});

test("auth/me maps invalid upstream token to 401", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ message: "invalid token" }), { status: 401 });
  try {
    const res = await worker.fetch(new Request("https://worker.test/api/v1/auth/me", { headers: { Authorization: "Bearer expired" } }), env);
    assert.equal(res.status, 401);
  } finally { globalThis.fetch = originalFetch; }
});


test("login rejects malformed JSON with 400 instead of gateway error", async () => {
  const res = await worker.fetch(new Request("https://worker.test/api/v1/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{invalid",
  }), env);
  assert.equal(res.status, 400);
});

test("refresh rejects malformed JSON with 400 instead of gateway error", async () => {
  const res = await worker.fetch(new Request("https://worker.test/api/v1/auth/refresh", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{invalid",
  }), env);
  assert.equal(res.status, 400);
});

test("auth/me reports configuration missing without upstream call", async () => {
  const res = await worker.fetch(new Request("https://worker.test/api/v1/auth/me", { headers: { Authorization: "Bearer token" } }), {});
  assert.equal(res.status, 503);
});

test("phone login uses phone field in Supabase request", async () => {
  const originalFetch = globalThis.fetch;
  let posted = {};
  globalThis.fetch = async (_input, init = {}) => {
    posted = JSON.parse(init.body || "{}");
    return new Response(JSON.stringify({ access_token: "a", refresh_token: "r" }), { status: 200 });
  };
  try {
    const res = await worker.fetch(new Request("https://worker.test/api/v1/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier: "+962790000000", password: "pw" }),
    }), env);
    assert.equal(res.status, 200);
    assert.deepEqual(posted, { phone: "+962790000000", password: "pw" });
  } finally { globalThis.fetch = originalFetch; }
});
