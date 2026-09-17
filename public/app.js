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
  "tab-list", "tab-map", "view-list-container", "view-map-container",
  "map-count", "map-filters-summary", "map-course-list", "leaflet-map", "map-legend-locate", "map-date-options",
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
  return `<section class="tracked-group"><div><p class="eyebrow">Also tracked</p><h3>Courses with no tee times</h3></div>${rows}</section>`;
}

function renderResults() {
  let filtered = filterTeeTimes(state.teeTimes, state);
  if (state.course) filtered = filtered.filter(teeTime => teeTime.course.toLowerCase().includes(state.course));
  if (state.exactPrice != null) filtered = filtered.filter(teeTime => Math.abs(teeTime.allInPrice - state.exactPrice) < 0.001);
  elements.metrics.innerHTML = metricsHtml(summarizeResults(filtered));
  elements["results-title"].textContent = state.date ? dateLabel(state.date) : "All tee times";
  if (!filtered.length) {
    elements.results.innerHTML = `<div class="empty">No tee times match these filters.</div>${trackedCoursesHtml(filtered)}`;
    updateMapView();
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
  const inventoryCourses = new Set(state.teeTimes.map(teeTime => teeTime.course));
  elements["course-directory"].innerHTML = state.courses.toSorted((left, right) => left.distanceMiles - right.distanceMiles || left.course.localeCompare(right.course)).map(course =>
    `<div class="directory-course"><a href="${escapeHtml(course.url)}" target="_blank" rel="noopener">${escapeHtml(course.course)}</a><small>${course.distanceMiles} miles · ${inventoryCourses.has(course.course) ? "Tee times included" : course.source}</small></div>`).join("");
}

function selectDate(date) {
  state.date = date;
  document.querySelectorAll(".date-option").forEach(button => button.classList.toggle("active", button.dataset.date === date));
  renderResults();
}

// ---- Map view ----------------------------------------------------------
const RICHMOND_CENTER = [37.5407, -77.436];
const DISTANCE_RING_MILES = [10, 25, 50, 75];
let map = null;
let markerLayer = null;
let userLocationMarker = null;
let activeMapKey = null;
let currentMapGroups = new Map();

const haversineMiles = (lat1, lon1, lat2, lon2) => {
  const toRad = degrees => degrees * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(a));
};

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
    iconSize: [34, 44], iconAnchor: [17, 40], popupAnchor: [0, -36],
  });
}

