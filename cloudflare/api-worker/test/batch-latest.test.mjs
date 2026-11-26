import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.mjs";

test("organization latest-location batch endpoint returns data envelope", async () => {
  const expected = [{ vehicle_id: "vehicle-1", location: { latitude: 31.9, longitude: 35.9 } }];
  const env = {
    ALLOWED_ORIGINS: "https://app.example",
    SUPABASE_URL: "https://supabase.example",
    SUPABASE_PUBLISHABLE_KEY: "public-key",
  };
  const originalFetch = globalThis.fetch;
  let rpcUrl = "";
  globalThis.fetch = async (url) => {
    rpcUrl = String(url);
    return new Response(JSON.stringify(expected), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const response = await worker.fetch(new Request("https://worker.test/api/v1/organizations/org-1/locations/latest", {
      method: "GET",
      headers: { Authorization: "Bearer user-token" },
    }), env);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { data: expected });
    assert.match(rpcUrl, /darb_api_latest_locations_for_organization$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("organization latest-location batch endpoint requires bearer auth", async () => {
  const response = await worker.fetch(new Request("https://worker.test/api/v1/organizations/org-1/locations/latest"), {
    ALLOWED_ORIGINS: "https://app.example",
  });
  assert.equal(response.status, 401);
});
