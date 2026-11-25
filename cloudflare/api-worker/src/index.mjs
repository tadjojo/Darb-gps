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


function parseLimit(value, fallback, min, max) {
  if (value === null || value === undefined || value === "") return fallback;
  if (!/^[0-9]+$/.test(value)) return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}
function parseRange(url, required = true, maxDays = 31) {
  const fromRaw = url.searchParams.get("from"), toRaw = url.searchParams.get("to");
  if (required && (!fromRaw || !toRaw)) return null;
  const from = fromRaw ? Date.parse(fromRaw) : null, to = toRaw ? Date.parse(toRaw) : null;
  if ((fromRaw && !Number.isFinite(from)) || (toRaw && !Number.isFinite(to)) ||
      (from !== null && to !== null && from >= to) ||
      (maxDays > 0 && from !== null && to !== null && to - from > maxDays * 86400000)) return null;
  return { from: from === null ? null : new Date(from).toISOString(), to: to === null ? null : new Date(to).toISOString() };
}
function haversineMeters(a, b) {
  const rad = (n) => n * Math.PI / 180;
  const dLat = rad(Number(b.latitude) - Number(a.latitude)), dLon = rad(Number(b.longitude) - Number(a.longitude));
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(Number(a.latitude))) * Math.cos(rad(Number(b.latitude))) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
function makeTrips(points, limit) {
  const trips = []; let segment = [];
  const flush = () => {
    if (segment.length >= 2) {
      let meters = 0;
      for (let i = 1; i < segment.length; i++) meters += haversineMeters(segment[i - 1], segment[i]);
      trips.push({ id: String(segment[0].id), device_id: "all", start_at: segment[0].recorded_at, end_at: segment[segment.length - 1].recorded_at, distance_meters: Math.round(meters), points_count: segment.length });
    }
    segment = [];
  };
  for (const point of points) {
    if (segment.length && Date.parse(point.recorded_at) - Date.parse(segment[segment.length - 1].recorded_at) > 30 * 60000) flush();
    segment.push(point);
  }
  flush(); return trips.reverse().slice(0, limit);
}
function makeStops(points, limit) {
  const stops = []; let segment = [];
  const flush = () => {
    if (segment.length >= 2) {
      const duration = (Date.parse(segment[segment.length - 1].recorded_at) - Date.parse(segment[0].recorded_at)) / 1000;
      if (duration >= 300) stops.push({ start_at: segment[0].recorded_at, duration_seconds: Math.round(duration), points_count: segment.length, latitude: Number(segment[0].latitude), longitude: Number(segment[0].longitude) });
    }
    segment = [];
  };
  for (const point of points) {
    const stopped = Number(point.speed_kmh ?? 0) <= 3;
    if (!stopped || (segment.length && Date.parse(point.recorded_at) - Date.parse(segment[segment.length - 1].recorded_at) > 10 * 60000)) flush();
    if (stopped) segment.push(point);
  }
  flush(); return stops.reverse().slice(0, limit);
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



async function generateTrackerCredential() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const secret = btoa(String.fromCharCode(...bytes)).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/g, "");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return { secret, hash };
}
function rpcErrorStatus(response, data) {
  if (response.status === 401) return 401;
  if (response.status === 403 || data?.code === "42501") return 403;
  if (response.status === 404 || data?.code === "P0002") return 404;
  if (response.status === 409 || data?.code === "23505") return 409;\n  if (response.status === 400 || ["22023", "23514"].includes(data?.code)) return 400;
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

      const vehicleCreateMatch = url.pathname.match(new RegExp("^/api/v1/organizations/([^/]+)/vehicles$"));
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

            const vehicleListMatch = url.pathname.match(new RegExp("^/api/v1/organizations/([^/]+)/vehicles$"));
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

      if (url.pathname === "/api/v1/tracking/devices/enroll-mobile" && request.method === "POST") {
        const authorization = request.headers.get("Authorization") || "";
        if (!authorization.startsWith("Bearer ")) return json({ message: "Authentication required" }, 401, headers);
        if (!supabaseConfigured(env)) return json({ message: "API configuration unavailable" }, 503, headers);
        const body = await request.json().catch(() => null);
        const vehicleId = typeof body?.vehicleId === "string" ? body.vehicleId : "";
        if (!UUID_RE.test(vehicleId)) return json({ message: "Invalid vehicle ID" }, 400, headers);
        const { response, data } = await supabaseRpc(env, "darb_api_enroll_mobile_device", { p_vehicle_id: vehicleId }, authorization);
        if (!response.ok) return json({ message: "Mobile enrollment failed" }, rpcErrorStatus(response, data), headers);
        return json(data, 201, headers);
      }

      const deviceListMatch = url.pathname.match(new RegExp("^/api/v1/tracking/devices/vehicle/([^/]+)$"));
      if (deviceListMatch && request.method === "GET") {
        const authorization = request.headers.get("Authorization") || "";
        if (!authorization.startsWith("Bearer ")) return json({ message: "Authentication required" }, 401, headers);
        if (!supabaseConfigured(env)) return json({ message: "API configuration unavailable" }, 503, headers);
        const vehicleId = deviceListMatch[1];
        if (!UUID_RE.test(vehicleId)) return json({ message: "Invalid vehicle ID" }, 400, headers);
        const { response, data } = await supabaseRpc(env, "darb_api_list_devices", { p_vehicle_id: vehicleId }, authorization);
        if (!response.ok) return json({ message: "Device list unavailable" }, rpcErrorStatus(response, data), headers);
        return json({ data: Array.isArray(data) ? data : [] }, 200, headers);
      }

      if (url.pathname === "/api/v1/tracking/locations" && request.method === "POST") {
        const authorization = request.headers.get("Authorization") || "";
        if (!authorization.startsWith("Bearer ")) return json({ message: "Authentication required" }, 401, headers);
        if (!supabaseConfigured(env)) return json({ message: "API configuration unavailable" }, 503, headers);
        const body = await request.json().catch(() => null);
        const vehicleId = typeof body?.vehicleId === "string" ? body.vehicleId : "";
        const latitude = body?.latitude, longitude = body?.longitude;
        const speedKmh = body?.speedKmh === undefined ? 0 : body.speedKmh;
        const heading = body?.heading === undefined ? null : body.heading;
        const accuracyMeters = body?.accuracyMeters === undefined ? null : body.accuracyMeters;
        const recordedAt = typeof body?.recordedAt === "string" ? body.recordedAt : "";
        const eventId = body?.eventId === undefined ? null : body.eventId;
        const deviceId = body?.deviceId === undefined ? null : body.deviceId;
        if (!UUID_RE.test(vehicleId) || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
            !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
            !Number.isFinite(speedKmh) || speedKmh < 0 || speedKmh > 500 ||
            (heading !== null && (!Number.isFinite(heading) || heading < 0 || heading > 360)) ||
            (accuracyMeters !== null && (!Number.isFinite(accuracyMeters) || accuracyMeters < 0 || accuracyMeters > 250)) ||
            !recordedAt || !Number.isFinite(Date.parse(recordedAt)) ||
            (eventId !== null && !UUID_RE.test(eventId)) || (deviceId !== null && !UUID_RE.test(deviceId))) {
          return json({ message: "Invalid location payload or GPS accuracy" }, 400, headers);
        }
        const { response, data } = await supabaseRpc(env, "darb_api_ingest_mobile_location", {
          p_vehicle_id: vehicleId, p_latitude: latitude, p_longitude: longitude,
          p_speed_kmh: speedKmh, p_heading: heading, p_recorded_at: new Date(recordedAt).toISOString(),
          p_event_id: eventId, p_device_id: deviceId, p_accuracy_meters: accuracyMeters,
        }, authorization);
        if (!response.ok) return json({ message: "Location ingestion failed" }, rpcErrorStatus(response, data), headers);
        return json(data, 200, headers);
      }

      const latestMatch = url.pathname.match(new RegExp("^/api/v1/tracking/vehicles/([^/]+)/latest$"));
      if (latestMatch && request.method === "GET") {
        const authorization = request.headers.get("Authorization") || "";
        if (!authorization.startsWith("Bearer ")) return json({ message: "Authentication required" }, 401, headers);
        if (!supabaseConfigured(env)) return json({ message: "API configuration unavailable" }, 503, headers);
        const vehicleId = latestMatch[1];
        if (!UUID_RE.test(vehicleId)) return json({ message: "Invalid vehicle ID" }, 400, headers);
        const { response, data } = await supabaseRpc(env, "darb_api_latest_location", { p_vehicle_id: vehicleId }, authorization);
        if (!response.ok) return json({ message: "Latest location unavailable" }, rpcErrorStatus(response, data), headers);
        return json(data, 200, headers);
      }

      const historyMatch = url.pathname.match(new RegExp("^/api/v1/tracking/vehicles/([^/]+)/history$"));
      if (historyMatch && request.method === "GET") {
        const authorization = request.headers.get("Authorization") || "";
        if (!authorization.startsWith("Bearer ")) return json({ message: "Authentication required" }, 401, headers);
        if (!supabaseConfigured(env)) return json({ message: "API configuration unavailable" }, 503, headers);
        const vehicleId = historyMatch[1]; if (!UUID_RE.test(vehicleId)) return json({ message: "Invalid vehicle ID" }, 400, headers);
        const range = parseRange(url, false, 0); if (!range) return json({ message: "Invalid history range" }, 400, headers);
        const limit = parseLimit(url.searchParams.get("limit"), 500, 1, 2000); if (limit === null) return json({ message: "History limit must be 1..2000" }, 400, headers);
        const { response, data } = await supabaseRpc(env, "darb_api_location_points", { p_vehicle_id: vehicleId, p_from: range.from, p_to: range.to, p_limit: limit, p_order_desc: true, p_max_days: 0 }, authorization);
        if (!response.ok) return json({ message: "History unavailable" }, rpcErrorStatus(response, data), headers);
        return json(Array.isArray(data) ? data : [], 200, headers);
      }

      const tripsMatch = url.pathname.match(new RegExp("^/api/v1/tracking/vehicles/([^/]+)/trips$"));
      if (tripsMatch && request.method === "GET") {
        const authorization = request.headers.get("Authorization") || "";
        if (!authorization.startsWith("Bearer ")) return json({ message: "Authentication required" }, 401, headers);
        if (!supabaseConfigured(env)) return json({ message: "API configuration unavailable" }, 503, headers);
        const vehicleId = tripsMatch[1]; if (!UUID_RE.test(vehicleId)) return json({ message: "Invalid vehicle ID" }, 400, headers);
        const range = parseRange(url, true, 31); if (!range) return json({ message: "Invalid trip date range; maximum range is 31 days" }, 400, headers);
        const limit = parseLimit(url.searchParams.get("limit"), 50, 1, 100); if (limit === null) return json({ message: "Trip limit must be 1..100" }, 400, headers);
        const { response, data } = await supabaseRpc(env, "darb_api_location_points", { p_vehicle_id: vehicleId, p_from: range.from, p_to: range.to, p_limit: 10000, p_order_desc: false, p_max_days: 31 }, authorization);
        if (!response.ok) return json({ message: "Trips unavailable" }, rpcErrorStatus(response, data), headers);
        return json({ data: makeTrips(Array.isArray(data) ? data : [], limit) }, 200, headers);
      }

      const routeMatch = url.pathname.match(new RegExp("^/api/v1/tracking/vehicles/([^/]+)/trip-route$"));
      if (routeMatch && request.method === "GET") {
        const authorization = request.headers.get("Authorization") || "";
        if (!authorization.startsWith("Bearer ")) return json({ message: "Authentication required" }, 401, headers);
        if (!supabaseConfigured(env)) return json({ message: "API configuration unavailable" }, 503, headers);
        const vehicleId = routeMatch[1]; if (!UUID_RE.test(vehicleId)) return json({ message: "Invalid vehicle ID" }, 400, headers);
        const range = parseRange(url, true, 31); if (!range) return json({ message: "Invalid route date range" }, 400, headers);
        const { response, data } = await supabaseRpc(env, "darb_api_location_points", { p_vehicle_id: vehicleId, p_from: range.from, p_to: range.to, p_limit: 10000, p_order_desc: false, p_max_days: 31 }, authorization);
        if (!response.ok) return json({ message: "Trip route unavailable" }, rpcErrorStatus(response, data), headers);
        return json(Array.isArray(data) ? data : [], 200, headers);
      }

      const stopsMatch = url.pathname.match(new RegExp("^/api/v1/tracking/vehicles/([^/]+)/stops$"));
      if (stopsMatch && request.method === "GET") {
        const authorization = request.headers.get("Authorization") || "";
        if (!authorization.startsWith("Bearer ")) return json({ message: "Authentication required" }, 401, headers);
        if (!supabaseConfigured(env)) return json({ message: "API configuration unavailable" }, 503, headers);
        const vehicleId = stopsMatch[1]; if (!UUID_RE.test(vehicleId)) return json({ message: "Invalid vehicle ID" }, 400, headers);
        const range = parseRange(url, true, 31); if (!range) return json({ message: "Invalid stop date range" }, 400, headers);
        const limit = parseLimit(url.searchParams.get("limit"), 100, 1, 500); if (limit === null) return json({ message: "Stop limit must be 1..500" }, 400, headers);
        const { response, data } = await supabaseRpc(env, "darb_api_location_points", { p_vehicle_id: vehicleId, p_from: range.from, p_to: range.to, p_limit: 10000, p_order_desc: false, p_max_days: 31 }, authorization);
        if (!response.ok) return json({ message: "Stops unavailable" }, rpcErrorStatus(response, data), headers);
        return json({ data: makeStops(Array.isArray(data) ? data : [], limit) }, 200, headers);
      }

      if (url.pathname === "/api/v1/tracking/devices/gps" && request.method === "POST") {
        const authorization = request.headers.get("Authorization") || "";
        if (!authorization.startsWith("Bearer ")) return json({ message: "Authentication required" }, 401, headers);
        if (!supabaseConfigured(env)) return json({ message: "API configuration unavailable" }, 503, headers);
        const body = await request.json().catch(() => null);
        const vehicleId = typeof body?.vehicleId === "string" ? body.vehicleId : "";
        const label = typeof body?.label === "string" ? body.label.trim() : null;
        const protocol = body?.protocol === undefined ? "json" : body.protocol;
        const imei = body?.imei === undefined ? null : body.imei;
        const model = body?.model === undefined ? null : (typeof body.model === "string" ? body.model.trim() : body.model);
        const timezoneOffsetMinutes = body?.timezoneOffsetMinutes === undefined ? null : body.timezoneOffsetMinutes;
        if (!UUID_RE.test(vehicleId) || !["json", "gt06", "nmea"].includes(protocol) ||
            (label !== null && (typeof label !== "string" || label.length > 100)) ||
            (model !== null && (typeof model !== "string" || model.length > 80)) ||
            (imei !== null && (typeof imei !== "string" || !/^[0-9]{8,20}$/.test(imei))) ||
            (timezoneOffsetMinutes !== null && (!Number.isInteger(timezoneOffsetMinutes) || timezoneOffsetMinutes < -840 || timezoneOffsetMinutes > 840)) ||
            (protocol === "gt06" && (!imei || timezoneOffsetMinutes === null)) ||
            (protocol === "nmea" && !imei)) return json({ message: "Invalid GPS tracker profile" }, 400, headers);
        const { secret, hash } = await generateTrackerCredential();
        const { response, data } = await supabaseRpc(env, "darb_api_enroll_gps_tracker", {
          p_vehicle_id: vehicleId, p_label: label, p_protocol: protocol, p_imei: imei,
          p_model: model, p_timezone_offset_minutes: timezoneOffsetMinutes, p_credential_hash: hash,
        }, authorization);
        if (!response.ok) return json({ message: "GPS tracker enrollment failed" }, rpcErrorStatus(response, data), headers);
        return json({ device: data, credential: secret, credentialFormat: "Authorization: Bearer <credential>", warning: "Store this credential securely; it is shown only once." }, 201, headers);
      }

      const rotateMatch = url.pathname.match(new RegExp("^/api/v1/tracking/devices/gps/([^/]+)/rotate-credential$"));
      if (rotateMatch && request.method === "POST") {
        const authorization = request.headers.get("Authorization") || "";
        if (!authorization.startsWith("Bearer ")) return json({ message: "Authentication required" }, 401, headers);
        if (!supabaseConfigured(env)) return json({ message: "API configuration unavailable" }, 503, headers);
        const deviceId = rotateMatch[1]; if (!UUID_RE.test(deviceId)) return json({ message: "Invalid device ID" }, 400, headers);
        const { secret, hash } = await generateTrackerCredential();
        const { response, data } = await supabaseRpc(env, "darb_api_rotate_gps_credential", { p_device_id: deviceId, p_credential_hash: hash }, authorization);
        if (!response.ok) return json({ message: "Credential rotation failed" }, rpcErrorStatus(response, data), headers);
        return json({ deviceId: data.deviceId, protocol: data.protocol, credential: secret, credentialFormat: "Authorization: Bearer <credential>", warning: "Previous credential is invalid immediately. Store this new credential securely; it is shown only once." }, 200, headers);
      }

      const revokeMatch = url.pathname.match(new RegExp("^/api/v1/tracking/devices/gps/([^/]+)/revoke$"));
      if (revokeMatch && request.method === "POST") {
        const authorization = request.headers.get("Authorization") || "";
        if (!authorization.startsWith("Bearer ")) return json({ message: "Authentication required" }, 401, headers);
        if (!supabaseConfigured(env)) return json({ message: "API configuration unavailable" }, 503, headers);
        const deviceId = revokeMatch[1]; if (!UUID_RE.test(deviceId)) return json({ message: "Invalid device ID" }, 400, headers);
        const { response, data } = await supabaseRpc(env, "darb_api_revoke_gps_tracker", { p_device_id: deviceId }, authorization);
        if (!response.ok) return json({ message: "Tracker revocation failed" }, rpcErrorStatus(response, data), headers);
        return json(data, 200, headers);
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
