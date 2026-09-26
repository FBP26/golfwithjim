import { defaultAlerts, validateAlerts, matchesAlert, alertSummary, alertCourseGroups } from "../src/personal-alerts.js";
import { pushConfigured, pushRequest, checkPushAlerts } from "./push.js";
import { signupEmailConfigured, flushSignupEmails } from "./signup-notifications.js";

const siteOrigin = "https://fbp26.github.io";
const feedUrl = "https://fbp26.github.io/golfwithjim/api/tee-times.json";
const managementUrl = "https://fbp26.github.io/golfwithjim/alerts.html";
const maximumAge = 30 * 60 * 60 * 1000;
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

function json(value, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(value), { status, headers: {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": siteOrigin, "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  } });
}

export async function tokenDigest(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function issueToken(env, subscriberId) {
  const token = [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, "0")).join("");
  await env.DB.prepare("INSERT INTO access_tokens (digest, subscriber_id, expires_at) VALUES (?, ?, ?)")
    .bind(await tokenDigest(token), subscriberId, Date.now() + 90 * 86400000).run();
  return `${managementUrl}#token=${token}`;
}

async function getFeed() {
  const response = await fetch(`${feedUrl}?alerts=${Date.now()}`, { signal: AbortSignal.timeout(20000), cache: "no-store" });
  if (!response.ok) throw new Error("Inventory feed unavailable.");
  const feed = await response.json();
  if (!Array.isArray(feed.courses) || !Array.isArray(feed.teeTimes) || !Array.isArray(feed.sourceChecks)) throw new Error("Invalid inventory feed.");
  return feed;
}

function courseNames(feed) {
  return [...new Set(feed.courses.filter(course => course.collector && course.showInventory !== false).map(course => course.course))].sort();
}

export function selectMatches(feed, rules, seen, now = new Date()) {
  const checked = Date.parse(feed.checkedAt);
  if (!Number.isFinite(checked) || now.getTime() - checked > maximumAge || checked > now.getTime() + 300000) return [];
  const matches = new Map();
  const supportedCourses = new Set(courseNames({ courses: feed.courses || [] }));
  for (const rule of rules) for (const teeTime of feed.teeTimes) {
    if (alertCourseGroups.some(group => group.value === rule.course) && !supportedCourses.has(teeTime.course)) continue;
    if (!matchesAlert(teeTime, rule, now)) continue;
    const checks = feed.sourceChecks.filter(source => source.course === teeTime.course && (!source.source || source.source === teeTime.source));
    if (!checks.some(check => !check.error && Number.isFinite(Date.parse(check.checkedAt)) && now.getTime() - Date.parse(check.checkedAt) <= maximumAge && Date.parse(check.checkedAt) <= now.getTime() + 300000)) continue;
    const key = JSON.stringify([rule.id, teeTime.course, teeTime.date, teeTime.time, teeTime.allInPrice, rule.players]);
    if (seen.has(key) || matches.has(key)) continue;
    matches.set(key, { key, ruleId: rule.id, teeTime });
  }
  return [...matches.values()].sort((left, right) => left.teeTime.date.localeCompare(right.teeTime.date) || left.teeTime.course.localeCompare(right.teeTime.course));
}

