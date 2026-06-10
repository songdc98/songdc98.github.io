const STORE_KEY = "visitor-regions-v1";
const MAX_REGIONS = 8;

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function createEmptyStats() {
  return {
    total: 0,
    countries: {},
    updatedAt: new Date().toISOString(),
  };
}

function normalizeCountryCode(value) {
  const code = String(value || "ZZ").trim().toUpperCase();
  return /^[A-Z0-9]{2}$/.test(code) ? code : "ZZ";
}

function getCountryCode(request) {
  return normalizeCountryCode(request.cf?.country || request.headers.get("cf-ipcountry"));
}

function normalizeStats(value) {
  const stats = value && typeof value === "object" ? value : createEmptyStats();
  const countries = stats.countries && typeof stats.countries === "object" ? stats.countries : {};

  return {
    total: Math.max(0, Number(stats.total) || 0),
    countries: Object.fromEntries(
      Object.entries(countries)
        .map(([code, count]) => [normalizeCountryCode(code), Math.max(0, Number(count) || 0)])
        .filter(([, count]) => count > 0),
    ),
    updatedAt: typeof stats.updatedAt === "string" ? stats.updatedAt : new Date().toISOString(),
  };
}

function incrementStats(stats, countryCode) {
  const next = normalizeStats(stats);
  next.total += 1;
  next.countries[countryCode] = (next.countries[countryCode] || 0) + 1;
  next.updatedAt = new Date().toISOString();
  return next;
}

function getPublicStats(stats) {
  const normalized = normalizeStats(stats);
  const countries = Object.entries(normalized.countries)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_REGIONS)
    .map(([code, count]) => ({ code, count }));

  return {
    total: normalized.total,
    countries,
    updatedAt: normalized.updatedAt,
  };
}

async function readFromKV(env) {
  if (!env.VISITOR_STATS?.get) return null;

  const value = await env.VISITOR_STATS.get(STORE_KEY, "json");
  return normalizeStats(value);
}

async function writeToKV(env, stats) {
  if (!env.VISITOR_STATS?.put) return false;

  await env.VISITOR_STATS.put(STORE_KEY, JSON.stringify(normalizeStats(stats)));
  return true;
}

function getCacheRequest(request) {
  const url = new URL(request.url);
  url.pathname = "/__visitor-regions-cache";
  url.search = "";
  return new Request(url.toString(), { method: "GET" });
}

async function readFromCache(request) {
  if (typeof caches === "undefined") return null;

  const response = await caches.default.match(getCacheRequest(request));
  if (!response) return null;

  try {
    return normalizeStats(await response.json());
  } catch {
    return null;
  }
}

async function writeToCache(context, stats) {
  if (typeof caches === "undefined") return false;

  const response = new Response(JSON.stringify(normalizeStats(stats)), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=31536000",
    },
  });

  const write = caches.default.put(getCacheRequest(context.request), response);

  if (context.waitUntil) {
    context.waitUntil(write);
  } else {
    await write;
  }

  return true;
}

async function readStats(context) {
  return (await readFromKV(context.env)) || (await readFromCache(context.request)) || createEmptyStats();
}

async function writeStats(context, stats) {
  if (await writeToKV(context.env, stats)) return;
  await writeToCache(context, stats);
}

export async function onRequest(context) {
  const { request } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        ...jsonHeaders,
        allow: "GET, POST, OPTIONS",
      },
    });
  }

  if (request.method !== "GET" && request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: {
        ...jsonHeaders,
        allow: "GET, POST, OPTIONS",
      },
    });
  }

  let stats = await readStats(context);

  if (request.method === "POST") {
    stats = incrementStats(stats, getCountryCode(request));
    await writeStats(context, stats);
  }

  return new Response(JSON.stringify(getPublicStats(stats)), {
    headers: jsonHeaders,
  });
}
