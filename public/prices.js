import { shortCourseName } from "./src/dashboard.js?v=20260928";
import { median, applyPriceSnapshot } from "./src/price-history.js?v=20260928";
import { isUpcoming, parseTimeMinutes } from "./src/analyze.js";

const api = "https://golfwithjim-alerts.fbp-api-worker.workers.dev";
const elements = Object.fromEntries(["course", "range", "source", "day", "period", "view", "refresh", "status", "low", "median", "days", "deals", "rows", "page", "previous", "next", "export"].map(name => [name, document.getElementById(`price-${name}`)]));
const escape = value => String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const money = value => value == null ? "--" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
const dateLabel = value => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
const timeLabel = minutes => `${Math.floor(minutes / 60) % 12 || 12}:${String(minutes % 60).padStart(2,"0")} ${minutes < 720 ? "AM" : "PM"}`;
const weekday = date => new Date(`${date}T12:00:00Z`).getUTCDay();
const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const period = minutes => minutes < 720 ? "morning" : minutes < 900 ? "afternoon" : "twilight";
let observations = [], current = [], filtered = [], pageIndex = 0, chart, controller;
let currentStatus = "";

async function getJson(url, signal) {
  const response = await fetch(url, { cache: "no-store", signal });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json();
}

function drawChart() {
  chart?.destroy();
  const mode = elements.view.value;
  const grouped = new Map();
  for (const row of filtered) {
    const key = mode === "observed" ? row.observed : mode === "weekday" ? String(weekday(row.date)) : row.date.slice(0,7);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  const keys = [...grouped.keys()].sort();
  document.getElementById("chart-empty").hidden = Boolean(keys.length) && Boolean(globalThis.Chart);
  document.getElementById("chart-empty").textContent = keys.length ? "Chart unavailable. Price observations are still available below." : "No observations match these filters.";
  if (!globalThis.Chart || !keys.length) return;
  const colors = getComputedStyle(document.documentElement);
  chart = new Chart(document.getElementById("price-chart"), { type: mode === "weekday" ? "bar" : "line", data: { labels: keys.map(key => mode === "observed" ? dateLabel(key) : mode === "weekday" ? weekdays[Number(key)] : key), datasets: [
    { label: "Lowest offered", data: keys.map(key => grouped.get(key).reduce((lowest,row) => Math.min(lowest,row.low),Infinity)), borderColor: "#299d78", backgroundColor: "#299d7833", borderWidth: 2, pointRadius: 3 },
    { label: "Median offered", data: keys.map(key => median(grouped.get(key).map(row => row.median))), borderColor: "#cc8540", backgroundColor: "#cc854055", borderWidth: 2, pointRadius: 3 }
  ] }, options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { labels: { color: colors.getPropertyValue("--ink") } }, tooltip: { callbacks: { afterBody: items => `${grouped.get(keys[items[0].dataIndex]).length} observation windows` } } }, scales: { x: { ticks: { color: colors.getPropertyValue("--muted"), maxTicksLimit: 8 }, grid: { display: false } }, y: { beginAtZero: true, ticks: { color: colors.getPropertyValue("--muted"), callback: value => `$${value}` }, grid: { color: colors.getPropertyValue("--line") } } } } });
}

function renderTable() {
  const pages = Math.max(1, Math.ceil(filtered.length / 50));
  pageIndex = Math.min(pageIndex, pages - 1);
  elements.rows.innerHTML = filtered.slice(pageIndex * 50, (pageIndex + 1) * 50).map(row => `<tr><td>${escape(row.observed)}</td><td>${weekdays[weekday(row.date)]}, ${escape(row.date)}</td><td>${timeLabel(row.band)}-${timeLabel(row.band+14)}</td><td>${escape(row.source)} / ${escape(row.rate)}</td><td>${escape(row.party)}</td><td>${money(row.low)}</td><td>${money(row.median)}</td><td>${money(row.high)}</td></tr>`).join("") || '<tr><td colspan="8">No observations yet.</td></tr>';
  elements.page.textContent = `${filtered.length.toLocaleString()} windows · ${pageIndex+1} / ${pages}`;
  elements.previous.disabled = pageIndex === 0;
  elements.next.disabled = pageIndex + 1 >= pages;
  elements.export.disabled = !filtered.length;
}

