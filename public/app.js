import { filterTeeTimes, summarizeResults } from "./src/dashboard.js";

const isGitHubPages = location.hostname.endsWith(".github.io");
const staticFeedUrl = "./api/tee-times.json";
const refreshBridgeUrl = "https://golfwithjim-refresh.fbp-api-worker.workers.dev/refresh";

const state = {
  teeTimes: [], courses: [], sourceChecks: [], date: "", players: 2, earliest: "05:00", latest: "20:00",
  maximumDistance: 75, maximumPrice: Infinity, exactPrice: null, hotDealsOnly: false, course: "", sort: "price", checkedAt: "",
};

const elements = Object.fromEntries([
  "date-options", "distance", "distance-output", "price", "price-output", "earliest", "earliest-output", "latest", "latest-output",
  "hot-deals", "course-search", "sort", "results", "metrics", "results-title", "feed-status",
  "refresh", "refresh-label", "clear-filters", "players-filter", "course-directory", "expand-results", "collapse-results",
].map(id => [id, document.getElementById(id)]));

const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
})[character]);
const money = value => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: value % 1 ? 2 : 0 }).format(value);
const dateLabel = date => new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
const shortDate = date => new Intl.DateTimeFormat("en-US", { weekday: "short", month: "numeric", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
const timeValue = time => {
  const match = time.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  return (Number(match?.[1] || 0) % 12 + (match?.[3]?.toUpperCase() === "PM" ? 12 : 0)) * 60 + Number(match?.[2] || 0);
};
const sliderTime = minutes => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const timeLabel = minutes => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(new Date(Date.UTC(2020, 0, 1, 0, Number(minutes))));

function updateTimeWindow(changed) {
  let earliest = Number(elements.earliest.value);
  let latest = Number(elements.latest.value);
  if (earliest > latest) {
    if (changed === "earliest") latest = earliest;
    else earliest = latest;
  }
  elements.earliest.value = earliest;
  elements.latest.value = latest;
  elements["earliest-output"].value = timeLabel(earliest);
  elements["latest-output"].value = timeLabel(latest);
  state.earliest = sliderTime(earliest);
  state.latest = sliderTime(latest);
  renderResults();
}

function dateUrl(url, date) {
  if (!url) return "";
  if (/([?&])date=/.test(url)) return url.replace(/([?&]date=)[^&#]*/i, `$1${date}`);
  return `${url}${url.includes("?") ? "&" : "?"}date=${date}`;
}

function metricsHtml(summary) {
  const lowestPrice = state.exactPrice ?? summary.lowestPrice;
  return [
    `<div class="metric"><span>Tee times</span><strong>${summary.starts}</strong></div>`,
    `<div class="metric"><span>Courses</span><strong>${summary.courses}</strong></div>`,
    `<button class="metric metric-action${state.hotDealsOnly ? " active" : ""}" type="button" data-metric-filter="hot" aria-pressed="${state.hotDealsOnly}"><span>Hot Deals</span><strong>${summary.hotDeals}</strong></button>`,
    `<button class="metric metric-action${state.exactPrice != null ? " active" : ""}" type="button" data-metric-filter="price" data-price="${lowestPrice ?? ""}" aria-pressed="${state.exactPrice != null}"${lowestPrice == null ? " disabled" : ""}><span>From</span><strong>${lowestPrice == null ? "-" : money(lowestPrice)}</strong></button>`,
  ].join("");
}

function sortResults(teeTimes) {
  return teeTimes.toSorted((left, right) => timeValue(left.time) - timeValue(right.time) || left.allInPrice - right.allInPrice);
}

function sortCourseGroups(groups) {
  const value = times => {
    if (state.sort === "price") return Math.min(...times.map(teeTime => teeTime.allInPrice));
    if (state.sort === "distance") return Math.min(...times.map(teeTime => teeTime.distanceMiles));
    if (state.sort === "course") return times[0].course;
    return Math.min(...times.map(teeTime => timeValue(teeTime.time)));
  };
  return [...groups].toSorted((left, right) => {
    const leftValue = value(left[1]);
    const rightValue = value(right[1]);
    return typeof leftValue === "number"
      ? leftValue - rightValue || left[0].localeCompare(right[0])
      : leftValue.localeCompare(rightValue);
  });
}

function trackedCoursesHtml(filtered) {
  const visible = new Set(filtered.map(teeTime => teeTime.course));
  const checks = new Map(state.sourceChecks.map(check => [check.course, check]));
  const courses = state.courses
    .filter(course => course.watchlist && !visible.has(course.course))
    .filter(course => !state.course || course.course.toLowerCase().includes(state.course))
    .filter(course => course.distanceMiles <= state.maximumDistance);
  if (!courses.length) return "";
  const rows = courses.map(course => {
    const check = checks.get(course.course);
    let status = "Booking link only";
    if (/private/i.test(course.source)) status = "Private club · booking link";
    else if (check?.error) status = "Latest check unavailable · booking link";
    else if (check) status = state.date ? "No qualifying tee times for this date" : "No qualifying tee times in latest check";
    return `<div class="tracked-course"><span><strong>${escapeHtml(course.course)}</strong><small>${course.distanceMiles} miles · ${escapeHtml(status)}</small></span><a href="${escapeHtml(dateUrl(course.url, state.date))}" target="_blank" rel="noopener">Check course</a></div>`;
  }).join("");
  return `<section class="tracked-group"><div><p class="eyebrow">Also tracked</p><h3>Courses without matching inventory</h3></div>${rows}</section>`;
}

function renderResults() {
  let filtered = filterTeeTimes(state.teeTimes, state);
  if (state.course) filtered = filtered.filter(teeTime => teeTime.course.toLowerCase().includes(state.course));
  if (state.exactPrice != null) filtered = filtered.filter(teeTime => Math.abs(teeTime.allInPrice - state.exactPrice) < 0.001);
  elements.metrics.innerHTML = metricsHtml(summarizeResults(filtered));
  elements["results-title"].textContent = state.date ? dateLabel(state.date) : "All tee times";
  if (!filtered.length) {
    elements.results.innerHTML = `<div class="empty">No tee times match these filters.</div>${trackedCoursesHtml(filtered)}`;
    return;
  }

  const byDate = Map.groupBy(filtered, teeTime => teeTime.date);
  elements.results.innerHTML = [...byDate].map(([date, dateTimes]) => {
    const byCourse = Map.groupBy(dateTimes, teeTime => teeTime.course);
    const courseRows = sortCourseGroups(byCourse).map(([course, courseTimes]) => {
      const ordered = sortResults(courseTimes);
      const first = ordered[0];
      const chronological = courseTimes.toSorted((left, right) => timeValue(left.time) - timeValue(right.time));
      const lowestPrice = Math.min(...courseTimes.map(teeTime => teeTime.allInPrice));
      const timeRange = chronological.length === 1 ? chronological[0].time : `${chronological[0].time} - ${chronological.at(-1).time}`;
      const dealCount = courseTimes.filter(teeTime => teeTime.hotDeal).length;
      const tiles = ordered.map(teeTime => `<div class="tee-time${teeTime.hotDeal ? " hot" : ""}"><strong>${escapeHtml(teeTime.time)}</strong><span><b>${money(teeTime.allInPrice)}</b>${teeTime.hotDeal ? '<em class="deal-label">Hot Deal</em>' : `${teeTime.availablePlayers} spots`}</span></div>`).join("");
      const inventorySummary = courseTimes.length === 1
        ? escapeHtml(timeRange)
        : `${escapeHtml(timeRange)} · ${courseTimes.length} tee times`;
      return `<details class="course-row"><summary><span class="course-info"><span class="course-name">${escapeHtml(course)}</span><small>${first.distanceMiles} miles · ${escapeHtml(first.source)}</small></span><span class="course-summary"><strong>From ${money(lowestPrice)}</strong><small>${inventorySummary}${dealCount ? ` · ${dealCount} Hot Deal${dealCount === 1 ? "" : "s"}` : ""}</small></span></summary><div class="course-times"><a class="booking-link" href="${escapeHtml(dateUrl(first.url, date))}" target="_blank" rel="noopener">${escapeHtml(course)}</a><div class="tee-list">${tiles}</div></div></details>`;
    }).join("");
    return `<details class="date-group" open><summary class="date-heading"><span><strong>${escapeHtml(dateLabel(date))}</strong><small>${byCourse.size} course${byCourse.size === 1 ? "" : "s"}</small></span><em>${dateTimes.length} tee time${dateTimes.length === 1 ? "" : "s"}</em></summary><div class="date-courses">${courseRows}</div></details>`;
  }).join("") + trackedCoursesHtml(filtered);
}

function renderDates() {
  const availableDates = [...new Set(state.teeTimes.map(teeTime => teeTime.date))].sort();
  const dates = [];
  if (availableDates.length) {
    const current = new Date(`${availableDates[0]}T12:00:00Z`);
    const last = availableDates.at(-1);
    while (current.toISOString().slice(0, 10) <= last) {
      dates.push(current.toISOString().slice(0, 10));
      current.setUTCDate(current.getUTCDate() + 1);
    }
  }
  elements["date-options"].innerHTML = dates.map(date => {
    const [weekday, calendar] = shortDate(date).split(", ");
    return `<button class="date-option" data-date="${date}"><strong>${weekday}</strong>${calendar}</button>`;
  }).join("");
}

function renderDirectory() {
  const inventoryCourses = new Set(state.teeTimes.map(teeTime => teeTime.course));
  elements["course-directory"].innerHTML = state.courses.toSorted((left, right) => left.distanceMiles - right.distanceMiles || left.course.localeCompare(right.course)).map(course =>
    `<div class="directory-course"><a href="${escapeHtml(course.url)}" target="_blank" rel="noopener">${escapeHtml(course.course)}</a><small>${course.distanceMiles} miles · ${inventoryCourses.has(course.course) ? "inventory connected" : course.source}</small></div>`).join("");
}

function selectDate(date) {
  state.date = date;
  document.querySelectorAll(".date-option").forEach(button => button.classList.toggle("active", button.dataset.date === date));
  renderResults();
}

async function loadInventory({ liveRefresh = false } = {}) {
  elements.refresh.classList.add("refreshing");
  elements.refresh.disabled = true;
  elements["refresh-label"].textContent = liveRefresh ? "Refreshing tee times - this can take 1-3 minutes" : "Loading tee times";
  elements.results.setAttribute("aria-busy", "true");
  elements["feed-status"].textContent = liveRefresh ? "Checking all live sources..." : "Loading live sources";
  try {
    let response;
    if (liveRefresh && isGitHubPages) {
      response = await fetch(refreshBridgeUrl, { method: "POST" });
      if (!response.ok) throw new Error(`Refresh request returned HTTP ${response.status}`);
      const previousCheckedAt = state.checkedAt;
      const deadline = Date.now() + 6 * 60_000;
      do {
        await new Promise(resolve => setTimeout(resolve, 10_000));
        response = await fetch(`${staticFeedUrl}?refresh=${Date.now()}`, { cache: "no-store" });
        if (!response.ok) throw new Error(`Inventory returned HTTP ${response.status}`);
        const candidate = await response.clone().json();
        if (candidate.checkedAt && candidate.checkedAt !== previousCheckedAt) break;
      } while (Date.now() < deadline);
    } else {
      const endpoint = isGitHubPages
        ? `${staticFeedUrl}?refresh=${Date.now()}`
        : liveRefresh ? "/api/tee-times/refresh" : `/api/tee-times?refresh=${Date.now()}`;
      response = await fetch(endpoint, { method: liveRefresh ? "POST" : "GET", cache: "no-store" });
    }
    if (!response.ok) throw new Error(`Inventory returned HTTP ${response.status}`);
    const payload = await response.json();
    if (liveRefresh && isGitHubPages && payload.checkedAt === state.checkedAt) throw new Error("Refresh is still running. Try again shortly.");
    state.checkedAt = payload.checkedAt;
    state.teeTimes = payload.teeTimes;
    state.courses = payload.courses;
    state.sourceChecks = payload.sourceChecks;
    renderDates();
    renderDirectory();
    selectDate(state.date);
    const checked = new Date(payload.checkedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const liveSources = payload.sourceChecks.filter(check => !check.error).length;
    elements["feed-status"].textContent = `(${liveSources} live sources) - ${checked}`;
  } catch (error) {
    elements.results.innerHTML = `<div class="empty">Could not load tee times. ${escapeHtml(error.message)}</div>`;
    elements["feed-status"].textContent = "Inventory unavailable";
  } finally {
    elements.refresh.classList.remove("refreshing");
    elements.refresh.disabled = false;
    elements["refresh-label"].textContent = "Click to refresh tee times";
    elements.results.removeAttribute("aria-busy");
  }
}

document.querySelector(".date-strip").addEventListener("click", event => {
  const button = event.target.closest("[data-date]");
  if (button) selectDate(button.dataset.date);
});
elements["players-filter"].addEventListener("click", event => {
  const button = event.target.closest("[data-players]");
  if (!button) return;
  state.players = Number(button.dataset.players);
  elements["players-filter"].querySelectorAll("button").forEach(item => item.classList.toggle("active", item === button));
  renderResults();
});
elements.distance.addEventListener("input", () => { state.maximumDistance = Number(elements.distance.value); elements["distance-output"].value = `${state.maximumDistance} miles`; renderResults(); });
elements.price.addEventListener("input", () => { state.maximumPrice = Number(elements.price.value) === 160 ? Infinity : Number(elements.price.value); state.exactPrice = null; elements["price-output"].value = Number.isFinite(state.maximumPrice) ? money(state.maximumPrice) : "Any"; renderResults(); });
elements.earliest.addEventListener("input", () => updateTimeWindow("earliest"));
elements.latest.addEventListener("input", () => updateTimeWindow("latest"));
elements["hot-deals"].addEventListener("change", () => { state.hotDealsOnly = elements["hot-deals"].checked; renderResults(); });
elements.metrics.addEventListener("click", event => {
  const button = event.target.closest("[data-metric-filter]");
  if (!button) return;
  if (button.dataset.metricFilter === "hot") {
    state.hotDealsOnly = !state.hotDealsOnly;
    elements["hot-deals"].checked = state.hotDealsOnly;
  } else {
    state.exactPrice = state.exactPrice == null ? Number(button.dataset.price) : null;
  }
  renderResults();
});
elements["course-search"].addEventListener("input", () => { state.course = elements["course-search"].value.trim().toLowerCase(); renderResults(); });
elements.sort.addEventListener("change", () => { state.sort = elements.sort.value; renderResults(); });
elements["expand-results"].addEventListener("click", () => elements.results.querySelectorAll("details").forEach(details => { details.open = true; }));
elements["collapse-results"].addEventListener("click", () => elements.results.querySelectorAll("details").forEach(details => { details.open = false; }));
elements.refresh.addEventListener("click", () => loadInventory({ liveRefresh: true }));
elements["clear-filters"].addEventListener("click", () => {
  state.players = 2; state.earliest = "05:00"; state.latest = "20:00"; state.maximumDistance = 75;
  state.maximumPrice = Infinity; state.exactPrice = null; state.hotDealsOnly = false; state.course = ""; state.sort = "price";
  elements.earliest.value = 300; elements.latest.value = 1200; elements.distance.value = 75;
  elements.price.value = 160; elements["hot-deals"].checked = false; elements["course-search"].value = ""; elements.sort.value = "price";
  elements["earliest-output"].value = "5:00 AM"; elements["latest-output"].value = "8:00 PM";
  elements["distance-output"].value = "75 miles"; elements["price-output"].value = "Any";
  elements["players-filter"].querySelectorAll("button").forEach(button => button.classList.toggle("active", button.dataset.players === "2"));
  selectDate("");
});

loadInventory();