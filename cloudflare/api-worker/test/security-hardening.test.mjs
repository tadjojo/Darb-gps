import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.mjs";

const env = { ALLOWED_ORIGINS: "https://app.example" };

test("API responses include baseline security headers", async () => {
  const response = await worker.fetch(new Request("https://worker.test/api/v1/health/live"), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
  assert.equal(response.headers.get("X-Frame-Options"), "DENY");
  assert.equal(response.headers.get("Content-Security-Policy"), "default-src 'none'; frame-ancestors 'none';");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("rejects requests declaring a body larger than 64 KiB", async () => {
  const request = new Request("https://worker.test/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": "65537" },
    body: JSON.stringify({ identifier: "x", password: "x" }),
  });
  const response = await worker.fetch(request, env);
  assert.equal(response.status, 413);
  assert.match((await response.json()).message, /64 KiB/);
});

test("rejects an oversized streamed body even without Content-Length", async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(65537));
      controller.close();
    },
  });
  const request = new Request("https://worker.test/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: stream,
    duplex: "half",
  });
  const response = await worker.fetch(request, env);
  assert.equal(response.status, 413);
  assert.match((await response.json()).message, /64 KiB/);
});
