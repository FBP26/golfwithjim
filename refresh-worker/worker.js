const allowedOrigin = "https://fbp26.github.io";
const repositoryApiUrl = "https://api.github.com/repos/FBP26/golfwithjim";

function responseHeaders() {
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
  };
}

async function hasValidGitHubToken(request) {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return false;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(authorization));
  const key = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  const cache = caches.default;
  if (await cache.match(`https://golfwithjim-refresh.internal/auth/${key}`)) return true;
  const verification = await fetch(repositoryApiUrl, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: authorization,
      "User-Agent": "golfwithjim-refresh",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!verification.ok) return false;
  const repository = await verification.json();
  if (repository.full_name !== "FBP26/golfwithjim") return false;
  await cache.put(`https://golfwithjim-refresh.internal/auth/${key}`, new Response("1", { headers: { "Cache-Control": "max-age=300" } }));
  return true;
}

async function proxyChronogolf(request, url) {
  if (!await hasValidGitHubToken(request)) return new Response("Unauthorized", { status: 401 });
  const target = new URL(url.searchParams.get("target") || "https://invalid.local");
  const allowedPath = /^\/marketplace\/(?:v2\/teetimes(?:\/[0-9a-f-]+)?|reservations\/options)$/;
  if (target.origin !== "https://www.chronogolf.com" || !allowedPath.test(target.pathname)) {
    return new Response("Target not allowed", { status: 403 });
  }
  const chronogolfResponse = await fetch(target, {
    method: request.method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; golfwithjim/1.0)",
    },
    body: request.method === "POST" ? await request.text() : undefined,
  });
  const headers = new Headers({ "Cache-Control": "no-store", "Content-Type": "application/json" });
  if (chronogolfResponse.headers.has("total")) headers.set("total", chronogolfResponse.headers.get("total"));
  return new Response(chronogolfResponse.body, { status: chronogolfResponse.status, headers });
}

async function proxyTeeItUp(request, url) {
  if (!await hasValidGitHubToken(request)) return new Response("Unauthorized", { status: 401 });
  const target = new URL(url.searchParams.get("target") || "https://invalid.local");
  const alias = url.searchParams.get("alias") || "";
  if (target.origin !== "https://phx-api-be-east-1b.kenna.io" || target.pathname !== "/v2/tee-times" || !/^[a-z0-9-]+$/.test(alias)) {
    return new Response("Target not allowed", { status: 403 });
  }
  const teeItUpResponse = await fetch(target, {
    headers: {
      Accept: "application/json",
      "x-be-alias": alias,
      "User-Agent": "Mozilla/5.0 (compatible; golfwithjim/1.0)",
    },
  });
  const headers = new Headers({ "Cache-Control": "no-store", "Content-Type": "application/json" });
  if (teeItUpResponse.headers.has("retry-after")) headers.set("retry-after", teeItUpResponse.headers.get("retry-after"));
  return new Response(teeItUpResponse.body, { status: teeItUpResponse.status, headers });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const url = new URL(request.url);
    if (["GET", "POST"].includes(request.method) && url.pathname === "/chronogolf") return proxyChronogolf(request, url);
    if (request.method === "GET" && url.pathname === "/teeitup") return proxyTeeItUp(request, url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: responseHeaders() });
    if (request.method !== "POST" || url.pathname !== "/refresh") {
      return new Response(JSON.stringify({ ok: true }), { headers: responseHeaders() });
    }
    if (origin !== allowedOrigin) return new Response(JSON.stringify({ error: "Origin not allowed" }), { status: 403, headers: responseHeaders() });
    const cache = caches.default;
    const throttleKey = new Request("https://golfwithjim-refresh.internal/lock");
    if (await cache.match(throttleKey)) return new Response(JSON.stringify({ ok: true, alreadyRunning: true }), { status: 202, headers: responseHeaders() });
    const githubResponse = await fetch("https://api.github.com/repos/FBP26/golfwithjim/actions/workflows/pages.yml/dispatches", {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        "Content-Type": "application/json",
        "User-Agent": "golfwithjim-refresh",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ ref: "main" }),
    });
    if (!githubResponse.ok) return new Response(JSON.stringify({ error: `GitHub returned HTTP ${githubResponse.status}` }), { status: 502, headers: responseHeaders() });
    await cache.put(throttleKey, new Response("1", { headers: { "Cache-Control": "max-age=60" } }));
    return new Response(JSON.stringify({ ok: true }), { status: 202, headers: responseHeaders() });
  },
};