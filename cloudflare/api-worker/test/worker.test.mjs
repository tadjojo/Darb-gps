import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workerSource = await readFile(new URL("../src/index.mjs", import.meta.url), "utf8");
const config = await readFile(new URL("../wrangler.toml", import.meta.url), "utf8");

test("Cloudflare Worker routes requests to the native API container", () => {
  assert.match(workerSource, /from "@cloudflare\/containers"/);
  assert.match(workerSource, /class DarbApiContainer extends Container/);
  assert.match(workerSource, /workerEnv\.DARB_API\.get\("primary"\)/);
  assert.match(workerSource, /container\.fetch\(request\)/);
  assert.doesNotMatch(workerSource, /onrender\.com|API_ORIGIN/);
});

test("Wrangler config builds the existing API Dockerfile on Cloudflare", () => {
  assert.match(config, /name = "darb-gps-new"/);
  assert.match(config, /image = "\.\.\/\.\.\/api\/Dockerfile"/);
  assert.match(config, /image_build_context = "\.\.\/\.\.\/api"/);
  assert.match(config, /class_name = "DarbApiContainer"/);
  assert.match(config, /name = "DARB_API"/);
  assert.doesNotMatch(config, /onrender\.com|API_ORIGIN/);
});

test("API container receives only runtime configuration via Cloudflare bindings", () => {
  assert.match(workerSource, /DATABASE_URL: env\.DATABASE_URL/);
  assert.match(workerSource, /DATABASE_CA_CERT: env\.DATABASE_CA_CERT/);
  assert.match(workerSource, /SUPABASE_URL: env\.SUPABASE_URL/);
  assert.match(workerSource, /SUPABASE_PUBLISHABLE_KEY: env\.SUPABASE_PUBLISHABLE_KEY/);
});
