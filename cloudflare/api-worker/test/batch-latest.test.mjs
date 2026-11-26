import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.mjs";

test("organization latest-location batch endpoint returns paginated data and forwards params", async () => {
  const expected = [{ vehicle_id: "vehicle-1", location: { latitude: 31.9, longitude: 35.9 } }];
  const env = {
    ALLOWED_ORIGINS: "https://app.example",
    SUPABASE_URL: "https://supabase.example",
    SUPABASE_PUBLISHABLE_KEY: "public-key",
  };
  const originalFetch = globalThis.fetch;
  let rpcUrl = "";
  let rpcBody = null;
  globalThis.fetch = async (url,init) => {
    rpcUrl = String(url); rpcBody = JSON.parse(init.body);
    return new Response(JSON.stringify({data:expected,nextOffset:250}), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const response = await worker.fetch(new Request("https://worker.test/api/v1/organizations/org-1/locations/latest?limit=250&offset=0", {
      method: "GET",
      headers: { Authorization: "Bearer user-token" },
    }), env);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { data: expected, nextOffset: 250 });
    assert.match(rpcUrl, /darb_api_latest_locations_for_organization$/);
    assert.deepEqual(rpcBody,{p_organization_id:"org-1",p_limit:250,p_offset:0});
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

test("organization latest-location batch endpoint rejects invalid pagination", async () => {
  const response = await worker.fetch(new Request("https://worker.test/api/v1/organizations/org-1/locations/latest?limit=501&offset=-1", {
    headers: {Authorization:"Bearer token"},
  }), {
    ALLOWED_ORIGINS: "https://app.example",
    SUPABASE_URL: "https://supabase.example",
    SUPABASE_PUBLISHABLE_KEY: "public-key",
  });
  assert.equal(response.status,400);
});
