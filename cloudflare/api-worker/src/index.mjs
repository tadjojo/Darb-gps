import { Container } from "@cloudflare/containers";
import { env } from "cloudflare:workers";

const DEFAULT_ALLOWED_ORIGINS = [
  "https://tadjojo.github.io",
  "https://darb-gps-web-2026.tadjojo.workers.dev",
];

function allowedOrigins() {
  return (env.ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS.join(","))
    .split(",").map((value) => value.trim()).filter(Boolean);
}

function corsHeaders(origin) {
  const headers = new Headers({
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, X-Requested-With",
    "Access-Control-Max-Age": "86400",
  });
  if (origin && allowedOrigins().includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
  }
  return headers;
}

export class DarbApiContainer extends Container {
  defaultPort = 3000;
  sleepAfter = "10m";
  envVars = {
    NODE_ENV: "production",
    DATABASE_URL: env.DATABASE_URL,
    DATABASE_CA_CERT: env.DATABASE_CA_CERT,
    DB_POOL_MAX: env.DB_POOL_MAX || "5",
    DB_IDLE_TIMEOUT_MS: env.DB_IDLE_TIMEOUT_MS || "30000",
    DB_CONNECTION_TIMEOUT_MS: env.DB_CONNECTION_TIMEOUT_MS || "10000",
    SUPABASE_URL: env.SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: env.SUPABASE_PUBLISHABLE_KEY,
    CORS_ORIGINS: env.ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS.join(","),
  };
}

export default {
  async fetch(request, workerEnv) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin);
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      if (origin && !allowedOrigins().includes(origin)) {
        return new Response("Origin not allowed", { status: 403, headers: cors });
      }
      return new Response(null, { status: 204, headers: cors });
    }

    if (origin && !allowedOrigins().includes(origin)) {
      return new Response("Origin not allowed", { status: 403, headers: cors });
    }

    if (url.pathname === "/api/v1/health/live" && request.method === "GET") {
      const container = workerEnv.DARB_API.get("primary");
      try {
        const response = await container.fetch(request);
        const headers = new Headers(response.headers);
        for (const [key, value] of cors) headers.set(key, value);
        headers.set("X-DARB-Edge", "cloudflare-containers");
        return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
      } catch {
        return new Response(JSON.stringify({ status: "starting", service: "darb-gps-api" }), {
          status: 503,
          headers: { ...Object.fromEntries(cors), "Content-Type": "application/json; charset=utf-8", "Retry-After": "5" },
        });
      }
    }

    const container = workerEnv.DARB_API.get("primary");
    try {
      const response = await container.fetch(request);
      const headers = new Headers(response.headers);
      for (const [key, value] of cors) headers.set(key, value);
      headers.set("X-DARB-Edge", "cloudflare-containers");
      headers.delete("server");
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch {
      return new Response(JSON.stringify({
        status: "container-unavailable",
        message: "DARB API container is starting or temporarily unavailable",
      }), {
        status: 503,
        headers: { ...Object.fromEntries(cors), "Content-Type": "application/json; charset=utf-8", "Retry-After": "5" },
      });
    }
  },
};
