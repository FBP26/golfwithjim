const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
})[character]);

const money = value => `$${value.toFixed(2)}`;
const benefits = teeTime => [
  teeTime.hotDeal ? "HD" : null,
  teeTime.golfPassEligible ? "GP+" : null,
  teeTime.feesWaived ? "fees waived" : null,
].filter(Boolean).join(", ");
const link = teeTime => teeTime.url
  ? `<a href="${escapeHtml(teeTime.url)}">${escapeHtml(teeTime.time)}</a>`
  : escapeHtml(teeTime.time);

const dateLabel = date => new Intl.DateTimeFormat("en-US", { weekday: "short", month: "numeric", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));

function calendarDates(checkedAt, count) {
  const start = new Date(checkedAt);
  return Array.from({ length: count }, (_, offset) => {
    const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + offset));
    return date.toISOString().slice(0, 10);
  });
}

function dailyUrl(source, date) {
  if (!source?.url) return "";
  const compactDate = date.replaceAll("-", "");
  const [year, month, day] = date.split("-");
  if (source.source?.includes("Play18")) return `${source.url}?teedate=${compactDate}`;
  if (source.source === "Chronogolf") return `${source.url}${source.url.includes("?") ? "&" : "?"}date=${date}`;
  if (source.source === "ForeUp") return `${source.url.split("#")[0]}?date=${month}-${day}-${year}#/teetimes`;
  if (source.source === "Club Caddie") return `${source.url}/slots?date=${month}%2F${day}%2F${year}&player=2&holes=18&ratetype=any`;
  if (source.source === "GolfNow Marketplace") return `${source.url.split("#")[0]}#date=${date}`;
  if (source.source?.includes("TeeItUp")) return `${source.url}${source.url.includes("?") ? "&" : "?"}date=${date}`;
  if (source.source === "TeeSnap") return `${source.url}${source.url.includes("?") ? "&" : "?"}date=${date}`;
  return source.url;
}

function courseLink(source, date, label = source.course) {
  const url = dailyUrl(source, date);
  return url ? `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>` : escapeHtml(label);
}

function groupBy(items, key) {
  return Map.groupBy(items, typeof key === "function" ? key : item => item[key]);
}

function timeMinutes(time) {
  const match = time.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return Number.POSITIVE_INFINITY;
  return (Number(match[1]) % 12 + (match[3].toUpperCase() === "PM" ? 12 : 0)) * 60 + Number(match[2]);
}

function compactTime(time) {
  return time.replace(/:00\s*/i, "").replace(/\s*AM$/i, "a").replace(/\s*PM$/i, "p");
}

function summarizeTimes(times) {
  const sorted = [...new Map(times
    .toSorted((left, right) => timeMinutes(left.time) - timeMinutes(right.time))
    .map(teeTime => [timeMinutes(teeTime.time), teeTime])).values()];
  const summaries = [];
  for (let index = 0; index < sorted.length;) {
    const interval = sorted[index + 1]
      ? timeMinutes(sorted[index + 1].time) - timeMinutes(sorted[index].time)
      : 0;
    let end = index + 1;
    while (interval > 0 && end + 1 < sorted.length
      && timeMinutes(sorted[end + 1].time) - timeMinutes(sorted[end].time) === interval) end += 1;
    if (end - index >= 2) {
      summaries.push(`${compactTime(sorted[index].time)}-${compactTime(sorted[end].time)}`);
      index = end + 1;
    } else {
      summaries.push(compactTime(sorted[index].time));
      index += 1;
    }
  }
  return summaries.join(" · ");
}

function typicalSpacing(times) {
  const minutes = [...new Set(times.map(teeTime => timeMinutes(teeTime.time)).filter(Number.isFinite))].sort((left, right) => left - right);
  const intervals = minutes.slice(1).map((minute, index) => minute - minutes[index]).filter(interval => interval > 0 && interval <= 20);
  if (!intervals.length) return "";
  const counts = Map.groupBy(intervals, interval => interval);
  const spacing = [...counts].toSorted((left, right) => right[1].length - left[1].length || left[0] - right[0])[0][0];
  return `Every ${spacing} min`;
}

function priceGroups(times) {
  return [...groupBy(times, teeTime => teeTime.allInPrice)]
    .toSorted((left, right) => Math.min(...left[1].map(teeTime => timeMinutes(teeTime.time)))
      - Math.min(...right[1].map(teeTime => timeMinutes(teeTime.time))) || left[0] - right[0]);
}

function rateColumn(times) {
  if (!times.length) return "-";
  return priceGroups(times).map(([price, groupedTimes]) => {
    const labels = [...new Set(groupedTimes.flatMap(teeTime => benefits(teeTime).split(", ")).filter(label => label && label !== "HD"))];
    return `<b>${money(price)}</b>${labels.length ? ` <span class="benefit">${escapeHtml(labels.join(", "))}</span>` : ""}<br>${escapeHtml(summarizeTimes(groupedTimes))}`;
  }).join("<br>");
}

