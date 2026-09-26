import { buildPushPayload } from "@block65/webcrypto-web-push";

export function validateSubscription(value) {
  if (!value || typeof value.endpoint !== "string" || value.endpoint.length > 2048) throw new Error("Invalid push subscription.");
  const url = new URL(value.endpoint);
  const host = url.hostname;
  const allowed = host === "web.push.apple.com" || host.endsWith(".push.apple.com") || host === "fcm.googleapis.com" || host === "updates.push.services.mozilla.com";
  if (!allowed || url.protocol !== "https:" || url.port || url.username || url.password || url.hash) throw new Error("Unsupported push service.");
  if (!/^[A-Za-z0-9_-]{87}$/.test(value.keys?.p256dh || "") || !/^[A-Za-z0-9_-]{22}$/.test(value.keys?.auth || "")) throw new Error("Invalid push encryption keys.");
  return { endpoint: url.href, expirationTime: null, keys: { p256dh: value.keys.p256dh, auth: value.keys.auth } };
}

export function pushConfigured(env) {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
}

export async function sendPush(env, subscription, notification) {
  const payload = await buildPushPayload({ data: JSON.stringify(notification), options: { ttl: 900 } }, subscription, {
    subject: "mailto:fbpool07@gmail.com", publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY,
  });
  return fetch(subscription.endpoint, { ...payload, redirect: "manual", signal: AbortSignal.timeout(20000) });
}

export async function pushRequest(request, env, path) {
  if (path === "/push/config" && request.method === "GET") return { publicKey: env.VAPID_PUBLIC_KEY || "", configured: pushConfigured(env) };
  if (!["/push/subscribe", "/push/unsubscribe", "/push/test"].includes(path) || request.method !== "POST") return null;
  if (!pushConfigured(env)) throw new Error("Push notifications are not configured yet.");
  if (!request.headers.get("Content-Type")?.startsWith("application/json")) throw new Error("JSON required.");
  const body = await request.text();
  if (body.length > 5000) throw new Error("Request too large.");
  const subscription = validateSubscription(JSON.parse(body).subscription);
  const subscriber = await env.DB.prepare("SELECT id FROM subscribers WHERE email = ?").bind(env.PUBLIC_EDITOR_EMAIL || "").first();
  if (!subscriber) throw new Error("Alerts are not configured.");
  const bucket = `push:${request.headers.get("CF-Connecting-IP") || "unknown"}:${Math.floor(Date.now() / 86400000)}`;
  const limit = await env.DB.prepare("INSERT INTO link_requests (bucket, created_at) VALUES (?, ?) ON CONFLICT(bucket) DO UPDATE SET requests=requests+1 WHERE requests < 60").bind(bucket, Date.now()).run();
  if (!limit.meta.changes) throw new Error("Too many notification requests. Try again tomorrow.");
  const device = await env.DB.prepare("SELECT * FROM push_devices WHERE endpoint = ? AND subscriber_id = ?").bind(subscription.endpoint, subscriber.id).first();
  if (device && JSON.parse(device.subscription).keys.auth !== subscription.keys.auth) throw new Error("This device subscription has changed. Enable notifications again.");
  if (path === "/push/unsubscribe") {
    if (device) await env.DB.prepare("DELETE FROM push_devices WHERE id = ?").bind(device.id).run();
    return { ok: true };
  }
  if (path === "/push/subscribe") {
    const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM push_devices WHERE subscriber_id = ?").bind(subscriber.id).first();
    if (!device && count.total >= 10) throw new Error("Ten devices are already enabled. Disable notifications on an old device first.");
    await env.DB.prepare("INSERT INTO push_devices (id, subscriber_id, endpoint, subscription, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET subscription=excluded.subscription").bind(crypto.randomUUID(), subscriber.id, subscription.endpoint, JSON.stringify(subscription), Date.now()).run();
    return { ok: true };
  }
  if (!device) throw new Error("Enable notifications on this device first.");
  const response = await sendPush(env, subscription, { title: "Golf With Jim", body: "Push notifications are ready. Your saved tee-time alerts will appear here.", tag: "golf-test", url: "alerts.html" });
  if (response.status === 404 || response.status === 410) await env.DB.prepare("DELETE FROM push_devices WHERE id = ?").bind(device.id).run();
  if (!response.ok) throw new Error("The push service did not accept the test. Enable notifications again and retry.");
  return { ok: true, accepted: true };
}

export async function checkPushAlerts(env, feed, selectMatches) {
  if (!pushConfigured(env)) return { sent: 0, failed: 0 };
  let sent = 0;
  let failed = 0;
  const devices = (await env.DB.prepare("SELECT push_devices.*, subscribers.rules FROM push_devices JOIN subscribers ON subscribers.id = push_devices.subscriber_id WHERE subscribers.paused = 0").all()).results;
  for (const device of devices) {
    try {
      const seen = new Set((await env.DB.prepare("SELECT match_key FROM push_matches WHERE device_id = ?").bind(device.id).all()).results.map(row => row.match_key));
      const matches = selectMatches(feed, JSON.parse(device.rules), seen).slice(0, 100);
      if (!matches.length) continue;
      const body = matches.slice(0, 3).map(({ teeTime }) => `${teeTime.course}: ${teeTime.date} ${teeTime.time}, $${teeTime.allInPrice.toFixed(2)}`).join("\n");
      const response = await sendPush(env, JSON.parse(device.subscription), { title: `Golf With Jim: ${matches.length} matching tee time${matches.length === 1 ? "" : "s"}`, body, tag: `golf-${Date.now()}`, url: "./" });
      if (response.status === 404 || response.status === 410) { await env.DB.prepare("DELETE FROM push_devices WHERE id = ?").bind(device.id).run(); continue; }
      if (!response.ok) { failed++; continue; }
      for (let offset = 0; offset < matches.length; offset += 25) {
        const chunk = matches.slice(offset, offset + 25);
        await env.DB.prepare(`INSERT OR IGNORE INTO push_matches (device_id, match_key, sent_at) VALUES ${chunk.map(() => "(?, ?, ?)").join(", ")}`).bind(...chunk.flatMap(match => [device.id, match.key, Date.now()])).run();
      }
      sent++;
    } catch { failed++; }
  }
  await env.DB.prepare("DELETE FROM push_matches WHERE sent_at < ?").bind(Date.now() - 90 * 86400000).run();
  return { sent, failed };
}