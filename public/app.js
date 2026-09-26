import { filterTeeTimes, summarizeResults, groupTeeTimes, shortCourseName, isMainCourse, haversineMiles, RICHMOND_CENTER, isInventoryUsable, isSelectableCourse, coursesInGroup } from "./src/dashboard.js?v=20260926-stonehouse";

const isGitHubPages = location.hostname.endsWith(".github.io");
const staticFeedUrl = "./api/tee-times.json";
const refreshBridgeUrl = "https://golfwithjim-refresh.fbp-api-worker.workers.dev/refresh";
const notificationId = new URLSearchParams(location.search).get("notification");
document.body.classList.toggle("notification-view", Boolean(notificationId));
document.getElementById("notification-results").hidden = !notificationId;

const state = {
  teeTimes: [], courses: [], sourceChecks: [], date: "", players: 0, earliest: "05:00", latest: "20:00", hiddenCourses: new Set(),
  maximumDistance: 100, maximumPrice: Infinity, exactPrice: null, hotDealsOnly: false, course: "", sort: "price", checkedAt: "",
};

let courseGroup = "local";

const elements = Object.fromEntries([
  "date-options", "earliest", "earliest-output", "latest", "latest-output",
  "sort", "results", "metrics", "feed-status", "course-groups",
  "refresh", "refresh-label", "players-filter", "course-directory", "expand-results", "collapse-results",
  "tab-list", "tab-map", "view-list-container", "view-map-container",
  "map-count", "leaflet-map", "map-date-options",
  "pull-refresh", "pull-refresh-label",
  "course-selection", "course-selection-count", "show-courses", "hide-courses",
  "other-course-directory",
].map(id => [id, document.getElementById(id)]));

