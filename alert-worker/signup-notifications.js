export function signupEmailConfigured(env) {
  return Boolean(env.SIGNUP_EMAIL_TO && env.EMAIL_RELAY_URL && env.EMAIL_RELAY_SECRET);
}

export async function signupStatement(env, endpoint, deviceId, userAgent) {
  if (!env.SIGNUP_EMAIL_TO) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  const id = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  const deviceKind = /iPhone/i.test(userAgent) ? "iPhone" : /iPad/i.test(userAgent) ? "iPad" : /Android/i.test(userAgent) ? "Android" : "Browser device";
  return env.DB.prepare("INSERT OR IGNORE INTO signup_notifications (id, device_kind, created_at) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM push_devices WHERE id = ?)").bind(id, deviceKind, Date.now(), deviceId);
}

export async function flushSignupEmails(env) {
  if (!signupEmailConfigured(env)) return 0;
  const pending = (await env.DB.prepare("SELECT * FROM signup_notifications WHERE sent_at IS NULL AND claim_until < ? ORDER BY created_at LIMIT 10").bind(Date.now()).all()).results;
  let sent = 0;
  for (const signup of pending) {
    const claimed = await env.DB.prepare("UPDATE signup_notifications SET claim_until=?, attempts=attempts+1 WHERE id=? AND sent_at IS NULL AND claim_until < ?").bind(Date.now() + 120000, signup.id, Date.now()).run();
    if (!claimed.meta.changes) continue;
    try {
      const when = new Date(signup.created_at).toLocaleString("en-US", { timeZone: "America/New_York", timeZoneName: "short" });
      const subject = "New Golf With Jim notification signup";
      const body = `A new device registered for Golf With Jim tee-time notifications.\n\nDevice: ${signup.device_kind}\nRegistered: ${when}\n\nThis identifies a browser installation, not a verified person. No name or email is collected during push signup.\n\nManage alerts: https://fbp26.github.io/golfwithjim/alerts.html\n\nTee-time alerts remain push-only.`;
      const htmlBody = `<div style="font:15px/1.5 Arial,sans-serif;color:#17241e"><h2>New notification signup</h2><p>Device: ${signup.device_kind}<br>Registered: ${when}</p><p>This identifies a browser installation, not a verified person. No name or email is collected during push signup.</p><p><a href="https://fbp26.github.io/golfwithjim/alerts.html" style="display:inline-block;background:#245944;color:#fff;padding:12px 18px;border-radius:4px;text-decoration:none;font-weight:bold">Manage alerts</a></p><p>Tee-time alerts remain push-only.</p></div>`;
      const response = await fetch(env.EMAIL_RELAY_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=UTF-8" }, body: JSON.stringify({ action: "send-notification-email", secret: env.EMAIL_RELAY_SECRET, to: env.SIGNUP_EMAIL_TO, subject, body, htmlBody }), signal: AbortSignal.timeout(25000) });
      const result = await response.json().catch(() => null);
      if (!response.ok || result?.ok !== true) throw new Error(`Signup email was not accepted (HTTP ${response.status}).`);
      await env.DB.prepare("UPDATE signup_notifications SET sent_at=?, claim_until=0, last_error=NULL WHERE id=?").bind(Date.now(), signup.id).run();
      sent++;
    } catch (error) {
      const retryDelay = Math.min(3600000, 60000 * 2 ** Math.min(signup.attempts, 6));
      await env.DB.prepare("UPDATE signup_notifications SET claim_until=?, last_error=? WHERE id=?").bind(Date.now() + retryDelay, error.message, signup.id).run();
    }
  }
  return sent;
}