function render() {
  const accepts = row => (!elements.source.value || row.source === elements.source.value) && (elements.day.value === "" || weekday(row.date) === Number(elements.day.value)) && (!elements.period.value || period(row.band) === elements.period.value);
  filtered = observations.filter(accepts).toSorted((left,right)=>right.observed.localeCompare(left.observed)||left.date.localeCompare(right.date)||left.band-right.band);
  const days = new Set(filtered.map(row => row.observed));
  elements.low.textContent = money(filtered.length ? filtered.reduce((lowest,row)=>Math.min(lowest,row.low),Infinity) : null);
  elements.median.textContent = money(median(filtered.map(row=>row.median)));
  elements.days.textContent = days.size;
  const deals = current.filter(offer => offer.course === elements.course.value && offer.deal && isUpcoming(offer) && accepts({ ...offer, band: parseTimeMinutes(offer.time) }));
  elements.deals.textContent = currentStatus ? "--" : deals.length;
  document.getElementById("current-price-deals").innerHTML = deals.map(offer => `<div class="price-deal"><div><strong>${weekdays[weekday(offer.date)]}, ${dateLabel(offer.date)} ${escape(offer.time)} · ${money(offer.allInPrice)}</strong><small>${escape(offer.source)} · ${escape(offer.rateName)}</small><small class="price-discount">${offer.deal.percent}% below ${money(offer.deal.referencePrice)} · Save ${money(offer.deal.savings)}</small><small>${escape(offer.deal.basis)} (${offer.deal.samples} comparisons)</small></div><a href="${escape(/^https:\/\//.test(offer.url) ? offer.url : './')}" target="_blank" rel="noopener">Book</a></div>`).join("") || `<p>${escape(currentStatus || "No verified deals in the current feed for these filters.")}</p>`;
  document.querySelector("#price-week-grid tbody").innerHTML = [1,2,3,4,5,6,0].map(day=>`<tr><th>${weekdays[day]}</th>${["morning","afternoon","twilight"].map(window=>{const rows=filtered.filter(row=>weekday(row.date)===day&&period(row.band)===window);return `<td title="${rows.length} observation windows">${money(median(rows.map(row=>row.median)))}</td>`;}).join("")}</tr>`).join("");
  const first = [...days].sort()[0];
  elements.status.textContent = filtered.length ? `${shortCourseName(elements.course.value)} · ${days.size} observed day${days.size===1?"":"s"} since ${first}.${days.size < 14 ? " Limited history; seasonal trends are not established." : ""}` : "No price history for these filters yet.";
  elements.status.classList.remove("error");
  pageIndex = 0;
  renderTable();
  drawChart();
}

async function loadCourse() {
  controller?.abort();
  controller = new AbortController();
  const request = controller;
  const signal = request.signal;
  const timeout = setTimeout(() => request.abort(new Error("Price request timed out")), 30000);
  const selectedCourse = elements.course.value;
  elements.status.textContent = "Loading price history...";
  elements.refresh.disabled = true;
  try {
    const [history, inventory, pricing] = await Promise.all([
      getJson(`${api}/prices?course=${encodeURIComponent(selectedCourse)}&days=${elements.range.value}`, signal),
      getJson(location.hostname.endsWith("github.io") ? "./api/tee-times.json" : "/api/tee-times", signal).catch(()=>null),
      getJson(`${api}/prices/current`, signal).catch(()=>null)
    ]);
    if (signal.aborted) throw signal.reason;
    observations = history.observations;
    currentStatus = inventory ? "" : "Current inventory is unavailable.";
    current = inventory ? applyPriceSnapshot(inventory.teeTimes, pricing, inventory.checkedAt, Date.now(), inventory.sourceChecks || []) : [];
    const source = elements.source.value;
    const sources = [...new Set([...observations.map(row=>row.source),...current.filter(row=>row.course===selectedCourse).map(row=>row.source)])].sort();
    elements.source.innerHTML = '<option value="">All providers</option>' + sources.map(value=>`<option>${escape(value)}</option>`).join("");
    elements.source.value = sources.includes(source) ? source : "";
    const url = new URL(location.href); url.searchParams.set("course", selectedCourse); window.history.replaceState(null,"",url);
    render();
  } catch (error) {
    if (controller !== request || error.name === "AbortError") return;
    observations=[];current=[];currentStatus="Current inventory is unavailable.";render();
    elements.status.textContent = "Could not load price history. Refresh to retry.";
    elements.status.classList.add("error");
  } finally { clearTimeout(timeout); if (controller === request) elements.refresh.disabled = false; }
}
document.getElementById("price-filters").addEventListener("submit",event=>event.preventDefault());
for (const name of ["course","range"]) elements[name].addEventListener("change",loadCourse);
for (const name of ["source","day","period","view"]) elements[name].addEventListener("change",render);
elements.refresh.addEventListener("click",()=>elements.course.options.length?loadCourse():start());
elements.previous.addEventListener("click",()=>{pageIndex--;renderTable();});
elements.next.addEventListener("click",()=>{pageIndex++;renderTable();});
new MutationObserver(drawChart).observe(document.documentElement,{attributes:true,attributeFilter:["data-theme"]});
elements.export.addEventListener("click",()=>{
  const fields=["course","observed","date","band","source","rate","party","lead","low","median","high","count","seenAt"];
  const quote=value=>`"${String(value??"").replace(/^[=+@-]/,"'$&").replace(/"/g,'""')}"`;
  const csv=[fields.join(","),...filtered.map(row=>fields.map(field=>quote(row[field])).join(","))].join("\r\n");
  const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));const anchor=document.createElement("a");anchor.href=url;anchor.download="course-price-history.csv";anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
async function start() {
  try {
    const data=await getJson(`${api}/prices`,AbortSignal.timeout(20000));
    const courses=data.courses.toSorted((left,right)=>shortCourseName(left.course).localeCompare(shortCourseName(right.course)));
    elements.course.innerHTML=courses.map(row=>`<option value="${escape(row.course)}">${escape(shortCourseName(row.course))}</option>`).join("");
    const requested=new URLSearchParams(location.search).get("course");if(courses.some(row=>row.course===requested))elements.course.value=requested;
    if(courses.length)await loadCourse();else{elements.status.textContent="Price history is awaiting its first successful collection.";elements.export.disabled=true;}
  }catch{elements.status.textContent="Could not load courses. Refresh to retry.";elements.status.classList.add("error");}
}
start();