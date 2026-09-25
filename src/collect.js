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

export function mergeCollectedInventory(baseFeed, collected, { partial = false } = {}) {
  const baseTeeTimes = Array.isArray(baseFeed) ? baseFeed : baseFeed.teeTimes || [];
  const replacedCourses = new Set(collected.sources);
  const checkedCourses = new Set((collected.sourceChecks || []).map(check => check.course));
  const previousChecks = new Map((baseFeed.sourceChecks || []).map(check => [check.course, check]));
  const cacheHours = new Map(sourceRegistry.interactiveOnly.filter(source => source.cacheMaxAgeHours).map(source => [source.course, Math.min(24, source.cacheMaxAgeHours)]));
  const stamp = (teeTime, verifiedAt) => ({
    ...teeTime,
    ...(verifiedAt ? { verifiedAt } : {}),
    ...(cacheHours.has(teeTime.course) && Number.isFinite(Date.parse(verifiedAt))
      ? { cacheExpiresAt: new Date(Date.parse(verifiedAt) + cacheHours.get(teeTime.course) * 60 * 60_000).toISOString() } : {}),
  });
  const checks = (collected.sourceChecks || []).map(check => {
    const previous = previousChecks.get(check.course);
    const lastSuccessfulAt = check.error ? previous?.lastSuccessfulAt || (!previous?.error ? previous?.checkedAt : undefined) : check.checkedAt;
    return { ...check, ...(lastSuccessfulAt ? { lastSuccessfulAt } : {}) };
  });
  return {
    checkedAt: collected.checkedAt,
    collection: "saved coverage with complete starts from configured live collectors",
    completeSources: partial ? [...(baseFeed.completeSources || []).filter(course => !checkedCourses.has(course)), ...collected.sources] : collected.sources,
    sourceChecks: partial ? [...(baseFeed.sourceChecks || []).filter(check => !checkedCourses.has(check.course)), ...checks] : checks,
    teeTimes: [
      ...baseTeeTimes.filter(teeTime => !replacedCourses.has(teeTime.course)).map(teeTime => {
        if (partial && !checkedCourses.has(teeTime.course)) return teeTime;
        const previous = previousChecks.get(teeTime.course);
        const verifiedAt = teeTime.verifiedAt || previous?.lastSuccessfulAt || (!previous?.error ? previous?.checkedAt : undefined);
        return stamp({ ...teeTime, stale: true }, verifiedAt);
      }),
      ...collected.teeTimes.map(teeTime => stamp(teeTime, collected.checkedAt)),
    ],
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const today = new Date().toISOString().slice(0, 10);
  const requestedDays = Number(argument("days") || config.detailedDays);
  const sourceDays = (sourceRegistry.interactiveOnly || []).map(source => Number(source.collectionDays || 0));
  const dates = datesFrom(argument("start") || today, Math.max(requestedDays, ...sourceDays));
  const course = argument("course");
  const registry = course ? { interactiveOnly: sourceRegistry.interactiveOnly.filter(source => source.course === course && source.collector && source.showInventory !== false) } : sourceRegistry;
  if (course && !registry.interactiveOnly.length) throw new Error(`No live collector configured for ${course}`);
  let result = await collectLiveInventory({ dates, registry });
  const base = argument("base");
  if (base) result = mergeCollectedInventory(JSON.parse(await readFile(resolve(root, base), "utf8")), result, { partial: Boolean(course) });
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