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
- Gerekçe yalnızca mali kayıtlarda (`MALI_KAYIT`, kayitServisi.ts): kaydı giren aynı gün gerekçesiz düzeltebilir; sonra,
  başkasının kaydında ve onaylı kayıtta zorunlu. Ayarlar, firma/kullanıcı bilgisi, kartlar ve belgeler gerekçesiz değişir;
  hepsi yine geçmişe yazılır. Ekran gerekçeyi yalnızca servis `GerekceGerekliHatasi` verince sorar.
- KDV her zaman ayrı saklanır; maliyete dahil mi raporda firma ayarı (`kdvMaliyeteDahil`, varsayılan dahil).
- Döviz: işlem tarihindeki kur kayıtta saklanır; ana tutar TL.
- Roller: yönetici, muhasebe, şantiye; yetki kısıtı Supabase aşamasında.
  Kullanıcılar `servisler/kullanici.ts`: en az bir yönetici kalır, kişi kendini çıkaramaz; cihazı kullanan kişi
  meta `aktifKullaniciId` (şifresiz, `cihazKullanicisiniDegistir`). Firma geneli geçmiş: `servisler/gecmis.ts` `firmaGecmisiGetir`.
- Şema: `src/veri/indexeddb/sema.ts` — yayınlanmış sürüm değiştirilmez, yeni `db.version(n)` eklenir. Kayıt dönüşümü
  `src/veri/gecisler.ts`'te yazılır; hem cihaz güncellemesi hem eski yedeğin geri yüklenmesi onu kullanır. Güncel: şema 6.
- İade faturası gider kaydıdır (`tur: 'iade'`), tutarları (tevkifat dahil) eksi. Bağlıysa tevkifat oranı asıl faturadan
  gelir; cari alacağı tevkifat sonrası tutardır ve asıl faturanın kalanına, tevkifatı asıl faturanın ödenmemiş tevkifatına
  düşülür (`eslestirme.kaynakTur = 'iade'`, hedefTur 'gider' / 'tevkifat'). Artan cari alacağı sonraki faturalara mahsup
  edilir ya da tahsilatla kapanır (hedefTur 'iade').
- Çek/senet (`servisler/cek.ts`): alınan çek cariden tahsilattır (hesapId null), tahsilde hesaba girer; ciro ve verilen çek
  cariye ödemedir (faturalara dağıtılır), verilen çek ödenince hesaptan çıkar. Geri dönüşte ödeme/tahsilat kalır, cari ekstresi
  etkisini geri alır; ödemenin fatura eşleştirmeleri kaldırılır. Çekle yapılan kayıt ödeme ekranından iptal edilmez.
- Belge (`servisler/belge.ts`): künye `belge` (geçmişe yazılır), dosya `belgeDosyasi` (yedekte base64). Fotoğraf eklemeden
  önce cihazda küçültülür (`cihaz.resimKucult`, en uzun kenar 1600 px JPEG). Bağlı kayıt iptal edilince belgesi de iptal olur.
- KDV tevkifatı satırda; cariye borç = toplam − tevkifat (`giderBorcu`), maliyet = toplam.
  Tevkifat sistemdeki tek "Vergi dairesi" carisine (rol `vergi_dairesi`) borçtur; saklanmaz, giderlerden hesaplanır.
  Ödemesi `eslestirme.hedefTur = 'tevkifat'` (hedefId = gider) ile kapanır; aylık liste `hesap/tevkifat.ts`.

## Ortak giriş ve arama
- Tutar, telefon, IBAN alanları yalnızca `src/arayuz/Girdiler.tsx` (`TutarGirdisi`, `TelefonGirdisi`, `IbanGirdisi`);
  biçim `src/hesap/bicim.ts` (Portföy Defteri ile aynı). Tutar `tlOku` ile okunur.
- Arama ve ad tekrarı denetimi `src/hesap/metin.ts` (`aramaUyar`, `aramaAnahtari`): İ/i, I/ı ve Türkçe harfsiz yazım eşleşir;
  kelimeler ayrı ayrı aranır.
- İl/ilçe/mahalle `src/veri/sabit/turkiyeAdres.json` (Portföy Defteri verisi), `servisler/adres.ts` ile ilk kullanımda yüklenir.
  Varsayılan il Antalya. Firma logosu `firma.logo` (data URL, 600 px, PNG şeffaflığı korunur).

## Gider formu
- Hızlı giriş üstte (proje·tarih özeti, fotoğraf, büyük tutar, son 3 kalem düğmesi, cari, ödeme); KDV/tevkifat,
  miktar, fatura no/vade katlanır. Altta sabit "toplam · Kaydet" çubuğu.
- Cari hiçbir zaman hazır seçili gelmez (yanlış cariye borç riski): son 3 cari düğme (`sonCariler`), seçilen kalemde
  en son kullanılan cari başta ★ ile vurgulu ama seçilmemiş.

