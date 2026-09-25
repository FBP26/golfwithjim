import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isEligible, isUpcoming, normalizeTeeTime } from "../src/analyze.js";
import { config, sourceRegistry } from "../src/config.js";
import { teeTimeArray } from "../src/source.js";

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
await writeFile(resolve(output, "api/tee-times.json"), `${JSON.stringify({
  checkedAt: payload.checkedAt,
  sourceChecks: payload.sourceChecks || [],
  teeTimes,
  courses: sourceRegistry.interactiveOnly,
})}\n`);
await writeFile(resolve(output, ".nojekyll"), "");
console.log(`Built ${teeTimes.length} tee times in ${output}.`);