const DEFAULT_ALLOWED_ORIGINS = [
  "https://tadjojo.github.io",
  "https://darb-gps-web-2026.tadjojo.workers.dev",
];

function allowedOrigins(env) {
  return (env.ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS.join(","))
    .split(",").map((s) => s.trim()).filter(Boolean);
}

function cors(origin, env) {
  const h = new Headers({
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, X-Requested-With",
    "Access-Control-Max-Age": "86400",
  });
  if (origin && allowedOrigins(env).includes(origin)) {
    h.set("Access-Control-Allow-Origin", origin);
    h.set("Access-Control-Allow-Credentials", "true");
  }
  return h;
}

function json(data, status, headers) {
  const h = new Headers(headers || {});
  h.set("Content-Type", "application/json; charset=utf-8");
  h.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(data), { status, headers: h });
}

function supabaseConfigured(env) {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY);
}

async function supabaseAuth(env, path, payload) {
  if (!supabaseConfigured(env)) throw new Error("Supabase environment is not configured");
  const response = await fetch(new URL(path, env.SUPABASE_URL), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": env.SUPABASE_PUBLISHABLE_KEY,
    },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const headers = cors(origin, env);
    const url = new URL(request.url);
    if (origin && !allowedOrigins(env).includes(origin)) {
      return json({ status: "error", message: "Origin not allowed" }, 403, headers);
    }
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (url.pathname === "/api/v1/health/live" && request.method === "GET") {
      return json({ status: "ok", service: "darb-gps-api", runtime: "cloudflare-worker" }, 200, headers);
    }
    if (url.pathname === "/api/v1/health/ready" && request.method === "GET") {
      const configured = supabaseConfigured(env);
      return json({
        status: configured ? "ready" : "not_ready",
        service: "darb-gps-api",
        supabaseConfigured: configured,
        note: "Readiness checks configuration only; no database connectivity test is performed.",
      }, configured ? 200 : 503, headers);
    }

    try {
      if (url.pathname === "/api/v1/auth/login" && request.method === "POST") {
        const body = await request.json();
        const identifier = String(body?.identifier || "").trim();
        const password = body?.password;
        if (!identifier || typeof password !== "string" || !password) {
          return json({ message: "يرجى إدخال البريد الإلكتروني أو الهاتف وكلمة المرور" }, 400, headers);
        }
        const credentials = identifier.includes("@") ? { email: identifier, password } : { phone: identifier, password };
        const { response, body: auth } = await supabaseAuth(env, "/auth/v1/token?grant_type=password", credentials);
        if (!response.ok) return json({ message: "بيانات تسجيل الدخول غير صحيحة" }, 401, headers);
        return json({ accessToken: auth.access_token, refreshToken: auth.refresh_token }, 200, headers);
      }

      if (url.pathname === "/api/v1/auth/refresh" && request.method === "POST") {
        const body = await request.json();
        if (!body?.refreshToken) return json({ message: "Refresh token is required" }, 400, headers);
        const { response, body: auth } = await supabaseAuth(env, "/auth/v1/token?grant_type=refresh_token", { refresh_token: body.refreshToken });
        if (!response.ok) return json({ message: "Refresh token is invalid or expired" }, 401, headers);
        return json({ accessToken: auth.access_token, refreshToken: auth.refresh_token }, 200, headers);
      }

      if (url.pathname === "/api/v1/auth/logout" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const token = request.headers.get("Authorization") || "";
        if (!token.startsWith("Bearer ") || !body?.refreshToken) return json({ message: "Authentication required" }, 401, headers);
        const response = await fetch(new URL("/auth/v1/logout?scope=local", env.SUPABASE_URL), {
          method: "POST",
          headers: { "apikey": env.SUPABASE_PUBLISHABLE_KEY, "Authorization": token },
        });
        if (!response.ok) return json({ message: "Logout failed" }, response.status, headers);
        return new Response(null, { status: 204, headers });
      }
      return json({ status: "not_implemented", message: "This route is not yet migrated to the Free Worker API. Existing API is not replaced until migration is completed." }, 501, headers);
    } catch {
      return json({ status: "error", message: "API configuration or upstream request failed" }, 502, headers);
    }
  },
};
