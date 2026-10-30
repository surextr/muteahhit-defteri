// Vade hatırlatması anlık bildirimleri (Web Push). Sunucu şifreli JSON gönderir: { baslik, govde, yol, etiket }.
self.addEventListener('push', (olay) => {
  let veri = {};
  try {
    veri = olay.data ? olay.data.json() : {};
  } catch {
    veri = { govde: olay.data ? olay.data.text() : '' };
  }
  olay.waitUntil(
    self.registration.showNotification(veri.baslik || 'Müteahhit Hesap Defteri', {
      body: veri.govde || '',
      icon: 'pwa-192x192.png',
      badge: 'pwa-64x64.png',
      tag: veri.etiket || 'muteahhit',
      lang: 'tr',
      data: { yol: veri.yol || 'bugun' },
    }),
  );
});

// Bildirime dokununca açık uygulama penceresi öne gelir ve ilgili ekrana gider; yoksa yeni pencere açılır.
self.addEventListener('notificationclick', (olay) => {
  olay.notification.close();
  const hedef = `${self.registration.scope}#/${(olay.notification.data && olay.notification.data.yol) || 'bugun'}`;
  olay.waitUntil(
    (async () => {
      const pencereler = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const p of pencereler) {
        if (p.url.startsWith(self.registration.scope)) {
          await p.focus();
          if ('navigate' in p) await p.navigate(hedef).catch(() => undefined);
          return;
        }
      }
      await self.clients.openWindow(hedef);
    })(),
  );
});
