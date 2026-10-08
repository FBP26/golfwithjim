import { shortCourseName } from "./dashboard.js";

const dayFormatter = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const dollars = value => `$${Number(value).toFixed(2).replace(/\.00$/, "")}`;

export function pushDate(date, time) {
  return `${dayFormatter.format(new Date(`${date}T12:00:00Z`)).replace(",", "").replace(/^Thu /, "Thur, ").replace(/^(\w+) /, "$1, ").replace("Sep ", "Sept ")} ${time}`;
}

export function pushNotice(matches, rules, resultId) {
  const matchedRules = rules.filter(rule => matches.some(match => match.ruleId === rule.id));
  let title = matchedRules.length === 1 ? matchedRules[0].name || "Tee Time Alert" : "Tee Time Alerts";
  if (title.length > 64) title = "Tee Time Alerts";
  const unique = [...new Map(matches.map(({ teeTime }) => [`${teeTime.course}|${teeTime.date}|${teeTime.time}|${teeTime.allInPrice}|${teeTime.source}|${teeTime.rateName}`, teeTime])).values()]
    .toSorted((left, right) => left.date.localeCompare(right.date) || left.time.localeCompare(right.time) || left.allInPrice - right.allInPrice);
  const dates = [...new Set(unique.map(teeTime => teeTime.date))];
  const starts = new Set(unique.map(teeTime => `${teeTime.course}|${teeTime.date}|${teeTime.time}`)).size;
  const firstDate = pushDate(dates[0], "").trim();
  const dateSummary = dates.length === 1
    ? `${firstDate} · ${starts} tee time${starts === 1 ? "" : "s"}`
    : `${firstDate} + ${dates.length - 1} day${dates.length === 2 ? "" : "s"} · ${starts} tee times`;
  const lines = unique.map(teeTime => `${dates.length > 1 ? `${pushDate(teeTime.date, "").trim()} · ` : ""}${shortCourseName(teeTime.course)}: ${teeTime.time} · ${dollars(teeTime.allInPrice)} · ${teeTime.availablePlayers} spots`);
  const notification = { title, body: "", tag: `golf-${resultId}`, url: `./?notification=${resultId}` };
  const selected = [dateSummary];
  for (const line of lines) {
    const candidate = [...selected, line].join("\n");
    if (new TextEncoder().encode(JSON.stringify({ ...notification, body: `${candidate}\n+${lines.length - selected.length + 1} more` })).length > 3800) break;
    selected.push(line);
  }
  const displayed = selected.length - 1;
  notification.body = selected.join("\n") + (displayed < lines.length ? `\n+${lines.length - displayed} more` : "");
  return notification;
}