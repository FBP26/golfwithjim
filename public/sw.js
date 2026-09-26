self.addEventListener("install", event => { event.waitUntil(self.skipWaiting()); });
self.addEventListener("activate", event => { event.waitUntil(self.clients.claim()); });
self.addEventListener("push", event => {
  let message = {};
  try { message = event.data?.json() || {}; } catch {}
  event.waitUntil(self.registration.showNotification(message.title || "Golf With Jim", {
    body: message.body || "New tee-time availability. Open Golf With Jim to check.",
    icon: new URL("golf-icon.png", self.registration.scope).href,
    tag: message.tag || "golf-alert",
    data: { url: message.url || "./" },
  }));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "./", self.registration.scope);
  const url = target.href.startsWith(self.registration.scope) ? target.href : self.registration.scope;
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = clients.find(client => client.url.startsWith(self.registration.scope));
    if (existing) { await existing.navigate(url); return existing.focus(); }
    return self.clients.openWindow(url);
  })());
});