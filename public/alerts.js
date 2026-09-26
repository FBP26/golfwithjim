const endpoint = "https://golfwithjim-alerts.fbp-api-worker.workers.dev/preferences";
const token = new URLSearchParams(location.hash.slice(1)).get("token") || "";
history.replaceState(null, "", location.pathname);
const status = document.getElementById("status");
const form = document.getElementById("preferences");
const container = document.getElementById("rules");
const save = document.getElementById("save");
const requestLink = document.getElementById("request-link");
let version = 0;
let courses = [];
let dirty = false;
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

function message(text, error = false) { status.textContent = text; status.classList.toggle("error", error); }

function addRule(rule) {
  const section = document.createElement("section");
  section.className = "rule";
  section.dataset.id = rule.id;
  section.innerHTML = `<div class="rule-head"><label><input data-field="enabled" type="checkbox"${rule.enabled ? " checked" : ""}>Enabled</label><button type="button" data-remove>Remove</button></div>
    <div class="rule-grid"><label class="course">Course<select data-field="course">${courses.map(course => `<option${course === rule.course ? " selected" : ""}>${escapeHtml(course)}</option>`).join("")}</select></label>
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
container.addEventListener("click", event => { const button = event.target.closest("[data-remove]"); if (button) { button.closest(".rule").remove(); dirty = true; message("Unsaved changes"); } });
document.getElementById("add").addEventListener("click", () => {
  if (container.children.length >= 20) { message("You can save up to 20 alerts.", true); return; }
  addRule({ id: crypto.randomUUID(), course: courses[0], days: [0, 1, 2, 3, 4, 5, 6], from: "00:00", until: "23:59", minPrice: 0, maxPrice: null, players: 0, enabled: true, hotDealsOnly: false, startDate: "", endDate: "" });
  dirty = true;
  message("Unsaved changes");
});
form.addEventListener("submit", async event => {
  event.preventDefault();
  save.disabled = true;
  message("Saving...");
  try {
    const response = await fetch(endpoint, { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ rules: readRules(), paused: document.getElementById("paused").checked, version }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to save changes.");
    version = data.version;
    dirty = false;
    message("Saved");
  } catch (error) { message(error.message, true); }
  finally { save.disabled = false; }
});
window.addEventListener("beforeunload", event => { if (dirty) { event.preventDefault(); event.returnValue = ""; } });
requestLink.addEventListener("submit", async event => {
  event.preventDefault();
  const button = requestLink.querySelector("button");
  button.disabled = true;
  try {
    const response = await fetch(endpoint.replace("/preferences", "/request-link"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: document.getElementById("link-email").value }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Request failed.");
    message(data.message);
  } catch (error) { message(error.message, true); }
  finally { button.disabled = false; }
});

async function load() {
  if (!/^[a-f0-9]{64}$/.test(token)) { message("Open the private management link in your latest alert email.", true); requestLink.hidden = false; return; }
  try {
    const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to load alerts.");
    version = data.version;
    courses = data.courses;
    document.getElementById("email").textContent = data.email;
    document.getElementById("paused").checked = data.paused;
    data.rules.forEach(addRule);
    form.hidden = false;
    message("All changes apply after saving.");
  } catch (error) { message(error.message, true); requestLink.hidden = false; }
}
load();