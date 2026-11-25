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


test("organization create requires bearer and validates name", async () => {
  const noAuth = await worker.fetch(new Request("https://worker.test/api/v1/organizations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Fleet" }) }), env);
  assert.equal(noAuth.status, 401);
  const invalid = await worker.fetch(new Request("https://worker.test/api/v1/organizations", { method: "POST", headers: { Authorization: "Bearer token", "Content-Type": "application/json" }, body: JSON.stringify({ name: " " }) }), env);
  assert.equal(invalid.status, 400);
});

test("organization create calls scoped Supabase RPC and returns created object", async () => {
  const originalFetch = globalThis.fetch;
  let url = ""; let headers; let posted = {};
  globalThis.fetch = async (input, init = {}) => {
    url = String(input); headers = new Headers(init.headers); posted = JSON.parse(init.body || "{}");
    return new Response(JSON.stringify({ id: "org-id", name: "Fleet", status: "active", created_by: "user-id" }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const res = await worker.fetch(new Request("https://worker.test/api/v1/organizations", { method: "POST", headers: { Authorization: "Bearer jwt", "Content-Type": "application/json" }, body: JSON.stringify({ name: " Fleet " }) }), env);
    assert.equal(res.status, 201);
    assert.match(url, /\/rest\/v1\/rpc\/darb_api_create_organization$/);
    assert.equal(headers.get("Authorization"), "Bearer jwt");
    assert.equal(headers.get("apikey"), env.SUPABASE_PUBLISHABLE_KEY);
    assert.deepEqual(posted, { p_name: "Fleet" });
    assert.equal((await res.json()).id, "org-id");
  } finally { globalThis.fetch = originalFetch; }
});

test("vehicle create validates UUID and calls transactional RPC", async () => {
  const originalFetch = globalThis.fetch;
  let url = ""; let posted = {};
  globalThis.fetch = async (input, init = {}) => {
    url = String(input); posted = JSON.parse(init.body || "{}");
    return new Response(JSON.stringify({ id: "vehicle-id", display_name: "Truck", status: "active" }), { status: 200 });
  };
  try {
    const bad = await worker.fetch(new Request("https://worker.test/api/v1/organizations/not-a-uuid/vehicles", { method: "POST", headers: { Authorization: "Bearer jwt", "Content-Type": "application/json" }, body: JSON.stringify({ displayName: "Truck" }) }), env);
    assert.equal(bad.status, 400);
    const res = await worker.fetch(new Request("https://worker.test/api/v1/organizations/123e4567-e89b-12d3-a456-426614174000/vehicles", { method: "POST", headers: { Authorization: "Bearer jwt", "Content-Type": "application/json" }, body: JSON.stringify({ displayName: "Truck", registrationNumber: "ABC 123" }) }), env);
    assert.equal(res.status, 201);
    assert.match(url, /darb_api_create_vehicle$/);
    assert.deepEqual(posted, { p_organization_id: "123e4567-e89b-12d3-a456-426614174000", p_display_name: "Truck", p_registration_number: "ABC 123" });
  } finally { globalThis.fetch = originalFetch; }
});

test("vehicle list wraps RPC array for Flutter client compatibility", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, _init = {}) => new Response(JSON.stringify([{ id: "v1", display_name: "Van" }, { id: "v2", display_name: "Car" }]), { status: 200 });
  try {
    const res = await worker.fetch(new Request("https://worker.test/api/v1/organizations/123e4567-e89b-12d3-a456-426614174000/vehicles", { headers: { Authorization: "Bearer jwt" } }), env);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { data: [{ id: "v1", display_name: "Van" }, { id: "v2", display_name: "Car" }] });
  } finally { globalThis.fetch = originalFetch; }
});

test("vehicle RPC permission error maps to 403 without exposing upstream text", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ code: "42501", message: "details not for client" }), { status: 403 });
  try {
    const res = await worker.fetch(new Request("https://worker.test/api/v1/organizations/123e4567-e89b-12d3-a456-426614174000/vehicles", { method: "POST", headers: { Authorization: "Bearer jwt", "Content-Type": "application/json" }, body: JSON.stringify({ displayName: "Truck" }) }), env);
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { message: "Vehicle creation failed" });
  } finally { globalThis.fetch = originalFetch; }
});
