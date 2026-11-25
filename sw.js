// TaskerBay service worker: the app opens instantly and works offline; data always comes fresh from the network.
const VERSION = "tb-v24";
const SHELL = ["./", "index.html", "css/app.css", "js/app.js", "js/store.js", "js/engine.js", "js/spell.js", "js/pdf.js", "js/sheetread.js", "js/templates.js", "js/config.js", "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return; // never cache Supabase/API traffic
  // Network first so updates show up straight away; fall back to the cached copy when offline.
  e.respondWith(fetch(e.request, { cache: "no-cache" }).then(r => { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request).then(r => r || caches.match("index.html"))));
});

// Popup notifications
self.addEventListener("push", e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: "TaskerBay", body: e.data ? e.data.text() : "" }; }
  const isTask = /^task-/.test(d.tag || "");
  e.waitUntil(self.registration.showNotification(d.title || "TaskerBay", {
    body: d.body || "", icon: "icons/icon-192.png", badge: "icons/icon-192.png", tag: d.tag || undefined, renotify: !!d.tag,
    // task reminders stay on screen until you act on them (computer and Android), with Done / Snooze buttons
    requireInteraction: isTask, vibrate: isTask ? [200, 100, 200] : undefined,
    actions: isTask ? [{ action: "done", title: "✓ Done" }, { action: "snooze", title: "⏰ Snooze" }] : [],
    data: { url: d.url || self.registration.scope }
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  let url = e.notification.data?.url || self.registration.scope;
  if (e.action === "done" || e.action === "snooze") url += (url.includes("#") ? "&" : "#") + "do=" + e.action;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(cs => {
    for (const c of cs) if (c.url.startsWith(self.registration.scope)) { c.postMessage({ type: "open", url }); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
