import { priceOptionLabels, shortCourseName } from "./src/dashboard.js?v=20260928-prices";

const defaultAlertPriceOption = "";

const endpoint = "https://golfwithjim-alerts.fbp-api-worker.workers.dev/preferences";
try { sessionStorage.removeItem("golfwithjim-alert-access"); } catch {}
history.replaceState(null, "", location.pathname);
const status = document.getElementById("status");
const form = document.getElementById("preferences");
const container = document.getElementById("rules");
const save = document.getElementById("save");
const refreshStatus = document.getElementById("alerts-refresh");
const actions = form.querySelector(".actions");
new ResizeObserver(() => {
  document.documentElement.style.setProperty("--actions-height", `${Math.ceil(actions.getBoundingClientRect().height)}px`);
}).observe(actions);
let version = 0;
let courses = [];
let courseGroups = [];
let priceOptions = [{ value: defaultAlertPriceOption, label: "All tee times" }, { value: "__discounts", label: "All deals & offers" }];
let dirty = false;
let loading = false;
let saving = false;
let refreshTimer;
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

function priceOptionChoices(selected) {
  const options = priceOptions.some(option => option.value === selected) ? priceOptions : [...priceOptions, { value: selected, label: selected }];
  return options.map(option => `<option value="${escapeHtml(option.value)}"${option.value === selected ? " selected" : ""}>${escapeHtml(option.label)}</option>`).join("");
}

async function loadPriceOptions() {
  try {
    const response = await fetch("./api/tee-times.json", { cache: "no-store", signal: AbortSignal.timeout(10000) });
    const data = await response.json();
    if (!response.ok || !Array.isArray(data.teeTimes)) return;
    const counts = new Map();
    for (const teeTime of data.teeTimes) for (const label of priceOptionLabels(teeTime)) counts.set(label, (counts.get(label) || 0) + 1);
    const preferredOrder = ["GolfPass", "GolfNow Hot Deal", "Hot Deal", "Fees waived"];
    const labels = [...counts].toSorted((left, right) => (preferredOrder.indexOf(left[0]) + 1 || preferredOrder.length + 1) - (preferredOrder.indexOf(right[0]) + 1 || preferredOrder.length + 1) || left[0].localeCompare(right[0]));
    priceOptions = [...priceOptions, ...labels.map(([value, count]) => ({ value, label: `${value} (${count})` }))];
  } catch {}
}

function message(text, error = false) {
  status.textContent = text;
  status.classList.toggle("error", error);
  if (!save.disabled) save.textContent = dirty ? "Save changes" : "Saved";
}
const savedTime = value => new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });

function addRule(rule) {
  const section = document.createElement("section");
  section.className = "rule";
  section.dataset.id = rule.id;
  section.innerHTML = `<div class="rule-head"><label><input data-field="enabled" type="checkbox"${rule.enabled ? " checked" : ""}>Enabled</label><button type="button" data-remove>Remove</button></div>
    <div class="rule-grid"><label class="course">Course<select data-field="course"><optgroup label="Course groups">${courseGroups.map(group => `<option value="${escapeHtml(group.value)}"${group.value === rule.course ? " selected" : ""}>${escapeHtml(group.label)}</option>`).join("")}</optgroup><optgroup label="Individual courses">${courses.map(course => `<option value="${escapeHtml(course)}"${course === rule.course ? " selected" : ""}>${escapeHtml(shortCourseName(course))}</option>`).join("")}</optgroup></select></label>
    <label>Price option<select data-field="priceOption">${priceOptionChoices(rule.priceOption ?? defaultAlertPriceOption)}</select></label></div>`;
  container.append(section);
}

function readRules() {
  return [...container.querySelectorAll(".rule")].map(section => {
    const field = name => section.querySelector(`[data-field="${name}"]`);
    return { id: section.dataset.id, course: field("course").value, days: [0, 1, 2, 3, 4, 5, 6],
      from: "00:00", until: "23:59", minPrice: 0, maxPrice: null,
      players: 0, priceOption: field("priceOption").value, enabled: field("enabled").checked, startDate: "", endDate: "" };
  });
}

