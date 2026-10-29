// Telefonun "Paylaş" menüsünden uygulamaya gönderilen dosyalar (Web Share Target).
// Dosyalar 'paylasilan' önbelleğine yazılır, uygulama #/havuz/paylasim adresinde onları alıp onay havuzuna ekler.
self.addEventListener('fetch', (olay) => {
  const adres = new URL(olay.request.url);
  if (olay.request.method !== 'POST' || !adres.pathname.endsWith('/paylas')) return;
  olay.respondWith(
    (async () => {
      try {
        const form = await olay.request.formData();
        const onbellek = await caches.open('paylasilan');
        let sira = 0;
        for (const dosya of form.getAll('dosyalar')) {
          if (typeof dosya === 'string') continue;
          await onbellek.put(
            new Request(`${self.registration.scope}paylasilan/${Date.now()}-${sira++}`),
            new Response(dosya, {
              headers: { 'Content-Type': dosya.type || 'application/octet-stream', 'X-Dosya-Adi': encodeURIComponent(dosya.name || 'Paylaşılan dosya') },
            }),
          );
        }
      } catch (e) {
        // Dosya alınamazsa uygulama yine havuz ekranında açılır.
      }
      return Response.redirect(`${self.registration.scope}#/havuz/paylasim`, 303);
    })(),
  );
});
