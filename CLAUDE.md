# Müteahhit Hesap Defteri

Plan: `Müteahhit Hesap Defteri – Proje Planı.pdf`. Arayüz ve kod adları Türkçe; önce telefon ekranı.

## Komutlar
- `npm run dev` · `npm test` · `npm run tip` (tip denetimi) · `npm run build` · `npm run onizle` (derlemeyi 4173'te sunar)
- Arka planda sunucu başlatırken `npm`/`npx` sarmalayıcısı kullanma: Windows'ta durdurulunca alttaki node
  süreci sahipsiz kalıp portu tutar. Bunun yerine: `exec node node_modules/vite/bin/vite.js preview --port 4173 --strictPort`
- PWA simgeleri `public/logo.svg`'den bir kez üretilir: `npx pwa-assets-generator`
- Service worker sert yenilemede (Shift+Yenile / ignoreCache) devre dışı kalır; internetsiz testi normal açılışla yap.

## Katmanlar
- `src/veri/` — Depo arayüzü (`depo.ts`), kayıt tipleri (`tipler.ts`), IndexedDB/Dexie uygulaması (`indexeddb/`).
  Supabase / Capacitor+SQLite geçişinde yalnızca bu katman ve `src/cihaz/` değişir.
- `src/servisler/` — iş kuralları. Kayıt yazma **yalnızca** `KayitServisi` üzerinden (işlem geçmişi orada yazılır).
- `src/hesap/` — saf hesap fonksiyonları (bakiye, kalan borç, bütçe); veritabanını bilmez, testlidir.
- `src/cihaz/` — kalıcı depolama, dosya kaydetme vb.
- Arayüz Depo/Dexie'yi doğrudan kullanmaz.

## Değişmez kurallar (Hesap ilkeleri)
- Tutarlar kuruş cinsinden tam sayı. Tarih 'YYYY-AA-GG', zaman ISO, id UUID v7.
- Bakiye hiçbir tabloda saklanmaz; hareketlerden hesaplanır. Gider ve ödeme ayrı; bağlantı `eslestirme`.
- Silme yok, iptal var; iptal bağlı kayıtlara yayılır (`BAGLI_KAYITLAR`).
- Gerekçe: kaydı giren aynı gün gerekçesiz düzeltebilir; sonra, başkasının kaydında ve onaylı kayıtta zorunlu.
- KDV her zaman ayrı saklanır; maliyete dahil mi raporda firma ayarı (`kdvMaliyeteDahil`, varsayılan dahil).
- Döviz: işlem tarihindeki kur kayıtta saklanır; ana tutar TL.
- Roller: yönetici, muhasebe, şantiye; yetki kısıtı Supabase aşamasında.
- Şema: `src/veri/indexeddb/sema.ts` — yayınlanmış sürüm değiştirilmez, yeni `db.version(n)` eklenir.

## Aşama 1 adımları
1. ✅ İskelet, veri katmanı, veritabanı yapısı
2. Uygulama kabuğu (PWA, ilk kurulum ekranı, alt menü, GitHub Pages)
3. Yedekleme · 4. Proje/bina sihirbazı · 5. Cariler · 6. Kasa/banka, transfer
7. Kalem bütçesi · 8. Alış/gider girişi · 9. Ödeme ve eşleştirme · 10. Çek/senet
11. Belgeler · 12. İptal/geçmiş ekranı, roller · 13. Telefonda uçtan uca deneme
