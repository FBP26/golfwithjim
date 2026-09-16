import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { adaptChronogolfPayload } from "./adapters/chronogolf.js";
import { adaptClubCaddiePayload } from "./adapters/clubcaddie.js";
import { adaptForeUpPayload } from "./adapters/foreup.js";
import { adaptPlay18Payload } from "./adapters/play18.js";
import { adaptTeeSnapPayload } from "./adapters/teesnap.js";
import { adaptTeeItUpPayload } from "./adapters/teeitup.js";
import { adaptWhooshPayload } from "./adapters/whoosh.js";

export function teeTimeArray(payload) {
  if (payload?.provider === "chronogolf") return adaptChronogolfPayload(payload);
  if (payload?.provider === "clubcaddie") return adaptClubCaddiePayload(payload);
  if (payload?.provider === "foreup") return adaptForeUpPayload(payload);
  if (payload?.provider === "play18") return adaptPlay18Payload(payload);
  if (payload?.provider === "teesnap") return adaptTeeSnapPayload(payload);
  if (payload?.provider === "teeitup") return adaptTeeItUpPayload(payload);
  if (payload?.provider === "whoosh") return adaptWhooshPayload(payload);
  if (Array.isArray(payload)) return payload;
  for (const key of ["teeTimes", "times", "items", "data"]) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  throw new Error("Feed must return an array or an object containing teeTimes, times, items, or data.");
}

export async function loadFeed(source) {
  if (/^https?:\/\//i.test(source)) {
    const headers = { Accept: "application/json" };
    if (process.env.GOLF_FEED_TOKEN) headers.Authorization = `Bearer ${process.env.GOLF_FEED_TOKEN}`;
    const response = await fetch(source, { headers, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`Golf feed returned HTTP ${response.status}.`);
    return response.json();
  }
  return JSON.parse(await readFile(resolve(source), "utf8"));
}

export async function loadTeeTimes(source) {
  return teeTimeArray(await loadFeed(source));
}