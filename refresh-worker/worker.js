const allowedOrigin = "https://fbp26.github.io";

function responseHeaders() {
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: responseHeaders() });
    if (request.method !== "POST" || new URL(request.url).pathname !== "/refresh") {
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