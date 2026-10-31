// Daily Debate service worker: push reminders only. No caching, no offline
// mode, no fetch handler — it never sits between the app and the network.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === "string" ? data.title : "Daily Debate";
  const url = typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === "string" ? data.body : "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: "daily-debate-reminder",
      data: { url, id: typeof data.id === "string" ? data.id : null },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const { url = "/", id = null } = event.notification.data || {};
  event.waitUntil(
    (async () => {
      if (id) {
        try {
          await fetch("/api/push/opened", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id }),
          });
        } catch {
          // Attribution is best effort.
        }
      }
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin && "focus" in client) {
          await client.navigate(url).catch(() => undefined);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })(),
  );
});
