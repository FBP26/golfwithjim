import { runMonitor } from "./monitor.js";

const argument = name => process.argv.find(value => value.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const source = argument("source") || process.env.GOLF_FEED_URL;
if (!source) throw new Error("Set GOLF_FEED_URL to a permitted JSON feed or pass --source=<url-or-file>.");
const mode = argument("mode") || "daily";

const result = await runMonitor({
  source,
  mode,
  statePath: argument("state") || `state/${mode}.json`,
  sendBaseline: process.argv.includes("--send-baseline"),
  dryRun: !process.argv.includes("--send"),
});
console.log(`Checked ${result.teeTimes.length} eligible tee time(s) through ${result.newestDate}; ${result.changes.length} deal change(s).`);