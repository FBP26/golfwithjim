import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectChronogolfDay } from "./collectors/chronogolf.js";
import { collectClubCaddieDay } from "./collectors/clubcaddie.js";
import { collectForeUpDay } from "./collectors/foreup.js";
import { collectGolfNowDay } from "./collectors/golfnow.js";
import { collectPlay18Day } from "./collectors/play18.js";
import { collectTeeItUpDay } from "./collectors/teeitup.js";
import { collectTeeSnapDay } from "./collectors/teesnap.js";
import { config, sourceRegistry } from "./config.js";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const argument = name => process.argv.find(value => value.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

function datesFrom(start, count) {
  const first = new Date(`${start}T12:00:00Z`);
  if (Number.isNaN(first.valueOf())) throw new Error(`Invalid start date: ${start}`);
  return Array.from({ length: count }, (_, offset) => {
    const date = new Date(first);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  });
}

async function collectSource(source, date, fetchImpl) {
  if (source.collector === "chronogolf") {
    return collectChronogolfDay({
      courseUuid: source.providerCourseUuid,
      affiliationTypeId: source.providerAffiliationTypeId,
      date,
      course: source.course,
      distanceMiles: source.distanceMiles,
      url: source.url,
      fetchImpl,
    });
  }
  if (source.collector === "golfnow") {
    return collectGolfNowDay({
      facilityId: source.providerCourseId,
      date,
      course: source.course,
      distanceMiles: source.distanceMiles,
      latitude: source.latitude,
      longitude: source.longitude,
      fetchImpl,
    });
  }
  if (source.collector === "play18") {
    return collectPlay18Day({
      url: source.url,
      date,
      course: source.course,
      distanceMiles: source.distanceMiles,
      fetchImpl,
    });
  }
  if (source.collector === "teesnap") {
    return collectTeeSnapDay({
      baseUrl: source.url,
      courseId: source.providerCourseId,
      date,
      course: source.course,
      distanceMiles: source.distanceMiles,
      fetchImpl,
    });
  }
  if (source.collector === "teeitup") {
    return collectTeeItUpDay({
      url: source.url,
      date,
      course: source.course,
      distanceMiles: source.distanceMiles,
      fetchImpl,
    });
  }
  if (source.collector === "foreup") {
    return collectForeUpDay({
      url: source.url,
      date,
      course: source.course,
      distanceMiles: source.distanceMiles,
      fetchImpl,
    });
  }
  if (source.collector === "clubcaddie") {
    return collectClubCaddieDay({
      url: source.url,
      date,
      course: source.course,
      distanceMiles: source.distanceMiles,
      fetchImpl,
    });
  }
  return [];
}

export async function collectLiveInventory({ registry = sourceRegistry, dates, fetchImpl = fetch } = {}) {
  const sources = (registry.interactiveOnly || []).filter(source => source.collector && source.showInventory !== false);
  const checkedAt = new Date().toISOString();
  const results = await Promise.all(sources.map(async source => {
    const sourceDates = dates.slice(0, source.collectionDays || config.detailedDays);
    const teeTimes = [];
    try {
      for (const date of sourceDates) teeTimes.push(...await collectSource(source, date, fetchImpl));
      return {
        course: source.course,
        checkedAt,
        requestedFrom: sourceDates[0] || null,
        requestedThrough: sourceDates.at(-1) || null,
        latestAvailableDate: teeTimes.map(teeTime => teeTime.date).sort().at(-1) || null,
        teeTimeCount: teeTimes.length,
        teeTimes,
      };
    } catch (error) {
      return {
        course: source.course,
        checkedAt,
        requestedFrom: sourceDates[0] || null,
        requestedThrough: sourceDates.at(-1) || null,
        error: error.message,
        teeTimes: [],
      };
    }
  }));
  const successful = results.filter(result => !result.error);
  return {
    checkedAt,
    collection: "complete starts from configured live collectors",
    sources: successful.map(result => result.course),
    sourceChecks: results.map(({ teeTimes, ...check }) => check),
    teeTimes: successful.flatMap(result => result.teeTimes),
  };
}

export function mergeCollectedInventory(baseFeed, collected) {
  const baseTeeTimes = Array.isArray(baseFeed) ? baseFeed : baseFeed.teeTimes || [];
  const replacedCourses = new Set(collected.sources);
  return {
    checkedAt: collected.checkedAt,
    collection: "saved coverage with complete starts from configured live collectors",
    completeSources: collected.sources,
    sourceChecks: collected.sourceChecks,
    teeTimes: [
      ...baseTeeTimes.filter(teeTime => !replacedCourses.has(teeTime.course)),
      ...collected.teeTimes,
    ],
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const today = new Date().toISOString().slice(0, 10);
  const requestedDays = Number(argument("days") || config.detailedDays);
  const sourceDays = (sourceRegistry.interactiveOnly || []).map(source => Number(source.collectionDays || 0));
  const dates = datesFrom(argument("start") || today, Math.max(requestedDays, ...sourceDays));
  let result = await collectLiveInventory({ dates });
  const base = argument("base");
  if (base) result = mergeCollectedInventory(JSON.parse(await readFile(resolve(root, base), "utf8")), result);
  const output = argument("output");
  if (output) {
    const outputPath = resolve(root, output);
    await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
    const sourceCount = (result.completeSources || result.sources).length;
    console.log(`Wrote ${result.teeTimes.length} tee times with ${sourceCount} complete source(s) to ${outputPath}.`);
  } else {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
}