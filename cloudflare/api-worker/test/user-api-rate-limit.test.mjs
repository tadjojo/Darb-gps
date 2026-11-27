import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.mjs";

test("authenticated API rate limiter uses bearer-token hash and blocks before RPC", async () => {
  const calls = [];
  const env = {
    ALLOWED_ORIGINS: "https://app.example",
    USER_API_RATE_LIMIT: { async limit(args) { calls.push(args); return { success: false }; } },
  };
  const response = await worker.fetch(new Request("https://worker.test/api/v1/organizations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer test-user-access-token" },
    body: JSON.stringify({ name: "Demo" }),
  }), env);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "60");
  assert.equal(calls.length, 1);
  assert.match(calls[0].key, /^user:[a-f0-9]{64}$/);
});

test("authenticated API request passes when its token limiter allows", async () => {
  const calls = [];
  const env = {
    ALLOWED_ORIGINS: "https://app.example",
    USER_API_RATE_LIMIT: { async limit(args) { calls.push(args); return { success: true }; } },
    SUPABASE_URL: "https://supabase.example",
    SUPABASE_PUBLISHABLE_KEY: "public-key",
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ id: "org-1", name: "Test" }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
  try {
    const response = await worker.fetch(new Request("https://worker.test/api/v1/organizations", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer allowed-token" },
      body: JSON.stringify({ name: "Test" }),
    }), env);
    assert.equal(response.status, 201);
    assert.deepEqual(calls, [{ key: calls[0].key }]);
    assert.match(calls[0].key, /^user:[a-f0-9]{64}$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
