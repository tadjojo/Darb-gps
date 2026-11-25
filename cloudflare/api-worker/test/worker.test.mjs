import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.mjs";

const originalFetch = globalThis.fetch;

test("proxies API health and adds the Cloudflare edge header", async () => {
  let requested;
  globalThis.fetch = async (request) => {
    requested = new URL(request.url);
    return new Response(JSON.stringify({ status: "ok" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const response = await worker.fetch(new Request(
      "https://darb-gps-new.tadjojo.workers.dev/api/v1/health/live?probe=1",
      { headers: { Origin: "https://tadjojo.github.io" } },
    ), {
      API_ORIGIN: "https://darb-gps-x.onrender.com",
      ALLOWED_ORIGINS: "https://tadjojo.github.io",
    });

    assert.equal(response.status, 200);
    assert.equal(requested.origin, "https://darb-gps-x.onrender.com");
    assert.equal(requested.pathname, "/api/v1/health/live");
    assert.equal(requested.search, "?probe=1");
    assert.equal(response.headers.get("X-DARB-Edge"), "cloudflare-workers");
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://tadjojo.github.io");
    assert.deepEqual(await response.json(), { status: "ok" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("answers allowed CORS preflight without contacting the API", async () => {
  let called = false;
  globalThis.fetch = async () => { called = true; return new Response(); };

  try {
    const response = await worker.fetch(new Request(
      "https://darb-gps-new.tadjojo.workers.dev/api/v1/vehicles",
      {
        method: "OPTIONS",
        headers: {
          Origin: "https://tadjojo.github.io",
          "Access-Control-Request-Method": "GET",
        },
      },
    ), {
      API_ORIGIN: "https://darb-gps-x.onrender.com",
      ALLOWED_ORIGINS: "https://tadjojo.github.io",
    });

    assert.equal(response.status, 204);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://tadjojo.github.io");
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects origins not on the allowlist", async () => {
  const response = await worker.fetch(new Request(
    "https://darb-gps-new.tadjojo.workers.dev/api/v1/health/live",
    { headers: { Origin: "https://not-allowed.example" } },
  ), {
    API_ORIGIN: "https://darb-gps-x.onrender.com",
    ALLOWED_ORIGINS: "https://tadjojo.github.io",
  });

  assert.equal(response.status, 403);
});

test("fails closed when API_ORIGIN is missing", async () => {
  const response = await worker.fetch(new Request(
    "https://darb-gps-new.tadjojo.workers.dev/api/v1/health/live",
  ), {});

  assert.equal(response.status, 503);
  assert.equal((await response.json()).status, "misconfigured");
});
