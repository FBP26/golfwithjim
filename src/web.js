import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isEligible, isUpcoming, normalizeTeeTime } from "./analyze.js";
import { collectLiveInventory, mergeCollectedInventory } from "./collect.js";
import { config, sourceRegistry } from "./config.js";
import { loadFeed, teeTimeArray } from "./source.js";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const publicRoot = join(root, "public");
const feedSource = process.env.GOLF_FEED_URL || join(root, "fixtures", "live-current.json");
const baseFeedSource = join(root, "fixtures", "richmond-live-2026-09-16.json");
const port = Number(process.env.PORT || 4194);
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};
let refreshPromise = null;

function collectionDates() {
  const start = new Date();
  const days = Math.max(config.detailedDays, ...(sourceRegistry.interactiveOnly || []).map(source => Number(source.collectionDays || 0)));
  return Array.from({ length: days }, (_, offset) => {
    const date = new Date(start);
    date.setDate(start.getDate() + offset);
    return date.toISOString().slice(0, 10);
  });
}

async function refreshInventory() {
  if (process.env.GOLF_FEED_URL) throw new Error("Live refresh is unavailable for a configured external feed.");
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const baseFeed = JSON.parse(await readFile(baseFeedSource, "utf8"));
      const collected = await collectLiveInventory({ dates: collectionDates() });
      const merged = mergeCollectedInventory(baseFeed, collected);
      await writeFile(feedSource, `${JSON.stringify(merged, null, 2)}\n`);
    })().finally(() => { refreshPromise = null; });
  }
  await refreshPromise;
  return inventory();
}

function json(response, body, status = 200) {
  response.writeHead(status, { "Content-Type": contentTypes[".json"], "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

async function inventory() {
  const payload = await loadFeed(feedSource);
  const inventoryCourses = new Set((sourceRegistry.interactiveOnly || [])
    .filter(source => source.showInventory !== false)
    .map(source => source.course));
  const teeTimes = teeTimeArray(payload)
    .map(normalizeTeeTime)
    .filter(teeTime => inventoryCourses.has(teeTime.course)
      && isEligible(teeTime, { ...config, minimumPlayers: config.collectionMinimumPlayers })
      && teeTime.holes === config.preferredHoles
      && isUpcoming(teeTime));
  return {
    checkedAt: payload.checkedAt || new Date().toISOString(),
    feed: process.env.GOLF_FEED_URL ? "configured feed" : `merged Richmond feed (${payload.completeSources?.length || 0} complete live sources)`,
    sourceChecks: payload.sourceChecks || [],
    teeTimes,
    courses: sourceRegistry.interactiveOnly || [],
  };
}

async function serveFile(requestPath, response) {
  const relativePath = requestPath === "/" ? "index.html" : requestPath.replace(/^\//, "");
  const filePath = resolve(publicRoot, relativePath);
  if (!filePath.startsWith(publicRoot)) return false;
  try {
    const body = await readFile(filePath);
    response.writeHead(200, { "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream" });
    response.end(body);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname === "/api/tee-times") return json(response, await inventory());
    if (url.pathname === "/api/tee-times/refresh" && request.method === "POST") return json(response, await refreshInventory());
    if (url.pathname === "/src/dashboard.js") {
      response.writeHead(200, { "Content-Type": contentTypes[".js"] });
      return response.end(await readFile(join(root, "src", "dashboard.js")));
    }
    if (await serveFile(url.pathname, response)) return;
    json(response, { error: "Not found" }, 404);
  } catch (error) {
    json(response, { error: error.message }, 500);
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Richmond tee times: http://127.0.0.1:${port}`);
  console.log(`Inventory source: ${feedSource}`);
});