form.addEventListener("input", () => { dirty = true; message("Unsaved changes"); });
form.addEventListener("invalid", () => { dirty = true; message("Not saved: check the highlighted fields.", true); }, true);
container.addEventListener("click", event => { const button = event.target.closest("[data-remove]"); if (button) { button.closest(".rule").remove(); dirty = true; message("Unsaved changes"); } });
document.getElementById("add").addEventListener("click", () => {
  if (container.children.length >= 20) { message("You can save up to 20 alerts.", true); return; }
  addRule({ id: crypto.randomUUID(), course: courses[0], days: [0, 1, 2, 3, 4, 5, 6], from: "00:00", until: "23:59", minPrice: 0, maxPrice: null, players: 0, priceOption: defaultAlertPriceOption, enabled: true, startDate: "", endDate: "" });
  dirty = true;
  message("Unsaved changes");
});
form.addEventListener("submit", async event => {
  event.preventDefault();
  if (loading || saving) return;
  saving = true;
  const payload = { rules: readRules(), paused: document.getElementById("paused").checked, version };
  const controls = [...form.querySelectorAll("input, select, button")];
  controls.forEach(control => { control.disabled = true; });
  save.textContent = "Saving...";
  form.setAttribute("aria-busy", "true");
  message("Saving...");
  try {
    const response = await fetch(endpoint, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(30000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to save changes.");
    if (data.ok !== true || !Number.isInteger(data.version) || !Number.isFinite(data.savedAt)) throw new Error("Save was not confirmed. Reload to check your saved alerts before retrying.");
    version = data.version;
    dirty = false;
    message(`Saved ${payload.rules.length} alert${payload.rules.length === 1 ? "" : "s"} at ${savedTime(data.savedAt)}.`);
  } catch (error) { dirty = true; message(error.name === "TimeoutError" || error.name === "TypeError" ? "Save not confirmed: connection interrupted. Reload to check your saved alerts before retrying." : `Not saved: ${error.message}`, true); }
  finally { saving = false; controls.forEach(control => { control.disabled = false; }); form.removeAttribute("aria-busy"); save.textContent = dirty ? "Retry save" : "Saved"; }
});
window.addEventListener("beforeunload", event => { if (dirty) { event.preventDefault(); event.returnValue = ""; } });

function showRefresh(text, { busy = false, settled = false, error = false } = {}) {
  clearTimeout(refreshTimer);
  refreshStatus.textContent = text;
  refreshStatus.hidden = false;
  refreshStatus.classList.toggle("refreshing", busy);
  refreshStatus.classList.toggle("error", error);
  if (settled) refreshTimer = setTimeout(() => { refreshStatus.hidden = true; }, 3000);
}

async function load({ refresh = false } = {}) {
  if (loading || saving) return;
  loading = true;
  form.setAttribute("aria-busy", "true");
  form.querySelectorAll("input, select, button").forEach(control => { control.disabled = true; });
  if (refresh) showRefresh("Refreshing alerts...", { busy: true });
  try {
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(30000), cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to load alerts.");
    version = data.version;
    courses = [...data.courses].sort((left, right) => shortCourseName(left).localeCompare(shortCourseName(right)) || left.localeCompare(right));
    courseGroups = data.courseGroups || [];
    document.getElementById("paused").checked = data.paused;
    container.replaceChildren();
    await loadPriceOptions();
    data.rules.forEach(addRule);
    dirty = false;
    form.hidden = false;
    form.querySelector(".actions").prepend(status);
    message(data.savedAt ? `Last saved ${savedTime(data.savedAt)}. ${data.rules.length} alerts loaded.` : `${data.rules.length} saved alerts loaded.`);
    if (refresh) showRefresh("Alerts refreshed", { settled: true });
  } catch (error) {
    message(`Unable to ${refresh ? "refresh" : "load"} alerts. ${refresh ? "Current entries were kept. Pull down to retry." : "Pull down to try again."} ${error.message}`, true);
    if (refresh) showRefresh("Could not refresh alerts", { settled: true, error: true });
  } finally {
    loading = false;
    form.removeAttribute("aria-busy");
    form.querySelectorAll("input, select, button").forEach(control => { control.disabled = false; });
    save.textContent = dirty ? "Save changes" : "Saved";
  }
}

let pullStartX = 0;
let pullStartY = 0;
let pullDistance = 0;
let pulling = false;
const pullThreshold = 72;
document.addEventListener("touchstart", event => {
  pulling = false;
  if (loading || saving || window.scrollY > 0 || event.touches.length !== 1 || event.target.closest("input, select, textarea, button, a, .actions")) return;
  pulling = true;
  pullDistance = 0;
  pullStartX = event.touches[0].clientX;
  pullStartY = event.touches[0].clientY;
}, { passive: true });
document.addEventListener("touchmove", event => {
  if (!pulling) return;
  const vertical = event.touches.length === 1 ? event.touches[0].clientY - pullStartY : 0;
  const horizontal = event.touches.length === 1 ? Math.abs(event.touches[0].clientX - pullStartX) : 0;
  if (window.scrollY > 0 || event.touches.length !== 1 || vertical < -8 || horizontal > Math.max(12, vertical)) {
    pulling = false;
    refreshStatus.hidden = true;
    return;
  }
  pullDistance = Math.max(0, vertical);
  if (pullDistance < 10) return;
  event.preventDefault();
  showRefresh(pullDistance >= pullThreshold ? "Release to refresh alerts" : "Pull to refresh alerts");
}, { passive: false });
document.addEventListener("touchend", () => {
  if (!pulling) return;
  pulling = false;
  if (pullDistance < pullThreshold) { refreshStatus.hidden = true; return; }
  if (dirty && !window.confirm("Discard unsaved changes and reload your saved alerts?")) {
    showRefresh("Refresh canceled. Unsaved changes kept.", { settled: true });
    return;
  }
  load({ refresh: true });
});
document.addEventListener("touchcancel", () => {
  if (!pulling) return;
  pulling = false;
  refreshStatus.hidden = true;
});
load();