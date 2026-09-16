import { resolve } from "node:path";
import { findPriceBreaks, isEligible, newestAvailableDate, normalizeTeeTime } from "./analyze.js";
import { config, sourceRegistry } from "./config.js";
import { formatDailyDigest, formatDealAlert, sendEmail } from "./email.js";
import { loadTeeTimes } from "./source.js";
import { findChangedDeals, nextState, readState, writeState } from "./state.js";

export async function runMonitor({ source, mode = "daily", statePath = "state/tee-times.json", sendBaseline = false, dryRun = true }) {
  const teeTimes = (await loadTeeTimes(source)).map(normalizeTeeTime).filter(teeTime => isEligible(teeTime, config));
  const newestDate = newestAvailableDate(teeTimes);
  const checkedAt = new Date().toISOString();
  const resolvedStatePath = resolve(statePath);
  const previousState = await readState(resolvedStatePath);
  const deals = [...Map.groupBy(teeTimes, teeTime => `${teeTime.course}|${teeTime.date}`).values()]
    .flatMap(times => findPriceBreaks(times, config));
  const changes = findChangedDeals(teeTimes, deals, previousState, config, sendBaseline);
  const hasNewDate = Boolean(newestDate && (!previousState.newestDate || newestDate > previousState.newestDate));
  const message = mode === "daily"
    ? formatDailyDigest(teeTimes, newestDate, config, checkedAt, hasNewDate, sourceRegistry)
    : changes.length ? formatDealAlert(changes, checkedAt) : null;

  if (message) {
    if (dryRun) console.log(`SUBJECT: ${message.subject}\nTO: ${config.recipient}\n\n${message.body}`);
    else await sendEmail(message, config.recipient);
  }
  await writeState(resolvedStatePath, nextState(teeTimes, newestDate, checkedAt));
  return { checkedAt, teeTimes, newestDate, hasNewDate, deals, changes, message, dryRun };
}