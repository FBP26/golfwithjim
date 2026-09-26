const api = "https://golfwithjim-alerts.fbp-api-worker.workers.dev/push/";
const status = document.getElementById("notification-status");
const enable = document.getElementById("enable-notifications");
const test = document.getElementById("test-notification");
const disable = document.getElementById("disable-notifications");
let registration;
let publicKey;

function message(text, error = false) {
  status.textContent = text;
  status.classList.toggle("error", error);
}

function controls(subscribed) {
  enable.hidden = subscribed;
  test.hidden = !subscribed;
  disable.hidden = !subscribed;
  enable.disabled = !publicKey;
}

async function request(action, subscription) {
  const response = await fetch(api + action, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscription: subscription.toJSON() }), signal: AbortSignal.timeout(30000) });
  const result = await response.json();
  if (!response.ok || result.ok !== true) throw new Error(result.error || "Notification request failed.");
  return result;
}

function waitForWorker(promise) {
  let timer;
  return Promise.race([promise, new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error("Notification setup did not finish. Close and reopen the Home Screen app, then try again.")), 15000);
  })]).finally(() => clearTimeout(timer));
}

async function initialize() {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  if (ios && !standalone) { message("On iPhone: Share > Add to Home Screen, then open the app to enable notifications. Requires iOS 16.4 or newer."); return; }
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) { message("Push notifications are unavailable in this browser."); return; }
  if (Notification.permission === "denied") { message("Notifications are blocked. Allow them in this app's notification settings, then reopen Alerts."); return; }
  try {
    await waitForWorker(navigator.serviceWorker.register("./sw.js", { scope: "./", updateViaCache: "none" }));
    registration = await waitForWorker(navigator.serviceWorker.ready);
    const response = await fetch(api + "config", { cache: "no-store", signal: AbortSignal.timeout(15000) });
    const config = await response.json();
    if (!response.ok || !config.configured) throw new Error("Notification service is not ready. Reload to try again.");
    publicKey = Uint8Array.from(atob(config.publicKey.replace(/-/g, "+").replace(/_/g, "/")), character => character.charCodeAt(0));
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) await request("subscribe", subscription);
    controls(Boolean(subscription));
    if (Notification.permission === "denied") { enable.disabled = true; message("Notifications are blocked. Allow them in this app's notification settings, then reopen Alerts."); }
    else message(subscription ? "Notifications enabled on this device." : "Notifications are off on this device.");
  } catch (error) { message(error.message, true); }
}

enable.addEventListener("click", async () => {
  enable.disabled = true;
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") throw new Error("Notifications were not allowed. Enable them in this app's notification settings to continue.");
    message("Enabling notifications...");
    const existing = await registration.pushManager.getSubscription();
    const subscription = existing || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey });
    await request("subscribe", subscription);
    controls(true);
    message("Notifications enabled. Send a test to confirm delivery.");
  } catch (error) { message(error.message, true); enable.disabled = false; }
});

test.addEventListener("click", async () => {
  test.disabled = true;
  message("Sending test notification...");
  try {
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) { controls(false); throw new Error("Enable notifications on this device first."); }
    await request("test", subscription);
    message("Test accepted by the push service. Check your notifications.");
  } catch (error) { message(error.message, true); }
  finally { test.disabled = false; }
});

disable.addEventListener("click", async () => {
  disable.disabled = true;
  try {
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) { await request("unsubscribe", subscription); await subscription.unsubscribe(); }
    controls(false);
    message("Notifications disabled on this device.");
  } catch (error) { message(error.message, true); }
  finally { disable.disabled = false; }
});

initialize();