export function formatPersonalEmail(rules, matches, manageLink, checkedAt, welcome = false, paused = false) {
  const subject = welcome ? "Your Golf With Jim alerts are ready" : `Golf With Jim: ${matches.length} matching tee time${matches.length === 1 ? "" : "s"}`;
  const button = (url, label) => `<a href="${escapeHtml(url)}" style="display:inline-block;background:#245944;color:#ffffff;padding:12px 18px;border:1px solid #245944;border-radius:4px;text-decoration:none;font-weight:bold;text-align:center">${label}</a>`;
  const summaries = rules.map(alertSummary);
  const accessNote = manageLink.includes("#token=") ? "Your private management link expires in 90 days. Do not forward it." : "Manage your alerts on Golf With Jim.";
  const rows = matches.slice(0, 100).map(({ teeTime }) => {
    const url = /^https:\/\//i.test(teeTime.url) ? teeTime.url : "https://fbp26.github.io/golfwithjim/";
    return `<tr><td>${escapeHtml(teeTime.course)}</td><td>${escapeHtml(teeTime.date)} ${escapeHtml(teeTime.time)}</td><td>$${teeTime.allInPrice.toFixed(2)}</td><td>${escapeHtml(teeTime.availablePartySizes?.join(", ") || `Up to ${teeTime.availablePlayers}`)}</td><td>${button(url, "Book tee time")}</td></tr>`;
  }).join("");
  const intro = welcome ? "Your saved rules are listed below. Matching tee times are emailed when detected in a newly checked feed." : "These newly matching offers were found in the published inventory.";
  const timing = "All times are Eastern; prices are per golfer for 18 holes. The alert service checks the published feed every 15 minutes; course collection follows the site's existing refresh schedule. Availability is not held and may change before booking.";
  const body = `${intro}\n\n${matches.map(({ teeTime }) => `${teeTime.course}: ${teeTime.date} ${teeTime.time}, $${teeTime.allInPrice.toFixed(2)}, ${teeTime.url}`).join("\n")}\n\nYour alerts${paused ? " (all paused)" : ""}:\n${summaries.join("\n")}\n\nManage, pause, or remove alerts: ${manageLink}\n\n${timing}\nFeed checked: ${checkedAt}\n${accessNote}`;
  const htmlBody = `<div style="font:15px/1.5 Arial,sans-serif;color:#17241e;max-width:900px"><h2>${escapeHtml(subject)}</h2><p>${intro}</p>${rows ? `<table cellpadding="8" style="border-collapse:collapse;width:100%" border="1"><thead><tr><th>Course</th><th>Eastern start</th><th>Price</th><th>Golfers</th><th>Booking</th></tr></thead><tbody>${rows}</tbody></table>` : ""}${matches.length > 100 ? `<p>${matches.length - 100} additional matching offers. Open the site for full availability.</p>` : ""}<h3>Your alerts${paused ? " (all paused)" : ""}</h3><ul>${summaries.map(summary => `<li>${escapeHtml(summary)}</li>`).join("") || "<li>No saved alerts</li>"}</ul><p>${button(manageLink, "Manage alerts")}</p><p>${timing}</p><p style="font-size:12px">Feed checked: ${escapeHtml(checkedAt)}. ${accessNote}</p></div>`;
  return { subject, body, htmlBody };
}

async function send(env, email, message) {
  if (env.EMAIL_DELIVERY_ENABLED === "false") throw new Error("Email delivery is disabled.");
  if (!env.EMAIL_RELAY_URL || !env.EMAIL_RELAY_SECRET) throw new Error("Email delivery is not configured.");
  const response = await fetch(env.EMAIL_RELAY_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body: JSON.stringify({ action: "send-notification-email", secret: env.EMAIL_RELAY_SECRET, to: email, ...message }), signal: AbortSignal.timeout(25000) });
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.ok !== true) throw new Error(`Email relay did not confirm delivery (HTTP ${response.status}).`);
}

