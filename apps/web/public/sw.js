// The hub's service worker exists for one thing: showing the "daily brief is
// ready" notification and opening the hub when it is tapped. It caches nothing,
// so every figure still comes from the server, behind the login.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let notice = { title: 'הכספים שלנו', body: 'הסיכום היומי מוכן. הקישו כדי לראות.', url: '/?brief=1' };
  try { notice = { ...notice, ...event.data.json() }; } catch { /* a push with no readable payload still shows the default */ }
  // One notification at a time: a new brief replaces yesterday's unread one.
  event.waitUntil(self.registration.showNotification(notice.title, { body: notice.body, icon: '/icon.svg', badge: '/icon.svg', tag: 'daily-brief', dir: 'rtl', lang: 'he', data: { url: notice.url } }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin);
  // Same origin only, whatever the payload said.
  const target = url.origin === self.location.origin ? url.href : self.location.origin + '/';
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of open) { if ('focus' in client) { await client.focus(); if ('navigate' in client) await client.navigate(target).catch(() => undefined); return; } }
    await self.clients.openWindow(target);
  })());
});