## Bina krokisi ve arsa sahipleri (şema 6)
- Kroki `arayuz/Kroki.tsx`, işlemler `servisler/bina.ts`: katlar satır, dikey hatlar (`bagimsizBolum.hat`) sütun.
  Hat/kat/kutucuk seçimi; toplu özellik yalnız doldurulan alanları yazar (hat şablonu saklanmaz); bloktan kopyalama
  kat sırası + hat ile eşleşir. Renk görünümleri Satış ve (kat karşılığında) Sahiplik.
  Seç modunda sürükleyerek dikdörtgen seçim (`arayuz/surukleSecim.ts`; telefonda basılı tutup kaydırma).
  Kutucukta numara ve `kutucukOzeti` (3+1 · 136 m² · KB). Kroki dışında bölüm numarası her yerde blok harfiyle
  yazılır: `bolumNo(blokAdi, no)` → "A-20" (`hesap/bolum.ts`).
- Sonradan blok (`blokEkle`, "X Blok ile aynı") ve kat (`katEkle`: üste normal, çatı, alta bodrum) eklenir;
  mevcut bölüm numaraları değişmez, yeni bölümler bloktaki en büyük numaradan devam eder.
- Arsa sahipleri `servisler/arsaSahibi.ts`, hesap `hesap/arsaPayi.ts`: sözleşmede paylaşım oranı, arsa sahipleri ve
  hisseleri (%100), pay yöntemi (brüt/net/adet). Tahsis edilen bölüm `sahiplik: 'arsa_sahibi'` ve satışa kapalı olur;
  tahsisli arsa sahibi sözleşmeden, sözleşmedeki cari kartı iptalden korunur. Sözleşme ve tahsis mali kayıttır.

## Aşama 1 adımları
1. ✅ İskelet, veri katmanı, veritabanı yapısı
2. ✅ Uygulama kabuğu: PWA, ilk kurulum, alt menü, GitHub Pages yayını
3. ✅ Yedekleme · 4. ✅ Proje/bina sihirbazı · 5. ✅ Cariler, açılış bakiyesi, proje ortakları · 6. ✅ Kasa/banka, transfer
7. ✅ Kalem bütçesi · 8. ✅ Alış/gider girişi, ödeme/tahsilat ve eşleştirme, cari ekstresi
9. ✅ İade faturası / tedarikçi iadesi · 10. ✅ Çek/senet
11. ✅ Belgeler · 12. ✅ İptal/geçmiş ekranı, roller · 13. Telefonda uçtan uca deneme

## Aşama 3'te: ilerleme takibi (planlandı, ekran 3. aşamada)
Amaç: proje ne kadar ilerledi, ne kadar harcandı; harcama ilerlemenin önüne geçince erken uyarı.
- **Takip başlıkları** (var: `takipBasligi`): durum (başlamadı/devam/tamamlandı), başlangıç ve bitiş tarihi.
  "Devam eden aşama" = durumu `devam` olanlar, `sira`ya göre ilki (birden çoksa "Kaba inşaat +1").
- **Ana kalem tamamlanma yüzdesi**: elle girilir; 2. aşamada hakedişten önerilir (hakediş miktarı / sözleşme
  miktarı), kullanıcı onaylarsa kaydedilir. Yüzde alt kalemlerde değil, ana kalemde tutulur.
- **Veri — şema 7'de yeni tablo** `kalemIlerlemesi` (FirmaKaydi): `projeId`, `kalemId` (ana kalem), `tarih`,
  `yuzde` (0–100), `kaynak: 'elle' | 'hakedis'`, `hakedisId | null`, `not`. Dizin: `id, firmaId, projeId, kalemId, tarih`.
  Güncelleme eski kaydı değiştirmez, yeni tarihli satır eklenir (geçmiş ve ilerleme grafiği buradan);
  geçerli yüzde = kalemin en yeni tarihli (eşitse en son girilen) iptal edilmemiş kaydı. Yanlış giriş iptal edilir.
  Başka tabloya alan eklenmez; yedek/geri yükleme yeni tabloyu kendiliğinden taşır (geçişte boş tablo).
- **Hesap** (`src/hesap/ilerleme.ts`, saf ve testli):
  - Genel ilerleme = Σ(ana kalem bütçesi × yüzde) / Σ ana kalem bütçesi; bütçesi olmayan kalem girmez.
  - Harcanan = `kalemGerceklesen` (KDV dahil/hariç firma ayarına göre, iadeler düşülmüş); harcama yüzdesi =
    harcanan / toplam bütçe. Bütçe yoksa yüzdeler gösterilmez, yalnızca tutar.
  - Erken uyarı: harcama yüzdesi − ilerleme yüzdesi > eşik (varsayılan 10 puan; sonra firma ayarı). Proje
    ve ana kalem düzeyinde ayrı hesaplanır; kalemde o kalemin bütçesi ve harcananı kullanılır.
- **Projeler listesi kartı**: ilerleme yüzdesi ve çubuğu, bütçe harcama yüzdesi, devam eden aşamanın adı;
  harcama ilerlemeyi eşikten fazla geçmişse uyarı işareti. Hesap tek sorguda (`projeleriListele` genişler).