async function deliverBatch(env, subscriber, batch) {
  const current = await env.DB.prepare("SELECT version, paused FROM subscribers WHERE id = ?").bind(subscriber.id).first();
  const keys = JSON.parse(batch.match_keys);
  if (!current || current.version !== subscriber.version || (current.paused && keys.length)) {
    await env.DB.prepare("UPDATE delivery_batches SET sent_at = -1, message = '{}' WHERE id = ?").bind(batch.id).run();
    return false;
  }
  await env.DB.prepare("UPDATE delivery_batches SET attempts = attempts + 1 WHERE id = ?").bind(batch.id).run();
  try {
    await send(env, subscriber.email, JSON.parse(batch.message));
    const statements = [];
    for (let offset = 0; offset < keys.length; offset += 25) {
      const chunk = keys.slice(offset, offset + 25);
      statements.push(env.DB.prepare(`INSERT OR IGNORE INTO sent_matches (subscriber_id, match_key, sent_at) VALUES ${chunk.map(() => "(?, ?, ?)").join(", ")}`).bind(...chunk.flatMap(key => [subscriber.id, key, Date.now()])));
    }
    statements.push(env.DB.prepare("UPDATE delivery_batches SET sent_at = ?, message = '{}', last_error = NULL WHERE id = ?").bind(Date.now(), batch.id));
    await env.DB.batch(statements);
    return true;
  } catch (error) {
    await env.DB.prepare("UPDATE delivery_batches SET last_error = ? WHERE id = ?").bind(error.message, batch.id).run();
    return false;
  }
}

async function enqueue(env, subscriber, matches, checkedAt, welcome = false) {
  const manageLink = subscriber.email === env.PUBLIC_EDITOR_EMAIL ? managementUrl : await issueToken(env, subscriber.id);
  const batch = { id: crypto.randomUUID(), message: JSON.stringify(formatPersonalEmail(JSON.parse(subscriber.rules), matches, manageLink, checkedAt, welcome, Boolean(subscriber.paused))), match_keys: JSON.stringify(matches.map(match => match.key)) };
  await env.DB.prepare("INSERT INTO delivery_batches (id, subscriber_id, message, match_keys, created_at) VALUES (?, ?, ?, ?, ?)").bind(batch.id, subscriber.id, batch.message, batch.match_keys, Date.now()).run();
  return deliverBatch(env, subscriber, batch);
}

export async function checkAlerts(env) {
  await flushSignupEmails(env);
  const emailEnabled = env.EMAIL_DELIVERY_ENABLED !== "false" && env.EMAIL_RELAY_SECRET && env.EMAIL_RELAY_URL;
  if (!emailEnabled && !pushConfigured(env)) return { configured: false, sent: 0 };
  const owner = crypto.randomUUID();
  const lock = await env.DB.prepare("INSERT INTO job_lock (id, owner, expires_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner, expires_at=excluded.expires_at WHERE job_lock.expires_at < ?").bind(owner, Date.now() + 600000, Date.now()).run();
  if (!lock.meta.changes) return { busy: true, sent: 0 };
  let sent = 0;
  try {
    const feed = await getFeed();
    const subscribers = emailEnabled ? (await env.DB.prepare("SELECT * FROM subscribers WHERE paused = 0").all()).results : [];
    for (const subscriber of subscribers) {
      const pending = await env.DB.prepare("SELECT * FROM delivery_batches WHERE subscriber_id = ? AND sent_at IS NULL ORDER BY created_at LIMIT 1").bind(subscriber.id).first();
      if (pending) {
        const keys = JSON.parse(pending.match_keys);
        const stillMatching = new Set(selectMatches(feed, JSON.parse(subscriber.rules), new Set()).map(match => match.key));
        if (pending.attempts >= 3 || Date.now() - pending.created_at > 86400000 || keys.some(key => !stillMatching.has(key))) {
          await env.DB.prepare("UPDATE delivery_batches SET sent_at = -1, message = '{}' WHERE id = ?").bind(pending.id).run();
        } else if (await deliverBatch(env, subscriber, pending)) sent++;
        continue;
      }
      const seen = new Set((await env.DB.prepare("SELECT match_key FROM sent_matches WHERE subscriber_id = ?").bind(subscriber.id).all()).results.map(row => row.match_key));
      const rules = validateAlerts(JSON.parse(subscriber.rules), courseNames(feed));
      const matches = selectMatches(feed, rules, seen).slice(0, 100);
      if (matches.length && await enqueue(env, subscriber, matches, feed.checkedAt)) sent++;
    }
    await env.DB.prepare("DELETE FROM access_tokens WHERE expires_at < ?").bind(Date.now()).run();
    await env.DB.prepare("DELETE FROM link_requests WHERE created_at < ?").bind(Date.now() - 2 * 86400000).run();
    await env.DB.prepare("DELETE FROM sent_matches WHERE sent_at < ?").bind(Date.now() - 90 * 86400000).run();
    const push = await checkPushAlerts(env, feed, selectMatches);
    return { configured: true, sent, pushSent: push.sent, pushFailed: push.failed };
  } finally {
    await env.DB.prepare("DELETE FROM job_lock WHERE id = 1 AND owner = ?").bind(owner).run();
  }
}

