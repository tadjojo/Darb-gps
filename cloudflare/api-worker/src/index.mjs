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


const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function supabaseRpc(env, functionName, args, authorization) {
  const response = await fetch(new URL(`/rest/v1/rpc/${functionName}`, env.SUPABASE_URL), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": env.SUPABASE_PUBLISHABLE_KEY,
      "Authorization": authorization,
    },
    body: JSON.stringify(args),
  });
  const data = await response.json().catch(() => null);
  return { response, data };
}


function rpcErrorStatus(response, data) {
  if (response.status === 401) return 401;
  if (response.status === 403 || data?.code === "42501") return 403;
  if (response.status === 404 || data?.code === "P0002") return 404;
  if (response.status === 400 || ["22023", "23514"].includes(data?.code)) return 400;
  return 502;
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
        const body = await request.json().catch(() => null);
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
        const body = await request.json().catch(() => null);
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


      if (url.pathname === "/api/v1/organizations" && request.method === "POST") {
        const authorization = request.headers.get("Authorization") || "";
        if (!authorization.startsWith("Bearer ")) return json({ message: "Authentication required" }, 401, headers);
        if (!supabaseConfigured(env)) return json({ message: "API configuration unavailable" }, 503, headers);
        const body = await request.json().catch(() => null);
        const name = typeof body?.name === "string" ? body.name.trim() : "";
        if (!name || name.length > 150) return json({ message: "Organization name must be 1..150 characters" }, 400, headers);
        const { response, data } = await supabaseRpc(env, "darb_api_create_organization", { p_name: name }, authorization);
        if (!response.ok) return json({ message: "Organization creation failed" }, rpcErrorStatus(response, data), headers);
        return json(data, 201, headers);
      }

      const vehicleCreateMatch = url.pathname.match(/^\\/api\\/v1\\/organizations\\/([^/]+)\\/vehicles$/);
      if (vehicleCreateMatch && request.method === "POST") {
        const authorization = request.headers.get("Authorization") || "";
        if (!authorization.startsWith("Bearer ")) return json({ message: "Authentication required" }, 401, headers);
        if (!supabaseConfigured(env)) return json({ message: "API configuration unavailable" }, 503, headers);
        const organizationId = vehicleCreateMatch[1];
        if (!UUID_RE.test(organizationId)) return json({ message: "Invalid organization ID" }, 400, headers);
        const body = await request.json().catch(() => null);
        const displayName = typeof body?.displayName === "string" ? body.displayName.trim() : "";
        const registrationNumber = typeof body?.registrationNumber === "string" ? body.registrationNumber.trim() : "";
        if (!displayName || displayName.length > 100 || registrationNumber.length > 30) return json({ message: "Invalid vehicle fields" }, 400, headers);
        const { response, data } = await supabaseRpc(env, "darb_api_create_vehicle", { p_organization_id: organizationId, p_display_name: displayName, p_registration_number: registrationNumber || null }, authorization);
        if (!response.ok) return json({ message: "Vehicle creation failed" }, rpcErrorStatus(response, data), headers);
        return json(data, 201, headers);
      }

      const vehicleListMatch = url.pathname.match(/^\\/api\\/v1\\/organizations\\/([^/]+)\\/vehicles$/);
      if (vehicleListMatch && request.method === "GET") {
        const authorization = request.headers.get("Authorization") || "";
        if (!authorization.startsWith("Bearer ")) return json({ message: "Authentication required" }, 401, headers);
        if (!supabaseConfigured(env)) return json({ message: "API configuration unavailable" }, 503, headers);
        const organizationId = vehicleListMatch[1];
        if (!UUID_RE.test(organizationId)) return json({ message: "Invalid organization ID" }, 400, headers);
        const { response, data } = await supabaseRpc(env, "darb_api_list_vehicles", { p_organization_id: organizationId }, authorization);
        if (!response.ok) return json({ message: "Vehicle list unavailable" }, rpcErrorStatus(response, data), headers);
        return json({ data: Array.isArray(data) ? data : [] }, 200, headers);
      }
      if (url.pathname === "/api/v1/auth/me" && request.method === "GET") {
        const authorization = request.headers.get("Authorization") || "";
        if (!authorization.startsWith("Bearer ")) return json({ message: "Authentication required" }, 401, headers);
        if (!supabaseConfigured(env)) return json({ message: "API configuration unavailable" }, 503, headers);
        const upstream = await fetch(new URL("/auth/v1/user", env.SUPABASE_URL), {
          method: "GET",
          headers: { "apikey": env.SUPABASE_PUBLISHABLE_KEY, "Authorization": authorization },
        });
        const user = await upstream.json().catch(() => ({}));
        if (!upstream.ok) return json({ message: "Authentication token is invalid or expired" }, 401, headers);
        return json({ id: user.id, email: user.email ?? null, phone: user.phone ?? null, role: user.role ?? null }, 200, headers);
      }
      return json({ status: "not_implemented", message: "This route is not yet migrated to the Free Worker API. Existing API is not replaced until migration is completed." }, 501, headers);
    } catch {
      return json({ status: "error", message: "API configuration or upstream request failed" }, 502, headers);
    }
  },
};
