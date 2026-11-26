import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.mjs";

function deniedLimiter() {
  const calls = [];
  return {
    calls,
    binding: {
      async limit(args) {
        calls.push(args);
        return { success: false };
      },
    },
  };
}

test("rate-limited login returns 429 and Retry-After without auth upstream", async () => {
  const limiter = deniedLimiter();
  const env = {
    ALLOWED_ORIGINS: "https://app.example",
    AUTH_RATE_LIMIT: limiter.binding,
    SUPABASE_URL: "https://supabase.example",
    SUPABASE_PUBLISHABLE_KEY: "public-key",
  };
  const response = await worker.fetch(new Request("https://worker.test/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.9" },
    body: JSON.stringify({ identifier: "user@example.com", password: "secret" }),
  }), env);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "60");
  assert.deepEqual(limiter.calls, [{ key: "login:203.0.113.9" }]);
});

test("tracker ingestion is limited using a hashed tracker credential before service RPC", async () => {
  const limiter = deniedLimiter();
  const env = {
    ALLOWED_ORIGINS: "https://app.example",
    TRACKER_RATE_LIMIT: limiter.binding,
    SUPABASE_URL: "https://supabase.example",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
  };
  const response = await worker.fetch(new Request("https://worker.test/api/v1/device-gateway/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer tracker-token" },
    body: JSON.stringify({ latitude: 31, longitude: 35, recordedAt: "2026-11-26T00:00:00Z" }),
  }), env);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "60");
  assert.equal(limiter.calls.length, 1);
  assert.match(limiter.calls[0].key, /^tracker:[a-f0-9]{64}$/);
});

test("rate limiter binding failure is fail-closed", async () => {
  const env = {
    ALLOWED_ORIGINS: "https://app.example",
    AUTH_RATE_LIMIT: { async limit() { throw new Error("binding unavailable"); } },
  };
  const response = await worker.fetch(new Request("https://worker.test/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: "x", password: "x" }),
  }), env);
  assert.equal(response.status, 429);
});