function coverage(registry) {
  const online = registry.interactiveOnly || [];
  const deals = registry.dealSources || [];
  const manual = registry.manualOnly || [];
  const names = new Set([...online, ...deals, ...manual].map(source => source.course));
  return { online, deals, manual, total: names.size };
}

function sourceLinks(sources) {
  return sources.map(source => source.url
    ? `<a href="${escapeHtml(source.url)}">${escapeHtml(source.course)}</a>`
    : escapeHtml(source.course)).join(" · ");
}

export function formatDailyDigest(teeTimes, newestDate, config, checkedAt, hasNewDate = false, registry = {}) {
  const detailedDates = calendarDates(checkedAt, config.detailedDays);
  const sourceCoverage = coverage(registry);
  const reportSources = sourceCoverage.online.filter(source => !source.closed && source.showInventory !== false);
  const linkOnlySources = sourceCoverage.online.filter(source => source.showInventory === false);
  const sourceByCourse = new Map(reportSources.map(source => [source.course, source]));
  const reportTeeTimes = teeTimes.filter(teeTime => sourceByCourse.has(teeTime.course));
  const laterDates = [...new Set(reportTeeTimes.map(teeTime => teeTime.date))].sort().filter(date => date > detailedDates.at(-1));
  const courses = [...new Set(reportTeeTimes.map(teeTime => teeTime.course))].sort();
  const pricedCourseDays = new Set(reportTeeTimes.map(teeTime => `${teeTime.course}|${teeTime.date}`)).size;
  const byDate = groupBy(reportTeeTimes, "date");
  const dailyTables = detailedDates.map(date => {
    const dateTimes = (byDate.get(date) || []).filter(teeTime => teeTime.holes === config.preferredHoles);
    const rows = reportSources.map(source => {
      const times = dateTimes.filter(teeTime => teeTime.course === source.course);
      if (!times.length) return "";
      const spacing = typicalSpacing(times);
      const regular = times.filter(teeTime => !teeTime.hotDeal);
      const hotDeals = times.filter(teeTime => teeTime.hotDeal);
      return `<tr><th class="course">${courseLink(source, date)}${spacing ? `<small>${escapeHtml(spacing)}</small>` : ""}</th><td>${rateColumn(regular)}</td><td>${rateColumn(hotDeals)}</td></tr>`;
    }).join("");
    return `<h3>${escapeHtml(dateLabel(date))}</h3>${rows ? `<table class="availability"><thead><tr><th>Course</th><th>Regular</th><th>Hot Deals</th></tr></thead><tbody>${rows}</tbody></table>` : `<p class="muted">No exact 18-hole prices captured for this day.</p>`}`;
  }).join("");
  const newest = (byDate.get(newestDate) || []).filter(teeTime => teeTime.holes === config.preferredHoles);
  const newestRows = [...groupBy(newest, "course")].map(([course, times]) => {
    const sorted = times.toSorted((left, right) => left.allInPrice - right.allInPrice);
    const best = sorted[0];
    return `<tr><td style="padding:6px;border:1px solid #d0d5dd">${escapeHtml(course)}</td><td style="padding:6px;border:1px solid #d0d5dd">${link(best)}</td><td style="padding:6px;border:1px solid #d0d5dd">${money(best.allInPrice)}</td><td style="padding:6px;border:1px solid #d0d5dd">${escapeHtml(benefits(best) || "-")}</td><td style="padding:6px;border:1px solid #d0d5dd">${best.availablePlayers}</td><td style="padding:6px;border:1px solid #d0d5dd">${escapeHtml(best.source)}</td></tr>`;
  }).join("");
  const laterSummary = laterDates.length
    ? `<p><b>Later inventory:</b> ${escapeHtml(laterDates[0])} through ${escapeHtml(laterDates.at(-1))} (${laterDates.length} additional day${laterDates.length === 1 ? "" : "s"}).</p>`
    : "";
  const dealRows = sourceCoverage.deals.map(deal => `<li><a href="${escapeHtml(deal.url)}"><b>${escapeHtml(deal.course)}</b></a>: ${money(Number(deal.price))} for ${deal.players}, ${deal.holes} holes${deal.cartIncluded ? " with cart" : ""}. ${escapeHtml(deal.restrictions || "")}</li>`).join("");
  const newLabel = hasNewDate ? " <b>NEW</b>" : "";
  const linkOnlyRows = sourceLinks(linkOnlySources);
  const brookwoods = sourceCoverage.manual.find(source => source.course === "Brookwoods Golf Club");
  const manualRow = brookwoods ? `<p><b>${escapeHtml(brookwoods.course)}:</b> <a href="tel:${escapeHtml(brookwoods.phone)}">${escapeHtml(brookwoods.phone)}</a></p>` : "";
  const htmlBody = `<style>.golf{font:14px/1.4 Arial,sans-serif;color:#182230;max-width:1000px}.hero{background:#12372a;color:#fff;padding:14px 16px}.hero h2{margin:0 0 3px}.golf table{border-collapse:collapse;width:100%}.golf h3{margin:14px 0 4px}.availability th,.availability td{padding:5px;border:1px solid #d0d5dd;vertical-align:top}.availability thead th{background:#f2f4f7}.course{text-align:left;width:23%}.course small{color:#667085;display:block;font-weight:normal}.benefit{color:#b54708}.muted{color:#667085}.fine{font-size:12px}</style><div class="golf"><div class="hero"><h2>Richmond golf morning report</h2><div>${pricedCourseDays} priced course-days · ${courses.length} course${courses.length === 1 ? "" : "s"} with exact 18-hole prices</div></div><p><b>Newest posted day:</b> ${escapeHtml(newestDate || "None")}${newLabel} &nbsp; <b>Search:</b> ${config.minimumPlayers}+ golfers, ${config.preferredHoles} holes, within ${config.maximumDistanceMiles} miles.</p>${dealRows ? `<h3>Separate voucher deals</h3><ul>${dealRows}</ul>` : ""}<h2>Daily availability</h2><p class="muted">Every qualifying start is shown. Repeating starts are condensed into ranges; the linked course name opens booking.</p>${dailyTables}${laterSummary}<h3>Other courses</h3><p>${linkOnlyRows}</p>${manualRow}<p class="muted fine">Only exact bookable 18-hole prices qualify. Junior, military, veteran, senior, resident, and unrelated membership rates are excluded. GP+ = an explicitly identified GolfPass+ benefit. Checked ${escapeHtml(checkedAt)}.</p></div>`;
  const body = `Richmond golf morning report\n\n${sourceCoverage.total} nearby courses: ${sourceCoverage.online.length} online tee sheets, ${sourceCoverage.deals.length} deal-only, ${sourceCoverage.manual.length} call/manual.\nCourses with exact 18-hole prices: ${courses.length}\nPriced course-days: ${pricedCourseDays}\nNewest posted day: ${newestDate || "None"}${hasNewDate ? " (NEW)" : ""}\n\nChecked: ${checkedAt}`;
  return { subject: `Richmond golf: ${courses.length} priced courses through ${newestDate || "today"}`, body, htmlBody };
}

