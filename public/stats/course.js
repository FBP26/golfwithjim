// Add a course or new tees. Same passcode and /courses endpoint as the score pages.
import { API, loadData, esc } from "./golf-data.js?v=20261118b";
const KEY_KEY = "golfEntryKey";
const $ = s => document.querySelector(s);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
function getKey() {
  const saved = store.get(KEY_KEY); if (saved) return Promise.resolve(saved);
  const dialog = $("#key-dialog");
  return new Promise(resolve => {
    $("#key-input").value = "";
    dialog.onclose = () => { const v = $("#key-input").value.trim(); if (dialog.returnValue === "ok" && v) { store.set(KEY_KEY, v); resolve(v); } else resolve(null); };
    dialog.showModal();
  });
}
function fillLists() {}

// Add a course: one card row at a time (pars, then handicaps, then yards), with OUT/IN/TOT totals and checks to compare to the card.
const cf = $("#course-form");
const cfHoles = () => { const v = cf.elements.count.value; return v === "front" ? [1,2,3,4,5,6,7,8,9] : v === "back" ? [10,11,12,13,14,15,16,17,18] : Array.from({ length: 18 }, (_, i) => i + 1); };
function cfNums(name) {
  const v = cf.elements[name].value.trim();
  if (name === "pars" && /^\d+$/.test(v)) return [...v].map(Number); // typed straight through
  return v ? v.split(/[\s.,]+/).filter(Boolean).map(Number) : [];
}
for (const name of ["pars", "hcps", "yards"]) {
  const el = cf.elements[name];
  el.addEventListener("input", () => {
    const c = el.selectionStart, before = el.value;
    const after = before.replace(/[.,]/g, " ").replace(/ {2,}/g, " ").replace(/^ /, "");
    if (after !== before) { el.value = after; const d = before.length - after.length; el.setSelectionRange(Math.max(0, c - d), Math.max(0, c - d)); }
    cfRender();
  });
}
cf.elements.count.addEventListener("change", cfRender);
function cfCheck() {
  const holes = cfHoles(), n = holes.length, pars = cfNums("pars"), hcps = cfNums("hcps"), yards = cfNums("yards");
  const errs = [], warns = [], oks = [];
  if (pars.length !== n) errs.push(`Pars: ${pars.length} of ${n} entered.`);
  pars.forEach((p, i) => { if (!(p >= 3 && p <= 6)) errs.push(`Hole ${holes[i] ?? "?"}: par ${p} doesn't look right.`); else if (p === 6) warns.push(`Hole ${holes[i]}: par 6? Very rare (Meadows Farms' Longest Hole nine has one).`); });
  if (hcps.length && hcps.length !== n) errs.push(`Handicaps: ${hcps.length} of ${n} entered (leave it empty, or enter all ${n}).`);
  if (yards.length && yards.length !== n) errs.push(`Yards: ${yards.length} of ${n} entered (leave it empty, or enter all ${n}).`);
  yards.forEach((y, i) => { if (!(y >= 40 && y <= (pars[i] === 6 ? 950 : 750))) warns.push(`Hole ${holes[i] ?? "?"}: ${y} yards?`); });
  if (hcps.length === n) {
    const bad = hcps.filter((h) => !(Number.isInteger(h) && h >= 1 && h <= 18));
    const dup = [...new Set(hcps.filter((h, i) => hcps.indexOf(h) !== i))];
    if (bad.length) errs.push(`Handicaps must be 1–18 (${bad.join(", ")}).`);
    if (dup.length) errs.push(`Handicap ${dup.join(", ")} is used twice.`);
    if (n === 18 && !bad.length && !dup.length) {
      const f = hcps.slice(0, 9), b = hcps.slice(9);
      const allOdd = (a) => a.every((h) => h % 2), allEven = (a) => a.every((h) => h % 2 === 0);
      if ((allOdd(f) && allEven(b)) || (allEven(f) && allOdd(b))) oks.push(`Handicaps: front 9 all ${allOdd(f) ? "odd" : "even"}, back 9 all ${allOdd(b) ? "odd" : "even"} ✓`);
      else {
        const off = (a, start) => { const odd = a.filter((h) => h % 2).length >= 5; return a.map((h, i) => ((h % 2 === 1) !== odd ? start + i : null)).filter(Boolean); };
        warns.push(`Handicaps aren't odds on one nine and evens on the other. Check holes ${[...off(f, 1), ...off(b, 10)].join(", ")} against the card (some courses do mix them).`);
      }
    }
  }
  if (pars.length === n && !errs.length) oks.push(`Par ${pars.reduce((a, b) => a + b, 0)}: matches the card?`);
  return { holes, pars, hcps, yards, errs, warns, oks };
}
function cfRender() {
  const { holes, pars, hcps, yards, errs, warns, oks } = cfCheck();
  const nines = [holes.filter((h) => h <= 9), holes.filter((h) => h >= 10)].filter((x) => x.length);
  const sum = (arr) => arr.reduce((a, b) => a + b, 0);
  const any = pars.length || hcps.length || yards.length;
  const tot = { p: 0, y: 0 };
  const tables = nines.map((nine) => {
    const idx = nine.map((h) => holes.indexOf(h));
    const row = (label, arr, total) => `<tr><th>${label}</th>${idx.map((i) => `<td>${arr[i] ?? ""}</td>`).join("")}<td class="t">${total ?? ""}</td></tr>`;
    const p = idx.map((i) => pars[i]), y = idx.map((i) => yards[i]);
    const ps = p.every(Number.isFinite) ? sum(p) : null, ys = y.every(Number.isFinite) ? sum(y) : null;
    if (ps != null) tot.p += ps; if (ys != null) tot.y += ys;
    return `<table><tr><th>Hole</th>${nine.map((h) => `<td class="h">${h}</td>`).join("")}<td class="h t">${nine[0] <= 9 ? "OUT" : "IN"}</td></tr>${row("Par", pars, ps)}${row("Hcp", hcps, "")}${row("Yds", yards, ys)}</table>`;
  });
  $("#cf-preview").innerHTML = any ? tables.join("") + (nines.length === 2 ? `<p class="cf-tot">Total: par <b>${tot.p || "–"}</b>${tot.y ? ` · <b>${tot.y.toLocaleString("en-US")}</b> yds` : ""}</p>` : "") : "";
  $("#cf-checks").innerHTML = any ? [...errs.map((t) => `<li class="err">${esc(t)}</li>`), ...warns.map((t) => `<li class="warn">${esc(t)}</li>`), ...oks.map((t) => `<li class="ok">${esc(t)}</li>`)].join("") : "";
}

cf.addEventListener("submit", async event => {
  event.preventDefault();
  const statusEl = $("#course-status");
  const { holes, pars, hcps, yards, errs, warns } = cfCheck();
  if (errs.length) { statusEl.textContent = "Fix the red items first."; cfRender(); return; }
  if (warns.length && !confirm(warns.join("\n\n") + "\n\nSave anyway?")) return;
  const rows = holes.map((hole, i) => ({ hole, par: pars[i], length: yards[i] || null, handicap: hcps[i] || null }));
  const key = await getKey(); if (!key) return;
  const res = await fetch(`${API}/courses`, { method: "POST", headers: { "Content-Type": "application/json", "X-Golf-Key": key }, body: JSON.stringify({ course: cf.elements.course.value, tees: cf.elements.tees.value, holes: rows }) });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) store.del(KEY_KEY);
  statusEl.textContent = res.ok ? "Saved. It's now in the Course list on the score pages." : body.error || `HTTP ${res.status}`;
  if (res.ok) loadData({ fresh: true }).catch(() => {});
});

