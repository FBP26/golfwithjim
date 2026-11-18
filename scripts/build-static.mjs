import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isEligible, isUpcoming, normalizeTeeTime } from "../src/analyze.js";
import { config, sourceRegistry } from "../src/config.js";
import { teeTimeArray } from "../src/source.js";
import { qualifyDeals } from "../src/price-history.js";
import { compactTeeTime } from "../src/compact.js";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "dist");
const payload = JSON.parse(await readFile(resolve(root, "fixtures/live-current.json"), "utf8"));
const inventoryCourses = new Set(sourceRegistry.interactiveOnly
  .filter(source => source.showInventory !== false)
  .map(source => source.course));
const teeTimes = teeTimeArray(payload)
  .map(normalizeTeeTime)
  .filter(teeTime => inventoryCourses.has(teeTime.course)
    && isEligible(teeTime, { ...config, minimumPlayers: config.collectionMinimumPlayers, allowCachedInventory: true })
    && teeTime.holes === config.preferredHoles
    && isUpcoming(teeTime));

await rm(output, { recursive: true, force: true });
await cp(resolve(root, "public"), output, { recursive: true });
await mkdir(resolve(output, "src"), { recursive: true });
await mkdir(resolve(output, "api"), { recursive: true });
await cp(resolve(root, "src/dashboard.js"), resolve(output, "src/dashboard.js"));
await cp(resolve(root, "src/analyze.js"), resolve(output, "src/analyze.js"));
await cp(resolve(root, "src/price-history.js"), resolve(output, "src/price-history.js"));
const staleCourses = (payload.sourceChecks || []).filter(check => check.error && inventoryCourses.has(check.course)
  && Date.now() - Date.parse(check.lastSuccessfulAt || 0) > 24 * 60 * 60_000)
  .map(check => ({ course: check.course, error: check.error, lastSuccessfulAt: check.lastSuccessfulAt || null }));

await writeFile(resolve(output, "api/tee-times.json"), `${JSON.stringify({
  checkedAt: payload.checkedAt,
  sourceChecks: payload.sourceChecks || [],
  staleCourses,
  teeTimes: qualifyDeals(teeTimes, [], Date.now(), payload.sourceChecks || []).map(compactTeeTime),
  courses: sourceRegistry.interactiveOnly,
})}\n`);
await writeFile(resolve(output, ".nojekyll"), "");
console.log(`Built ${teeTimes.length} tee times in ${output}.`);