export default {
  async scheduled(event, env, context) { context.waitUntil(checkAlerts(env)); },
  async fetch(request, env, context) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return json(null, 204);
    if (url.pathname === "/health") return json({ ok: true, emailConfigured: Boolean(env.EMAIL_RELAY_URL && env.EMAIL_RELAY_SECRET), emailEnabled: env.EMAIL_DELIVERY_ENABLED !== "false", pushConfigured: pushConfigured(env), signupEmailConfigured: signupEmailConfigured(env) });
    const origin = request.headers.get("Origin");
    if (origin && origin !== siteOrigin) return json({ error: "Origin not allowed." }, 403);
    if (url.pathname.startsWith("/push/")) {
      try {
        const result = await pushRequest(request, env, url.pathname);
        if (result?.newDevice) context.waitUntil(flushSignupEmails(env));
        return result ? json(result) : json({ error: "Not found." }, 404);
      }
      catch (error) { return json({ error: error.message || "Notification request failed." }, 400); }
    }
    if (url.pathname === "/request-link" && request.method === "POST") {
      if (env.EMAIL_DELIVERY_ENABLED === "false") return json({ error: "Email delivery is disabled. Open Alerts on the website." }, 409);
      if (!request.headers.get("Content-Type")?.startsWith("application/json")) return json({ error: "JSON required." }, 415);
      const body = await request.text();
      if (body.length > 512) return json({ error: "Request too large." }, 413);
      let email;
      try { email = JSON.parse(body).email?.trim().toLowerCase(); } catch { return json({ error: "Invalid request." }, 400); }
      if (typeof email !== "string" || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Enter a valid email address." }, 400);
      const day = Math.floor(Date.now() / 86400000);
      const keys = [`email:${await tokenDigest(email)}:${day}`, `ip:${await tokenDigest(request.headers.get("CF-Connecting-IP") || "unknown")}:${day}`];
      const limits = await env.DB.batch(keys.map((key, index) => env.DB.prepare("INSERT INTO link_requests (bucket, created_at) VALUES (?, ?) ON CONFLICT(bucket) DO UPDATE SET requests=requests+1 WHERE requests < ?").bind(key, Date.now(), index === 0 ? 3 : 10)));
      if (limits.every(result => result.meta.changes) && env.EMAIL_RELAY_SECRET) context.waitUntil((async () => {
        const subscriber = await env.DB.prepare("SELECT * FROM subscribers WHERE email = ?").bind(email).first();
        if (!subscriber) return;
        const manageLink = await issueToken(env, subscriber.id);
        const message = formatPersonalEmail(JSON.parse(subscriber.rules), [], manageLink, new Date().toISOString(), true, Boolean(subscriber.paused));
        await send(env, email, message);
      })());
      return json({ ok: true, message: "If this address has saved alerts, a new management link will be emailed. Limit: three requests per day." }, 202);
    }
    const bearer = request.headers.get("Authorization")?.replace(/^Bearer /, "") || "";
    if (url.pathname.startsWith("/admin/")) {
      if (!env.ADMIN_SECRET || await tokenDigest(bearer) !== await tokenDigest(env.ADMIN_SECRET)) return json({ error: "Unauthorized." }, 401);
      try {
        if (request.method === "POST" && url.pathname === "/admin/check") return json(await checkAlerts(env));
        if (request.method === "POST" && url.pathname === "/admin/enroll") {
          if (env.EMAIL_DELIVERY_ENABLED === "false" || !env.EMAIL_RELAY_SECRET || !env.EMAIL_RELAY_URL) return json({ error: "Email enrollment is disabled." }, 503);
          const { email } = await request.json();
          if (typeof email !== "string" || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Invalid email." }, 400);
          const existing = await env.DB.prepare("SELECT * FROM subscribers WHERE email = ?").bind(email.toLowerCase()).first();
          if (existing) return json({ ok: true, alreadyEnrolled: true });
          const subscriber = { id: crypto.randomUUID(), email: email.toLowerCase(), rules: JSON.stringify(defaultAlerts), paused: 0, version: 1 };
          await env.DB.prepare("INSERT INTO subscribers (id, email, rules, created_at) VALUES (?, ?, ?, ?)").bind(subscriber.id, subscriber.email, subscriber.rules, Date.now()).run();
          const delivered = await enqueue(env, subscriber, [], new Date().toISOString(), true);
          return json({ ok: true, enrolled: true, welcomeDelivered: delivered });
        }
      } catch { return json({ error: "Alert operation failed. Check private delivery status." }, 503); }
      return json({ error: "Not found." }, 404);
    }
    if (url.pathname !== "/preferences" || !["GET", "PUT"].includes(request.method)) return json({ error: "Not found." }, 404);
    const publicEditor = !bearer && Boolean(env.PUBLIC_EDITOR_EMAIL);
    if (!publicEditor && !/^[a-f0-9]{64}$/.test(bearer)) return json({ error: "Open the private link in your latest alert email." }, 401);
    const subscriber = publicEditor
      ? await env.DB.prepare("SELECT * FROM subscribers WHERE email = ?").bind(env.PUBLIC_EDITOR_EMAIL).first()
      : await env.DB.prepare("SELECT subscribers.* FROM subscribers JOIN access_tokens ON subscribers.id=access_tokens.subscriber_id WHERE access_tokens.digest = ? AND access_tokens.expires_at > ?").bind(await tokenDigest(bearer), Date.now()).first();
    if (!subscriber) return json({ error: "This link is invalid or expired. Use a newer alert email." }, 401);
    try {
      const feed = await getFeed();
      const courses = courseNames(feed);
      if (request.method === "GET") return json({ email: subscriber.email, rules: JSON.parse(subscriber.rules), paused: Boolean(subscriber.paused), version: subscriber.version, savedAt: subscriber.updated_at, courses, courseGroups: alertCourseGroups });
      if (!request.headers.get("Content-Type")?.startsWith("application/json")) return json({ error: "JSON required." }, 415);
      const body = await request.text();
      if (body.length > 24000) return json({ error: "Request too large." }, 413);
      const payload = JSON.parse(body);
      if (typeof payload.paused !== "boolean" || !Number.isInteger(payload.version)) return json({ error: "Invalid preferences." }, 400);
      const rules = validateAlerts(payload.rules, courses);
      const savedAt = Date.now();
      const result = await env.DB.prepare("UPDATE subscribers SET rules=?, paused=?, updated_at=?, version=version+1 WHERE id=? AND version=?").bind(JSON.stringify(rules), Number(payload.paused), savedAt, subscriber.id, payload.version).run();
      if (!result.meta.changes) return json({ error: "Not saved: alerts changed in another tab. Reload this page before editing again." }, 409);
      await env.DB.prepare("DELETE FROM delivery_batches WHERE subscriber_id = ? AND sent_at IS NULL").bind(subscriber.id).run();
      return json({ ok: true, version: payload.version + 1, savedAt });
    } catch (error) { return json({ error: error.message || "Unable to load preferences." }, 400); }
  },
};