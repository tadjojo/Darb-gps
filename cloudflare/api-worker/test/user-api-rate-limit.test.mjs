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
