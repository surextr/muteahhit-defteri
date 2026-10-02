# Müteahhit Hesap Defteri

Plan: `Müteahhit Hesap Defteri – Proje Planı.pdf`. Arayüz ve kod adları Türkçe; önce telefon ekranı.

## Komutlar
- `npm run dev` · `npm test` · `npm run tip` (tip denetimi) · `npm run build` · `npm run onizle` (derlemeyi 4173'te sunar)
- Arka planda sunucu başlatırken `npm`/`npx` sarmalayıcısı kullanma: Windows'ta durdurulunca alttaki node
  süreci sahipsiz kalıp portu tutar. Bunun yerine: `exec node node_modules/vite/bin/vite.js preview --port 4173 --strictPort`
- Yayın: `master`'a gönderim → `.github/workflows/yayin.yml` (test + derleme + Pages) → https://surextr.github.io/muteahhit-defteri/
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
- Şema: `src/veri/indexeddb/sema.ts` — yayınlanmış sürüm değiştirilmez, yeni `db.version(n)` eklenir. Kayıt dönüşümü
  `src/veri/gecisler.ts`'te yazılır; hem cihaz güncellemesi hem eski yedeğin geri yüklenmesi onu kullanır. Güncel: şema 3.
- İade faturası gider kaydıdır (`tur: 'iade'`), tutarları (tevkifat dahil) eksi. Bağlıysa tevkifat oranı asıl faturadan
  gelir; cari alacağı tevkifat sonrası tutardır ve asıl faturanın kalanına, tevkifatı asıl faturanın ödenmemiş tevkifatına
  düşülür (`eslestirme.kaynakTur = 'iade'`, hedefTur 'gider' / 'tevkifat'). Artan cari alacağı sonraki faturalara mahsup
  edilir ya da tahsilatla kapanır (hedefTur 'iade').
- Çek/senet (`servisler/cek.ts`): alınan çek cariden tahsilattır (hesapId null), tahsilde hesaba girer; ciro ve verilen çek
  cariye ödemedir (faturalara dağıtılır), verilen çek ödenince hesaptan çıkar. Geri dönüşte ödeme/tahsilat kalır, cari ekstresi
  etkisini geri alır; ödemenin fatura eşleştirmeleri kaldırılır. Çekle yapılan kayıt ödeme ekranından iptal edilmez.
- KDV tevkifatı satırda; cariye borç = toplam − tevkifat (`giderBorcu`), maliyet = toplam.
  Tevkifat sistemdeki tek "Vergi dairesi" carisine (rol `vergi_dairesi`) borçtur; saklanmaz, giderlerden hesaplanır.
  Ödemesi `eslestirme.hedefTur = 'tevkifat'` (hedefId = gider) ile kapanır; aylık liste `hesap/tevkifat.ts`.

## Aşama 1 adımları
1. ✅ İskelet, veri katmanı, veritabanı yapısı
2. ✅ Uygulama kabuğu: PWA, ilk kurulum, alt menü, GitHub Pages yayını
3. ✅ Yedekleme · 4. ✅ Proje/bina sihirbazı · 5. ✅ Cariler, açılış bakiyesi, proje ortakları · 6. ✅ Kasa/banka, transfer
7. ✅ Kalem bütçesi · 8. ✅ Alış/gider girişi, ödeme/tahsilat ve eşleştirme, cari ekstresi
9. ✅ İade faturası / tedarikçi iadesi · 10. ✅ Çek/senet
11. Belgeler · 12. İptal/geçmiş ekranı, roller · 13. Telefonda uçtan uca deneme