const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
})[character]);
const money = value => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
const exactMoney = value => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: value % 1 ? 2 : 0 }).format(value);
const dateLabel = date => new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
const shortDate = date => new Intl.DateTimeFormat("en-US", { weekday: "short", month: "numeric", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
const timeValue = time => {
  const match = time.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  return (Number(match?.[1] || 0) % 12 + (match?.[3]?.toUpperCase() === "PM" ? 12 : 0)) * 60 + Number(match?.[2] || 0);
};
const sliderTime = minutes => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const timeLabel = minutes => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(new Date(Date.UTC(2020, 0, 1, 0, Number(minutes))));

const timeOptions = Array.from({ length: 31 }, (_, index) => 300 + index * 30).map(minutes => `<option value="${minutes}">${timeLabel(minutes)}</option>`).join("");
elements.earliest.innerHTML = elements.latest.innerHTML = timeOptions;
elements.earliest.value = 300;
elements.latest.value = 1200;

function selectableCourses() {
  return dedupeByCourse(state.courses.filter(isSelectableCourse));
}

function applyCourseGroup(group) {
  courseGroup = group;
  const selected = new Set(coursesInGroup(state.courses, group));
  state.hiddenCourses = new Set(state.courses.filter(course => !selected.has(course.course)).map(course => course.course));
  renderCourseSelection();
}

function renderCourseSelection() {
  const courses = selectableCourses();
  elements["course-selection"].innerHTML = courses.toSorted((left, right) => left.course.localeCompare(right.course)).map(course => `<label><input type="checkbox" data-course="${escapeHtml(course.course)}"${state.hiddenCourses.has(course.course) ? "" : " checked"}><span>${escapeHtml(shortCourseName(course.course))}</span></label>`).join("");
  elements["course-selection-count"].textContent = `${courses.filter(course => !state.hiddenCourses.has(course.course)).length} selected`;
  elements["course-groups"].querySelectorAll("button").forEach(button => {
    button.classList.toggle("active", button.dataset.group === courseGroup);
    button.setAttribute("aria-pressed", String(button.dataset.group === courseGroup));
  });
}

function saveCourseSelection() {
  courseGroup = "custom";
  renderCourseSelection();
  renderResults();
}

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

// A course can be tracked through more than one booking source (e.g. GolfNow and its own direct platform).
// GolfPass membership points only accrue when booking through GolfNow, so it wins ties on price.
// Exact match only: the TeeItUp collector's own source label ('GolfNow/TeeItUp') also contains "golfnow"
// but is NOT the GolfNow marketplace, so a loose substring match would misidentify it.
const isGolfNowSource = source => /^golfnow$/i.test(source);

// Human-readable label for a tee time's source, distinguishing GolfNow marketplace listings
// from a course's own direct booking platform (which the TeeItUp collector mislabels as "GolfNow/TeeItUp").
function sourceDisplayLabel(source) {
  if (isGolfNowSource(source)) return "GolfNow";
  if (/teeitup/i.test(source)) return "Course website";
  return source;
}

function bestBookingTeeTime(times) {
  if (!times.length) return null;
  const minPrice = Math.min(...times.map(teeTime => teeTime.allInPrice));
  const cheapest = times.filter(teeTime => teeTime.allInPrice === minPrice);
  return cheapest.find(teeTime => isGolfNowSource(teeTime.source)) || cheapest[0];
}

function dedupeByCourse(courses) {
  const byName = new Map();
  for (const course of courses) {
    const existing = byName.get(course.course);
    if (!existing || (course.collector === "golfnow" && existing.collector !== "golfnow")) byName.set(course.course, course);
  }
  return [...byName.values()];
}

function courseCheckMap(checks) {
  const byName = new Map();
  for (const check of checks) {
    const existing = byName.get(check.course);
    if (!existing || (check.error && !existing.error)) byName.set(check.course, check);
  }
  return byName;
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

function verificationStatus(times) {
  const saved = times.filter(teeTime => teeTime.cacheExpiresAt && teeTime.verifiedAt);
  if (!saved.length) return "";
  const checked = new Date(Math.min(...saved.map(teeTime => Date.parse(teeTime.verifiedAt)))).toLocaleString([], { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
  return `${saved.some(teeTime => teeTime.stale) ? "Cached · " : ""}Last checked ${checked}`;
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
  const checks = courseCheckMap(state.sourceChecks);
  const courses = dedupeByCourse(state.courses)
    .filter(course => course.watchlist && !visible.has(course.course))
    .filter(course => !state.hiddenCourses.has(course.course))
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
  return `<section class="tracked-group"><div><p class="eyebrow">Also tracked</p><h3>Courses with no tee times</h3></div>${rows}</section>`;
}

function renderResults() {
  let filtered = notificationId ? state.teeTimes : filterTeeTimes(state.teeTimes, state);
  if (!notificationId && state.course) filtered = filtered.filter(teeTime => teeTime.course.toLowerCase().includes(state.course));
  if (!notificationId && state.exactPrice != null) filtered = filtered.filter(teeTime => Math.abs(teeTime.allInPrice - state.exactPrice) < 0.001);
  elements.metrics.innerHTML = metricsHtml(summarizeResults(filtered));
  if (notificationId) elements.metrics.querySelectorAll("button").forEach(button => { button.disabled = true; });
  if (!filtered.length) {
    elements.results.innerHTML = `<div class="empty">${notificationId ? "No tee times were saved with this notification." : "No tee times match these filters."}</div>${notificationId ? "" : trackedCoursesHtml(filtered)}`;
    updateMapView();
    return;
  }

  const byDate = Map.groupBy(filtered, teeTime => teeTime.date);
  elements.results.innerHTML = [...byDate].map(([date, dateTimes], dateIndex) => {
    const byCourse = Map.groupBy(dateTimes, teeTime => teeTime.course);
    const courseRows = sortCourseGroups(byCourse).map(([course, courseTimes]) => {
      const ordered = sortResults(courseTimes);
      const first = ordered[0];
      const chronological = courseTimes.toSorted((left, right) => timeValue(left.time) - timeValue(right.time));
      const lowestPrice = Math.min(...courseTimes.map(teeTime => teeTime.allInPrice));
      const highestPrice = Math.max(...courseTimes.map(teeTime => teeTime.allInPrice));
      const starts = groupTeeTimes(ordered);
      const timeRange = chronological.length === 1 ? chronological[0].time : `${chronological[0].time} - ${chronological.at(-1).time}`;
      const tiles = starts.map(start => `<div class="tee-time"><strong>${escapeHtml(start.time)}</strong>${start.offers.map(teeTime => `<a class="tee-offer${teeTime.hotDeal ? " hot" : ""}" href="${escapeHtml(dateUrl(teeTime.url, date))}" target="_blank" rel="noopener"><span><b>${exactMoney(teeTime.allInPrice)}</b><span>${teeTime.availablePlayers} spots</span></span><small>${escapeHtml(sourceDisplayLabel(teeTime.source))} · ${escapeHtml(teeTime.rateName)}${teeTime.hotDeal ? " · Hot Deal" : ""}</small></a>`).join("")}</div>`).join("");
      const inventorySummary = `${escapeHtml(starts.length === 1 ? starts[0].time : timeRange)} · ${starts.length} tee time${starts.length === 1 ? "" : "s"}`;
      const priceRange = lowestPrice === highestPrice ? money(lowestPrice) : `${money(lowestPrice)}–${money(highestPrice)}`;
      return `<details class="course-row"${notificationId ? " open" : ""}><summary><span class="course-name">${escapeHtml(shortCourseName(course))}</span><span class="course-distance">${first.distanceMiles} mi</span><strong class="course-price">${priceRange}</strong><small class="course-window">${inventorySummary}</small></summary><div class="course-times"><a class="booking-link" href="${escapeHtml(dateUrl(bestBookingTeeTime(courseTimes).url, date))}" target="_blank" rel="noopener">${escapeHtml(course)}</a>${verificationStatus(courseTimes) ? `<p class="map-popup-meta">${escapeHtml(verificationStatus(courseTimes))}</p>` : ""}<div class="tee-list">${tiles}</div></div></details>`;
    }).join("");
    const count = groupTeeTimes(dateTimes).length;
    return `<details class="date-group"${notificationId || dateIndex === 0 ? " open" : ""}><summary class="date-heading"><span><strong>${escapeHtml(dateLabel(date))}</strong><small>${byCourse.size} course${byCourse.size === 1 ? "" : "s"}</small></span><em>${count} tee time${count === 1 ? "" : "s"}</em></summary><div class="date-courses">${courseRows}</div></details>`;
  }).join("") + (notificationId ? "" : trackedCoursesHtml(filtered));
  updateMapView();
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
  elements["map-date-options"].innerHTML = elements["date-options"].innerHTML;
}

function renderDirectory() {
  const counts = Map.groupBy(state.teeTimes, teeTime => teeTime.course);
  const checks = courseCheckMap(state.sourceChecks);
  const sorted = dedupeByCourse(state.courses).toSorted((left, right) => left.distanceMiles - right.distanceMiles || left.course.localeCompare(right.course));
  const columns = window.matchMedia("(max-width: 850px)").matches ? 2 : 4;
  const inventoryCourses = new Set(state.courses.filter(isMainCourse).map(course => course.course));
  const directories = [
    ["course-directory", sorted.filter(course => inventoryCourses.has(course.course))],
    ["other-course-directory", sorted.filter(course => !inventoryCourses.has(course.course))],
  ];
  for (const [directoryId, courses] of directories) {
    elements[directoryId].style.setProperty("--directory-rows", Math.ceil(courses.length / columns) || 1);
    elements[directoryId].innerHTML = courses.map(course => {
      const times = counts.get(course.course) || [];
      const check = checks.get(course.course);
      let detail = [course.access, course.holes ? `${course.holes} holes` : "", course.source].filter(Boolean).join(" · ");
      let flagged = false;
      if (course.collector) {
        if (check?.error) { detail = times.some(teeTime => teeTime.stale) ? verificationStatus(times) : "Check failed"; flagged = true; }
        else if (!check) { detail = "Not checked yet"; flagged = true; }
        else { const count = groupTeeTimes(times).length; detail = `${count} tee time${count === 1 ? "" : "s"}`; flagged = count <= 1; }
      }
      const href = bestBookingTeeTime(times)?.url || course.url;
      return `<div class="directory-course${flagged ? " flagged" : ""}"><a href="${escapeHtml(href)}" title="${escapeHtml(course.course)}" target="_blank" rel="noopener">${escapeHtml(shortCourseName(course.course))}</a><small>${course.distanceMiles} miles · ${escapeHtml(detail)}</small></div>`;
    }).join("");
  }
}
window.addEventListener("resize", () => { if (state.courses.length) renderDirectory(); });

function selectDate(date) {
  state.date = date;
  document.querySelectorAll(".date-option").forEach(button => button.classList.toggle("active", button.dataset.date === date));
  renderResults();
}

// ---- Map view ----------------------------------------------------------
const DISTANCE_RING_MILES = [10, 25, 50, 75, 100];
let map = null;
let markerLayer = null;
let userLocationMarker = null;

const courseGroupKey = course => `${course.latitude.toFixed(3)},${course.longitude.toFixed(3)}`;

function pinCategory(times) {
  if (times.some(teeTime => teeTime.hotDeal)) return "hot";
  if (times.length) return "available";
  return "link";
}

function pinIcon(category, label) {
  return L.divIcon({
    className: "golf-pin-wrap",
    html: `<span class="golf-pin golf-pin-${category}"><span class="golf-pin-shape"><span class="golf-pin-glyph">${label}</span></span>${category === "hot" ? '<span class="golf-pin-ring"></span>' : ""}</span>`,
    iconSize: [34, 44], iconAnchor: [17, 40], popupAnchor: [17, -18],
  });
}

function popupTimesTableHtml(times) {
  if (!times.length) return "";
  const showDate = !state.date;
  const showSource = new Set(times.map(teeTime => teeTime.source)).size > 1;
  const ordered = times.toSorted((left, right) => (showDate ? left.date.localeCompare(right.date) : 0) || timeValue(left.time) - timeValue(right.time) || left.allInPrice - right.allInPrice);
  const rows = ordered.map(teeTime => `<tr class="${teeTime.hotDeal ? "hot" : ""}">${showDate ? `<td>${escapeHtml(shortDate(teeTime.date))}</td>` : ""}<td>${escapeHtml(teeTime.time)}</td><td>${exactMoney(teeTime.allInPrice)}</td>${showSource ? `<td>${escapeHtml(sourceDisplayLabel(teeTime.source))}</td>` : ""}<td>${teeTime.availablePlayers}</td></tr>`).join("");
  return `<div class="map-popup-times-wrap"><table class="map-popup-times${showDate ? " has-date" : ""}"><thead><tr>${showDate ? "<th>Date</th>" : ""}<th>Time</th><th>Price</th>${showSource ? "<th>Source</th>" : ""}<th>Spots</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function popupHtml(group, teeTimesByCourse) {
  const rows = group.map(course => {
    const times = teeTimesByCourse.get(course.course) || [];
    const category = pinCategory(times);
    const { starts, hotDeals: dealCount } = summarizeResults(times);
    const status = category === "hot"
      ? `${dealCount} Hot Deal${dealCount === 1 ? "" : "s"} of ${starts} tee time${starts === 1 ? "" : "s"}`
      : category === "available" ? `${starts} tee time${starts === 1 ? "" : "s"}`
      : "No qualifying tee times right now";
    const href = bestBookingTeeTime(times)?.url || course.url;
    return `<div class="map-popup-course"><h4>${escapeHtml(course.course)}</h4><p class="map-popup-meta">${course.distanceMiles} miles · ${escapeHtml(course.source)}</p>${verificationStatus(times) ? `<p class="map-popup-meta">${escapeHtml(verificationStatus(times))}</p>` : ""}<div class="map-popup-status${category === "hot" ? " hot" : ""}"><strong>${escapeHtml(status)}</strong></div>${popupTimesTableHtml(times)}<a class="map-popup-link" href="${escapeHtml(href)}" target="_blank" rel="noopener">Book a tee time &rarr;</a></div>`;
  }).join("");
  return `<div class="map-popup">${rows}</div>`;
}

function ringLabelLatLng(miles) {
  return [RICHMOND_CENTER[0] + miles / 69, RICHMOND_CENTER[1]];
}

L.Popup.prototype._updatePosition = function () {
  if (!this._map) return;
  const point = this._map.containerPointToLayerPoint(this._map.getSize().divideBy(2));
  L.DomUtil.setPosition(this._container, point);
  const height = this._container.offsetHeight || 0;
  this._containerBottom = -Math.round(height / 2);
  this._containerLeft = -Math.round(this._container.offsetWidth / 2);
  this._container.style.bottom = `${this._containerBottom}px`;
  this._container.style.left = `${this._containerLeft}px`;
};

function initMap() {
  if (map) return;
  const streetLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19, subdomains: "abc",
  });
  const satelliteLayer = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    attribution: "Tiles &copy; Esri", maxZoom: 19,
  });
  const terrainLayer = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
    attribution: 'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
    maxZoom: 17, subdomains: "abc",
  });
  map = L.map(elements["leaflet-map"], { scrollWheelZoom: true, layers: [streetLayer] }).setView(RICHMOND_CENTER, 8);
  const LocateControl = L.Control.extend({
    options: { position: "topleft" },
    onAdd() {
      const container = L.DomUtil.create("div", "leaflet-bar leaflet-control");
      const button = L.DomUtil.create("a", "map-locate-button", container);
      button.href = "#";
      button.title = "Find courses near you";
      button.setAttribute("role", "button");
      button.setAttribute("aria-label", "Find courses near you");
      button.innerHTML = "&#128205;";
      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.on(button, "click", event => { L.DomEvent.preventDefault(event); locateUser(button); });
      return container;
    },
  });
  new LocateControl().addTo(map);
  L.control.layers({ Street: streetLayer, Satellite: satelliteLayer, Terrain: terrainLayer }, null, { position: "topleft" }).addTo(map);

  map.ringLayer = L.layerGroup().addTo(map);
  DISTANCE_RING_MILES.forEach(miles => {
    L.circle(RICHMOND_CENTER, { radius: miles * 1609.34, color: "#d3a53b", weight: 2.5, opacity: .85, fill: true, fillColor: "#d3a53b", fillOpacity: .04, dashArray: "6 8" }).addTo(map.ringLayer);
    L.marker(ringLabelLatLng(miles), { icon: L.divIcon({ className: "map-ring-label", html: `${miles} mi`, iconSize: [40, 16] }), interactive: false }).addTo(map.ringLayer);
  });

  markerLayer = L.layerGroup().addTo(map);
  let activePopup = null;
  map.on("popupopen", event => {
    const popup = event.popup;
    activePopup = popup;
    const popupWidth = Math.max(100, Math.min(300, map.getSize().x - 155));
    popup.options.minWidth = popupWidth;
    popup.options.maxWidth = popupWidth;
    popup.update();
  });
  map.on("popupclose", event => { if (activePopup === event.popup) activePopup = null; });
  map.on("move resize", () => { if (activePopup) activePopup._updatePosition(); });
  requestAnimationFrame(() => map.invalidateSize());
}

function updateMapView() {
  if (!map) return;
  markerLayer.clearLayers();
  const filtered = notificationId ? state.teeTimes : filterTeeTimes(state.teeTimes, state);
  const teeTimesByCourse = Map.groupBy(filtered, teeTime => teeTime.course);
  const searchTerm = state.course;
  const mappable = dedupeByCourse(state.courses).filter(course => course.latitude != null
    && course.distanceMiles <= state.maximumDistance
    && (!searchTerm || course.course.toLowerCase().includes(searchTerm)));
  const groups = new Map();
  mappable.forEach(course => {
    const key = courseGroupKey(course);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(course);
  });

  const selectedLocations = mappable.filter(course => !state.hiddenCourses.has(course.course))
    .map(course => [course.latitude, course.longitude]);
  let visibleCount = 0;
  groups.forEach((group, key) => {
    const primary = group[0];
    const categories = group.map(course => pinCategory(teeTimesByCourse.get(course.course) || []));
    const bestCategory = categories.includes("hot") ? "hot" : categories.includes("available") ? "available" : "link";
    if (bestCategory === "link") return;
    const visibleCourses = group.filter(course => pinCategory(teeTimesByCourse.get(course.course) || []) !== "link");
    const icon = pinIcon(bestCategory, visibleCourses.length > 1 ? String(visibleCourses.length) : "&#9971;");
    const marker = L.marker([primary.latitude, primary.longitude], { icon, autoPanOnFocus: false }).addTo(markerLayer);
    const popupWidth = Math.max(100, Math.min(300, map.getSize().x - 155));
    marker.bindPopup(popupHtml(visibleCourses, teeTimesByCourse), { minWidth: popupWidth, maxWidth: popupWidth, maxHeight: Math.min(320, map.getSize().y - 60), autoPan: false });
    visibleCount += 1;
  });

  elements["map-count"].textContent = `${visibleCount} location${visibleCount === 1 ? "" : "s"}`;
  if (selectedLocations.length) map.fitBounds(selectedLocations, { padding: [30, 48], maxZoom: 11, animate: false });
}

function locateUser(button) {
  if (!navigator.geolocation) { button.title = "Location is not supported in this browser."; return; }
  button.classList.add("active");
  navigator.geolocation.getCurrentPosition(position => {
    const { latitude, longitude } = position.coords;
    if (userLocationMarker) map.removeLayer(userLocationMarker);
    userLocationMarker = L.marker([latitude, longitude], {
      icon: L.divIcon({ className: "user-location-wrap", html: '<span class="user-location-marker"><span class="user-location-ring"></span><span class="user-location-dot"></span></span>', iconSize: [18, 18] }),
      zIndexOffset: 1000,
    }).addTo(map).bindTooltip("You are here", { direction: "top", offset: [0, -6] });
    const distances = dedupeByCourse(state.courses)
      .filter(course => course.latitude != null)
      .map(course => ({ course, miles: haversineMiles(latitude, longitude, course.latitude, course.longitude) }))
      .toSorted((left, right) => left.miles - right.miles)
      .slice(0, 3);
    if (distances.length) {
      const summary = distances.map(entry => `${entry.course.course} (${entry.miles.toFixed(1)} mi)`).join(", ");
      button.title = `Nearest to you: ${summary}`;
    }
    map.flyTo([latitude, longitude], 10, { duration: .6 });
    button.classList.remove("active");
  }, () => {
    button.classList.remove("active");
    button.title = "Location access was denied or unavailable.";
  }, { enableHighAccuracy: true, timeout: 10_000 });
}

function setActiveTab(view) {
  const showMap = view === "map";
  elements["tab-list"].classList.toggle("active", !showMap);
  elements["tab-map"].classList.toggle("active", showMap);
  elements[showMap ? "tab-map" : "tab-list"].setAttribute("aria-current", "page");
  elements[showMap ? "tab-list" : "tab-map"].removeAttribute("aria-current");
  const url = new URL(location.href);
  if (showMap) url.searchParams.set("view", "map");
  else url.searchParams.delete("view");
  history.replaceState(null, "", url);
  elements["view-list-container"].classList.toggle("map-view-hidden", showMap);
  elements["view-map-container"].classList.toggle("map-view-hidden", !showMap);
  if (showMap) {
    initMap();
    updateMapView();
    requestAnimationFrame(() => map.invalidateSize());
  }
}
elements["tab-list"].addEventListener("click", event => { event.preventDefault(); setActiveTab("list"); });
elements["tab-map"].addEventListener("click", event => { event.preventDefault(); setActiveTab("map"); });
window.addEventListener("resize", () => { if (map && !elements["view-map-container"].classList.contains("map-view-hidden")) map.invalidateSize(); });
// -------------------------------------------------------------------------

async function loadInventory({ liveRefresh = false } = {}) {
  elements.refresh.classList.add("refreshing");
  elements.refresh.disabled = true;
  elements["refresh-label"].textContent = liveRefresh ? "Refreshing tee times" : "Loading tee times";
  elements.results.setAttribute("aria-busy", "true");
  elements["feed-status"].textContent = liveRefresh ? "Checking all live sources..." : "Loading live sources";
  try {
    let response;
    if (notificationId) {
      response = await fetch(`https://golfwithjim-alerts.fbp-api-worker.workers.dev/push/results/${encodeURIComponent(notificationId)}`, { cache: "no-store", signal: AbortSignal.timeout(20000) });
    } else if (liveRefresh && isGitHubPages) {
      response = await fetch(refreshBridgeUrl, { method: "POST" });
      if (!response.ok) throw new Error(`Refresh request returned HTTP ${response.status}`);
      const previousCheckedAt = state.checkedAt;
      const deadline = Date.now() + 45 * 60_000;
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
    if (!response.ok) {
      const failure = await response.json().catch(() => ({}));
      throw new Error(failure.error || `Inventory returned HTTP ${response.status}`);
    }
    const payload = await response.json();
    if (notificationId && payload.notificationId !== notificationId) throw new Error("Saved notification results are unavailable.");
    if (liveRefresh && isGitHubPages && payload.checkedAt === state.checkedAt) throw new Error("Refresh is still running. Try again shortly.");
    state.checkedAt = payload.checkedAt;
    state.teeTimes = notificationId ? payload.teeTimes : payload.teeTimes.filter(teeTime => isInventoryUsable(teeTime, { allowCached: true }));
    state.courses = payload.courses;
    state.sourceChecks = payload.sourceChecks;
    resetFilters();
    renderDates();
    renderDirectory();
    selectDate(state.date);
    const checked = new Date(payload.checkedAt).toLocaleString([], { weekday: "short", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
    elements["feed-status"].textContent = notificationId ? `Notification snapshot · Feed checked ${checked}` : `Last updated ${checked}`;
    if (notificationId) document.getElementById("notification-summary").textContent = `Found ${new Date(payload.createdAt).toLocaleString()}. Saved matches; availability and prices may have changed.`;
  } catch (error) {
    elements.results.innerHTML = `<div class="empty">Could not load tee times. ${escapeHtml(error.message)}</div>`;
    elements["feed-status"].textContent = "Inventory unavailable";
    if (notificationId) document.getElementById("notification-summary").textContent = "Saved matches unavailable. Open All tee times for current availability.";
  } finally {
    elements.refresh.classList.remove("refreshing");
    elements.refresh.disabled = Boolean(notificationId);
    elements["refresh-label"].textContent = "Click to refresh tee times";
    elements.results.removeAttribute("aria-busy");
  }
}

let pullStartX = 0;
let pullStartY = 0;
let pullDistance = 0;
let pulling = false;
let pullRefreshRunning = false;
const pullThreshold = 56;

function updatePullRefresh(distance, ready = false) {
  const visibleDistance = Math.min(distance, pullThreshold + 18);
  elements["pull-refresh"].style.setProperty("--pull-distance", `${visibleDistance}px`);
  elements["pull-refresh"].classList.toggle("visible", visibleDistance > 0);
  elements["pull-refresh"].classList.toggle("ready", ready);
  elements["pull-refresh-label"].textContent = ready ? "Release to refresh" : "Pull to refresh";
}

document.addEventListener("touchstart", event => {
  pulling = false;
  if (event.target.closest("input, select, #course-selection, #leaflet-map")) return;
  if (window.scrollY > 2 || elements.refresh.disabled || pullRefreshRunning || event.touches.length !== 1) return;
  pullStartX = event.touches[0].clientX;
  pullStartY = event.touches[0].clientY;
  pullDistance = 0;
  pulling = true;
}, { passive: true });

document.addEventListener("touchmove", event => {
  if (!pulling) return;
  const vertical = event.touches.length === 1 ? event.touches[0].clientY - pullStartY : 0;
  const horizontal = event.touches.length === 1 ? Math.abs(event.touches[0].clientX - pullStartX) : 0;
  if (window.scrollY > 2 || event.touches.length !== 1 || vertical < -8 || horizontal > Math.max(12, vertical)) {
    pulling = false;
    pullDistance = 0;
    updatePullRefresh(0);
    return;
  }
  pullDistance = Math.max(0, vertical * .65);
  if (pullDistance > 5 && event.cancelable) event.preventDefault();
  updatePullRefresh(pullDistance, pullDistance >= pullThreshold);
}, { passive: false });

document.addEventListener("touchend", event => {
  if (!pulling) return;
  const shouldRefresh = pullDistance >= pullThreshold;
  pulling = false;
  pullDistance = 0;
  updatePullRefresh(0);
  if (shouldRefresh && !pullRefreshRunning) {
    if (event.cancelable) event.preventDefault();
    refreshInventory();
  }
}, { passive: false });

document.addEventListener("touchcancel", () => {
  pulling = false;
  pullDistance = 0;
  if (!pullRefreshRunning) updatePullRefresh(0);
}, { passive: true });

async function refreshInventory() {
  if (elements.refresh.disabled || pullRefreshRunning) return;
  pullRefreshRunning = true;
  resetFilters();
  updatePullRefresh(42);
  elements["pull-refresh"].classList.add("refreshing");
  elements["pull-refresh-label"].textContent = "Refreshing tee times";
  try {
    await loadInventory({ liveRefresh: true });
  } finally {
    pullRefreshRunning = false;
    elements["pull-refresh"].classList.remove("refreshing");
    updatePullRefresh(0);
  }
}

document.querySelectorAll(".date-strip").forEach(strip => strip.addEventListener("click", event => {
  const button = event.target.closest("[data-date]");
  if (button) selectDate(button.dataset.date);
}));
elements["players-filter"].addEventListener("click", event => {
  const button = event.target.closest("[data-players]");
  if (!button) return;
  state.players = Number(button.dataset.players);
  elements["players-filter"].querySelectorAll("button").forEach(item => item.classList.toggle("active", item === button));
  renderResults();
});
elements["course-selection"].addEventListener("change", event => {
  const course = event.target.dataset.course;
  if (!course) return;
  if (event.target.checked) state.hiddenCourses.delete(course);
  else state.hiddenCourses.add(course);
  saveCourseSelection();
});
elements["course-groups"].addEventListener("click", event => {
  const button = event.target.closest("[data-group]");
  if (!button) return;
  applyCourseGroup(button.dataset.group);
  renderResults();
});
elements["show-courses"].addEventListener("click", () => { applyCourseGroup("all"); renderResults(); });
elements["hide-courses"].addEventListener("click", () => { state.hiddenCourses = new Set(selectableCourses().map(course => course.course)); saveCourseSelection(); });
elements.earliest.addEventListener("input", () => updateTimeWindow("earliest"));
elements.latest.addEventListener("input", () => updateTimeWindow("latest"));
elements.metrics.addEventListener("click", event => {
  if (notificationId) return;
  const button = event.target.closest("[data-metric-filter]");
  if (!button) return;
  if (button.dataset.metricFilter === "hot") {
    state.hotDealsOnly = !state.hotDealsOnly;
  } else {
    state.exactPrice = state.exactPrice == null ? Number(button.dataset.price) : null;
  }
  renderResults();
});
elements.sort.addEventListener("change", () => { state.sort = elements.sort.value; renderResults(); });
elements["expand-results"].addEventListener("click", () => elements.results.querySelectorAll("details").forEach(details => { details.open = true; }));
elements["collapse-results"].addEventListener("click", () => elements.results.querySelectorAll("details").forEach(details => { details.open = false; }));
function resetFilters() {
  state.players = 0; state.earliest = "05:00"; state.latest = "20:00"; state.maximumDistance = 100;
  state.maximumPrice = Infinity; state.exactPrice = null; state.hotDealsOnly = false; state.course = ""; state.sort = "price";
  elements.earliest.value = 300; elements.latest.value = 1200;
  elements.sort.value = "price";
  elements["earliest-output"].value = "5:00 AM"; elements["latest-output"].value = "8:00 PM";
  elements["players-filter"].querySelectorAll("button").forEach(button => button.classList.toggle("active", button.dataset.players === "0"));
  applyCourseGroup("local");
  selectDate("");
}
elements.refresh.addEventListener("click", refreshInventory);

function expireCachedInventory() {
  if (notificationId) return;
  const current = state.teeTimes.filter(teeTime => isInventoryUsable(teeTime, { allowCached: true }));
  if (current.length === state.teeTimes.length) return;
  state.teeTimes = current;
  renderDirectory();
  renderDates();
  renderResults();
}

setInterval(expireCachedInventory, 60_000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) expireCachedInventory(); });
loadInventory().then(() => { if (new URLSearchParams(location.search).get("view") === "map") setActiveTab("map"); });