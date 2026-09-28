import { shortCourseName } from "./dashboard.js";

const dayFormatter = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const dollars = value => `$${Number(value).toFixed(2).replace(/\.00$/, "")}`;

export function pushDate(date, time) {
  return `${dayFormatter.format(new Date(`${date}T12:00:00Z`)).replace(",", "").replace(/^Thu /, "Thur, ").replace(/^(\w+) /, "$1, ").replace("Sep ", "Sept ")} ${time}`;
}

export function pushNotice(matches, rules, resultId) {
  const matchedRules = rules.filter(rule => matches.some(match => match.ruleId === rule.id));
  let title = "Tee Time Alerts";
  if (matchedRules.length && matchedRules.every(rule => rule.hotDealsOnly)) title = "Hot Deals Alert";
  else if (matchedRules.length === 1 && !matchedRules[0].course.startsWith("group:")) {
    const rule = matchedRules[0];
    const limit = rule.maxPrice;
    const qualifier = limit !== null ? (Number.isInteger(limit) ? `up to ${dollars(limit)}` : `under ${dollars(Math.ceil(limit))}`)
      : rule.days.length && rule.days.every(day => [0, 5, 6].includes(day)) ? "weekend" : "tee times";
    title = `${shortCourseName(rule.course)} ${qualifier}`;
  }
  if (title.length > 64) title = "Tee Time Alerts";
  const lines = [...new Set(matches.map(({ teeTime }) => `${shortCourseName(teeTime.course)}: ${dollars(teeTime.allInPrice)} ${pushDate(teeTime.date, teeTime.time)}`))];
  const notification = { title, body: "", tag: `golf-${resultId}`, url: `./?notification=${resultId}` };
  const selected = [];
  for (const line of lines) {
    const candidate = [...selected, line].join("\n");
    if (new TextEncoder().encode(JSON.stringify({ ...notification, body: `${candidate}\n+${lines.length} more` })).length > 3800) break;
    selected.push(line);
  }
  notification.body = selected.join("\n") + (selected.length < lines.length ? `\n+${lines.length - selected.length} more` : "");
  return notification;
}