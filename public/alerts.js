import { shortCourseName } from "./src/dashboard.js?v=20260926-stonehouse";

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
let dirty = false;
let loading = false;
let saving = false;
let refreshTimer;
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

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
    <label>From<input data-field="from" type="time" value="${rule.from}" required></label><label>Until<input data-field="until" type="time" value="${rule.until}" required></label>
    <label>Minimum price ($)<input data-field="minPrice" type="number" min="0" max="2000" step="0.01" value="${rule.minPrice}" required></label><label>Maximum price ($)<input data-field="maxPrice" type="number" min="0" max="2000" step="0.01" value="${rule.maxPrice ?? ""}" placeholder="Any"></label>
    <label>Golfers<select data-field="players">${[0, 1, 2, 3, 4].map(players => `<option value="${players}"${players === rule.players ? " selected" : ""}>${players || "Any available"}</option>`).join("")}</select></label></div>
    <fieldset><legend>Days</legend><div class="days">${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, index) => `<label><input type="checkbox" data-day="${index}"${rule.days.includes(index) ? " checked" : ""}>${day}</label>`).join("")}</div></fieldset>
    <div class="rule-footer"><label>First date<input data-field="startDate" type="date" value="${rule.startDate}"></label><label>Last date<input data-field="endDate" type="date" value="${rule.endDate}"></label><label class="toggle"><input data-field="hotDealsOnly" type="checkbox"${rule.hotDealsOnly ? " checked" : ""}>Hot Deals only</label></div>`;
  container.append(section);
}

function readRules() {
  return [...container.querySelectorAll(".rule")].map(section => {
    const field = name => section.querySelector(`[data-field="${name}"]`);
    return { id: section.dataset.id, course: field("course").value, days: [...section.querySelectorAll("[data-day]:checked")].map(input => Number(input.dataset.day)),
      from: field("from").value, until: field("until").value, minPrice: Number(field("minPrice").value), maxPrice: field("maxPrice").value === "" ? null : Number(field("maxPrice").value),
      players: Number(field("players").value), enabled: field("enabled").checked, hotDealsOnly: field("hotDealsOnly").checked, startDate: field("startDate").value, endDate: field("endDate").value };
  });
}

form.addEventListener("input", () => { dirty = true; message("Unsaved changes"); });
form.addEventListener("invalid", () => { dirty = true; message("Not saved: check the highlighted fields.", true); }, true);
container.addEventListener("click", event => { const button = event.target.closest("[data-remove]"); if (button) { button.closest(".rule").remove(); dirty = true; message("Unsaved changes"); } });
document.getElementById("add").addEventListener("click", () => {
  if (container.children.length >= 20) { message("You can save up to 20 alerts.", true); return; }
  addRule({ id: crypto.randomUUID(), course: courses[0], days: [0, 1, 2, 3, 4, 5, 6], from: "00:00", until: "23:59", minPrice: 0, maxPrice: null, players: 0, enabled: true, hotDealsOnly: false, startDate: "", endDate: "" });
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