export function formatDealAlert(changes, checkedAt) {
  const rows = changes.map(({ kind, teeTime, previousPrice }) => `<tr><td style="padding:7px;border:1px solid #d0d5dd">${escapeHtml(kind)}</td><td style="padding:7px;border:1px solid #d0d5dd">${escapeHtml(teeTime.course)}</td><td style="padding:7px;border:1px solid #d0d5dd">${escapeHtml(teeTime.date)}</td><td style="padding:7px;border:1px solid #d0d5dd">${link(teeTime)}</td><td style="padding:7px;border:1px solid #d0d5dd">${money(teeTime.allInPrice)}${previousPrice ? ` (was ${money(previousPrice)})` : ""}</td><td style="padding:7px;border:1px solid #d0d5dd">${escapeHtml(benefits(teeTime) || "-")}</td></tr>`).join("");
  return {
    subject: `Richmond golf deal alert: ${changes.length} match${changes.length === 1 ? "" : "es"}`,
    body: changes.map(({ kind, teeTime }) => `${kind}: ${teeTime.course}, ${teeTime.date} ${teeTime.time}, ${money(teeTime.allInPrice)}`).join("\n"),
    htmlBody: `<div style="font:14px/1.4 Arial,sans-serif;color:#171e26;max-width:800px"><h2>Richmond golf deal alert</h2><table style="border-collapse:collapse;width:100%"><thead><tr><th>Why</th><th>Course</th><th>Date</th><th>Time</th><th>Price</th><th>Benefits</th></tr></thead><tbody>${rows}</tbody></table><p style="color:#667085;font-size:12px">Checked ${escapeHtml(checkedAt)}.</p></div>`,
  };
}

export async function sendEmail(message, to) {
  const relayUrl = String(process.env.EMAIL_RELAY_URL || "").trim();
  const relaySecret = String(process.env.EMAIL_RELAY_SECRET || "").trim();
  if (!relayUrl || !relaySecret) throw new Error("EMAIL_RELAY_URL and EMAIL_RELAY_SECRET are required.");
  const response = await fetch(relayUrl, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body: JSON.stringify({ action: "send-notification-email", secret: relaySecret, to, ...message }),
    signal: AbortSignal.timeout(20_000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.ok !== true) throw new Error(`Email relay failed: ${result?.error || response.status}`);
}