function popupTimesTableHtml(times) {
  if (!times.length) return "";
  const showDate = !state.date;
  const ordered = times.toSorted((left, right) => (showDate ? left.date.localeCompare(right.date) : 0) || timeValue(left.time) - timeValue(right.time) || left.allInPrice - right.allInPrice);
  const rows = ordered.map(teeTime => `<tr class="${teeTime.hotDeal ? "hot" : ""}">${showDate ? `<td>${escapeHtml(shortDate(teeTime.date))}</td>` : ""}<td>${escapeHtml(teeTime.time)}</td><td>${money(teeTime.allInPrice)}</td><td>${teeTime.availablePlayers}</td></tr>`).join("");
  return `<div class="map-popup-times-wrap"><table class="map-popup-times${showDate ? " has-date" : ""}"><thead><tr>${showDate ? "<th>Date</th>" : ""}<th>Time</th><th>Price</th><th>Spots</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function popupHtml(group, teeTimesByCourse) {
  const rows = group.map(course => {
    const times = teeTimesByCourse.get(course.course) || [];
    const category = pinCategory(times);
    const dealCount = times.filter(teeTime => teeTime.hotDeal).length;
    const status = category === "hot"
      ? `${dealCount} Hot Deal${dealCount === 1 ? "" : "s"} of ${times.length} tee time${times.length === 1 ? "" : "s"}`
      : category === "available" ? `${times.length} tee time${times.length === 1 ? "" : "s"}`
      : "No qualifying tee times right now";
    return `<div class="map-popup-course"><h4>${escapeHtml(course.course)}</h4><p class="map-popup-meta">${course.distanceMiles} miles · ${escapeHtml(course.source)}</p><div class="map-popup-status${category === "hot" ? " hot" : ""}"><strong>${escapeHtml(status)}</strong></div>${popupTimesTableHtml(times)}<a class="map-popup-link" href="${escapeHtml(course.url)}" target="_blank" rel="noopener">View course &rarr;</a></div>`;
  }).join("");
  return `<div class="map-popup">${rows}</div>`;
}

function sidebarCardHtml(group, teeTimesByCourse, key) {
  const primary = group[0];
  const categories = group.map(course => pinCategory(teeTimesByCourse.get(course.course) || []));
  const bestCategory = categories.includes("hot") ? "hot" : categories.includes("available") ? "available" : "link";
  const label = categories.includes("hot") ? "Hot Deal" : categories.includes("available") ? "Available" : "Tracked";
  const names = group.map(course => escapeHtml(course.course)).join(" · ");
  return `<div class="map-course-card${activeMapKey === key ? " highlight" : ""}" data-map-key="${key}"><h4>${names}<span class="map-card-tag ${bestCategory}">${label}</span></h4><p><span>${primary.distanceMiles} miles</span><span>${escapeHtml(primary.source)}</span></p></div>`;
}

function ringLabelLatLng(miles) {
  return [RICHMOND_CENTER[0] + miles / 69, RICHMOND_CENTER[1]];
}

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
  L.control.layers({ Street: streetLayer, Satellite: satelliteLayer, Terrain: terrainLayer }, null, { position: "topleft" }).addTo(map);

  map.ringLayer = L.layerGroup().addTo(map);
  DISTANCE_RING_MILES.forEach(miles => {
    L.circle(RICHMOND_CENTER, { radius: miles * 1609.34, color: "#d3a53b", weight: 2.5, opacity: .85, fill: true, fillColor: "#d3a53b", fillOpacity: .04, dashArray: "6 8" }).addTo(map.ringLayer);
    L.marker(ringLabelLatLng(miles), { icon: L.divIcon({ className: "map-ring-label", html: `${miles} mi`, iconSize: [40, 16] }), interactive: false }).addTo(map.ringLayer);
  });

  L.marker(RICHMOND_CENTER, { icon: L.divIcon({ className: "richmond-marker", html: '<span class="richmond-marker-dot"></span>', iconSize: [16, 16] }) })
    .addTo(map)
    .bindTooltip("Richmond · click to recenter", { direction: "top", offset: [0, -8] })
    .on("click", () => {
      activeMapKey = null;
      document.querySelectorAll(".map-course-card").forEach(card => card.classList.remove("highlight"));
      map.closePopup();
      map.flyTo(RICHMOND_CENTER, 8, { duration: .6 });
    });

  markerLayer = L.layerGroup().addTo(map);
  requestAnimationFrame(() => map.invalidateSize());
}

function flyToMapKey(key, group, { openPopup = false } = {}) {
  if (!map || !group) return;
  activeMapKey = key;
  map.flyTo([group[0].latitude, group[0].longitude], Math.max(map.getZoom(), 11), { duration: .6 });
  // Sidebar navigation can target a marker that starts off-screen, so autoPan must be computed
  // against the settled destination view, not the pre-flyTo position. Wait for "moveend", with a
  // timeout fallback because flyTo never fires it when the map is already at the target view.
  if (openPopup) {
    let opened = false;
    const open = () => { if (opened) return; opened = true; group.marker?.openPopup(); };
    map.once("moveend", open);
    setTimeout(open, 700);
  }
  document.querySelectorAll(".map-course-card").forEach(card => card.classList.toggle("highlight", card.dataset.mapKey === key));
}

function updateMapView() {
  if (!map) return;
  markerLayer.clearLayers();
  const filtered = filterTeeTimes(state.teeTimes, state);
  const teeTimesByCourse = Map.groupBy(filtered, teeTime => teeTime.course);
  const searchTerm = state.course;
  const mappable = state.courses.filter(course => course.latitude != null
    && course.distanceMiles <= state.maximumDistance
    && (!searchTerm || course.course.toLowerCase().includes(searchTerm)));
  const groups = new Map();
  mappable.forEach(course => {
    const key = courseGroupKey(course);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(course);
  });

  const groupsByKey = new Map();
  groups.forEach((group, key) => {
    const primary = group[0];
    const categories = group.map(course => pinCategory(teeTimesByCourse.get(course.course) || []));
    const bestCategory = categories.includes("hot") ? "hot" : categories.includes("available") ? "available" : "link";
    if (bestCategory === "link") return;
    const visibleCourses = group.filter(course => pinCategory(teeTimesByCourse.get(course.course) || []) !== "link");
    visibleCourses.marker = null;
    const icon = pinIcon(bestCategory, visibleCourses.length > 1 ? String(visibleCourses.length) : "&#9971;");
    const marker = L.marker([primary.latitude, primary.longitude], { icon }).addTo(markerLayer);
    marker.bindPopup(popupHtml(visibleCourses, teeTimesByCourse), { maxWidth: 300, maxHeight: 320 });
    marker.on("click", () => flyToMapKey(key, visibleCourses));
    visibleCourses.marker = marker;
    groupsByKey.set(key, visibleCourses);
  });

  const unmapped = state.courses.filter(course => course.latitude == null
    && course.distanceMiles <= state.maximumDistance
    && pinCategory(teeTimesByCourse.get(course.course) || []) !== "link"
    && (!searchTerm || course.course.toLowerCase().includes(searchTerm)));

  currentMapGroups = groupsByKey;
  const sortedGroups = [...groupsByKey].toSorted(([, left], [, right]) => left[0].distanceMiles - right[0].distanceMiles);
  const cardsHtml = sortedGroups.map(([key, group]) => sidebarCardHtml(group, teeTimesByCourse, key)).join("");
  const unmappedHtml = unmapped.length ? `<p class="map-course-list-heading">No mapped location yet</p>${unmapped.toSorted((left, right) => left.distanceMiles - right.distanceMiles).map(course => `<div class="map-course-card unmapped"><h4>${escapeHtml(course.course)}</h4><p><span>${course.distanceMiles} miles</span><a href="${escapeHtml(course.url)}" target="_blank" rel="noopener">View course</a></p></div>`).join("")}` : "";
  elements["map-course-list"].innerHTML = cardsHtml + unmappedHtml;

  elements["map-count"].textContent = `${groupsByKey.size} location${groupsByKey.size === 1 ? "" : "s"}`;
  elements["map-filters-summary"].innerHTML = `Showing <strong>${groupsByKey.size}</strong> location${groupsByKey.size === 1 ? "" : "s"} with tee times${state.date ? ` on <strong>${escapeHtml(dateLabel(state.date))}</strong>` : ""} within ${state.maximumDistance} miles.${unmapped.length ? ` ${unmapped.length} more course${unmapped.length === 1 ? "" : "s"} ${unmapped.length === 1 ? "has" : "have"} tee times but no mapped location yet.` : ""}`;
}

elements["map-course-list"].addEventListener("click", event => {
  const card = event.target.closest("[data-map-key]");
  if (!card || card.classList.contains("unmapped")) return;
  flyToMapKey(card.dataset.mapKey, currentMapGroups.get(card.dataset.mapKey), { openPopup: true });
});

elements["map-legend-locate"].addEventListener("click", () => {
  if (!navigator.geolocation) { elements["map-legend-locate"].title = "Location is not supported in this browser."; return; }
  elements["map-legend-locate"].classList.add("active");
  navigator.geolocation.getCurrentPosition(position => {
    const { latitude, longitude } = position.coords;
    if (userLocationMarker) map.removeLayer(userLocationMarker);
    userLocationMarker = L.marker([latitude, longitude], {
      icon: L.divIcon({ className: "user-location-wrap", html: '<span class="user-location-marker"><span class="user-location-ring"></span><span class="user-location-dot"></span></span>', iconSize: [18, 18] }),
      zIndexOffset: 1000,
    }).addTo(map).bindTooltip("You are here", { direction: "top", offset: [0, -6] });
    const distances = state.courses
      .filter(course => course.latitude != null)
      .map(course => ({ course, miles: haversineMiles(latitude, longitude, course.latitude, course.longitude) }))
      .toSorted((left, right) => left.miles - right.miles)
      .slice(0, 3);
    if (distances.length) {
      const summary = distances.map(entry => `${entry.course.course} (${entry.miles.toFixed(1)} mi)`).join(", ");
      elements["map-filters-summary"].innerHTML = `Nearest to you: <strong>${escapeHtml(summary)}</strong>.`;
    }
    map.flyTo([latitude, longitude], 10, { duration: .6 });
    elements["map-legend-locate"].classList.remove("active");
  }, () => {
    elements["map-legend-locate"].classList.remove("active");
    elements["map-filters-summary"].textContent = "Location access was denied or unavailable.";
  }, { enableHighAccuracy: true, timeout: 10_000 });
});

function setActiveTab(view) {
  const showMap = view === "map";
  elements["tab-list"].classList.toggle("active", !showMap);
  elements["tab-list"].setAttribute("aria-selected", String(!showMap));
  elements["tab-map"].classList.toggle("active", showMap);
  elements["tab-map"].setAttribute("aria-selected", String(showMap));
  elements["view-list-container"].classList.toggle("map-view-hidden", showMap);
  elements["view-map-container"].classList.toggle("map-view-hidden", !showMap);
  if (showMap) {
    initMap();
    updateMapView();
    requestAnimationFrame(() => map.invalidateSize());
  }
}
elements["tab-list"].addEventListener("click", () => setActiveTab("list"));
elements["tab-map"].addEventListener("click", () => setActiveTab("map"));
// -------------------------------------------------------------------------

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
    elements["feed-status"].textContent = `Last updated ${checked}`;
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