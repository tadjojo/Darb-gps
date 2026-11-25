const DEFAULT_ALLOWED_ORIGINS = [
  "https://tadjojo.github.io",
  "https://darb-gps-web.onrender.com",
  "https://darb-gps-web-2026.tadjojo.workers.dev",
];

function allowedOrigins(env) {
  return (env.ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS.join(","))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function corsHeaders(origin, env) {
  const headers = new Headers({
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, X-Requested-With",
    "Access-Control-Max-Age": "86400",
  });

  if (origin && allowedOrigins(env).includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
  }
  return headers;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env);

    if (request.method === "OPTIONS") {
      if (origin && !allowedOrigins(env).includes(origin)) {
        return new Response("Origin not allowed", { status: 403, headers: cors });
      }
      return new Response(null, { status: 204, headers: cors });
    }

    if (origin && !allowedOrigins(env).includes(origin)) {
      return new Response("Origin not allowed", { status: 403, headers: cors });
    }

    if (!env.API_ORIGIN) {
      return new Response(JSON.stringify({
        status: "misconfigured",
        message: "API_ORIGIN is not configured",
      }), {
        status: 503,
        headers: { ...Object.fromEntries(cors), "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const incoming = new URL(request.url);
    const upstream = new URL(env.API_ORIGIN);
    upstream.pathname = incoming.pathname;
    upstream.search = incoming.search;

    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.delete("origin");
    headers.delete("cf-connecting-ip");
    headers.delete("x-forwarded-for");

    let upstreamResponse;
    try {
      upstreamResponse = await fetch(new Request(upstream.toString(), {
        method: request.method,
        headers,
        body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
        redirect: "manual",
      }));
    } catch {
      return new Response(JSON.stringify({
        status: "upstream-unavailable",
        message: "DARB API upstream is temporarily unavailable",
      }), {
        status: 502,
        headers: { ...Object.fromEntries(cors), "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const responseHeaders = new Headers(upstreamResponse.headers);
    for (const [key, value] of cors) responseHeaders.set(key, value);
    responseHeaders.set("X-DARB-Edge", "cloudflare-workers");
    responseHeaders.delete("server");

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  },
};
