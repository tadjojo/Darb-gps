import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.mjs";

const env = {
  ALLOWED_ORIGINS: "https://darb-gps-web-2026.tadjojo.workers.dev",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
};

test("health endpoint responds with Worker runtime status", async () => {
  const res = await worker.fetch(new Request("https://worker.test/api/v1/health/live"), env);
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.runtime, "cloudflare-worker");
  assert.equal(payload.freePlanCompatible, true);
});

test("CORS denies unapproved origins", async () => {
  const res = await worker.fetch(new Request("https://worker.test/api/v1/health/live", {
    headers: { Origin: "https://evil.example" },
  }), env);
  assert.equal(res.status, 403);
});

test("unmigrated API routes are explicit and not falsely successful", async () => {
  const res = await worker.fetch(new Request("https://worker.test/api/v1/organizations"), env);
  assert.equal(res.status, 501);
  const payload = await res.json();
  assert.equal(payload.status, "not_implemented");
});
