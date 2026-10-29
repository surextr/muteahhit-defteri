# Müteahhit Hesap Defteri

Plan: `Müteahhit Hesap Defteri – Proje Planı.pdf`. Arayüz ve kod adları Türkçe; önce telefon ekranı.

## Komutlar
- `npm run dev` · `npm test` · `npm run tip` (tip denetimi) · `npm run build` · `npm run onizle` (derlemeyi 4173'te sunar)
- Arka planda sunucu başlatırken `npm`/`npx` sarmalayıcısı kullanma: Windows'ta durdurulunca alttaki node
  süreci sahipsiz kalıp portu tutar. Bunun yerine: `exec node node_modules/vite/bin/vite.js preview --port 4173 --strictPort`
- Yayın: `master`'a gönderim → `.github/workflows/yayin.yml` (test + derleme + `sunucu/api` → `dist/api` + FTP) →
  https://muteahhit.surex.tr (cPanel). Kurulum: `sunucu/KURULUM.md`. GitHub Pages kullanılmaz.
- PWA simgeleri `public/logo.svg`'den bir kez üretilir: `npx pwa-assets-generator`
- Service worker sert yenilemede (Shift+Yenile / ignoreCache) devre dışı kalır; internetsiz testi normal açılışla yap.

## Katmanlar
- `src/veri/` — Depo arayüzü (`depo.ts`), kayıt tipleri (`tipler.ts`), IndexedDB/Dexie uygulaması (`indexeddb/`).
  Bulut eşitleme / Capacitor+SQLite geçişinde yalnızca bu katman ve `src/cihaz/` değişir.
- `src/servisler/` — iş kuralları. Kayıt yazma **yalnızca** `KayitServisi` üzerinden (işlem geçmişi orada yazılır).
- `src/hesap/` — saf hesap fonksiyonları (bakiye, kalan borç, bütçe); veritabanını bilmez, testlidir.
- `src/cihaz/` — kalıcı depolama, dosya kaydetme vb.
- `src/bulut/` — kendi sunucumuzdaki PHP API (`sunucu/api`, aynı adreste `/api/`; istek `bulut/api.ts`): e-posta + şifre
  girişi (kayıtta e-posta onayı, HttpOnly oturum çerezi; ekran `arayuz/HesapGirisi.tsx`), yapay zekâ ile sözleşme
  düzenleme (günlük hak, model `claude-opus-5-5`, anahtar sunucuda web dışındaki `muteahhit-ayarlar.php`'de; gönderilen
  yalnız usta tipi ve maskelenmiş özel şartlar, `hesap/maskele.ts` = `sunucu/api/_ic/yapay_zeka.php`) ve bulut eşitleme
  (aşağıda). Onay bağlantısı `/api/?islem=onay` → `#yz-onay=…` → `onayDonusunuIsle` (main.tsx) Ayarlar'a çevirir; service
  worker `/api/`'yi yakalamaz. MySQL şeması `sunucu/kurulum.sql`. `npm run dev`'de `/api/` canlı sunucuya gider
  (`API_HEDEF=http://127.0.0.1:8090` ile yerel PHP).
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
- Roller: yönetici, muhasebe, şantiye; yetkiler aşağıda (Rol yetkileri).
  Kullanıcılar `servisler/kullanici.ts`: en az bir yönetici kalır, kişi kendini çıkaramaz; cihazı kullanan kişi
  meta `aktifKullaniciId` (şifresiz, `cihazKullanicisiniDegistir`). Firma geneli geçmiş: `servisler/gecmis.ts` `firmaGecmisiGetir`.
- Şema: `src/veri/indexeddb/sema.ts` — yayınlanmış sürüm değiştirilmez, yeni `db.version(n)` eklenir. Kayıt dönüşümü
  `src/veri/gecisler.ts`'te yazılır; hem cihaz güncellemesi hem eski yedeğin geri yüklenmesi onu kullanır (her sürüm için
  `TABLO_DONUSTURUCULERI[n]` adımı şart; test denetler). Güncel: şema 19.
  Yeni tablo eklenince `sunucu/api/_ic/yetkiler.json` › `tablolar`a da yazılır (test denetler).
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
- Cari seçimi her yerde `CariSecici` (arama + `hizliEkle`: ekrandan çıkmadan ad/telefonla kart açar, `secenekler` rol
  düğmeleri). Arsa sahibi ve ortak olarak her cari seçilebilir; rol yoksa kayıtta `rolEkle` (servisler/cari.ts) ekler.
- Arama ve ad tekrarı denetimi `src/hesap/metin.ts` (`aramaUyar`, `aramaAnahtari`): İ/i, I/ı ve Türkçe harfsiz yazım eşleşir;
  kelimeler ayrı ayrı aranır.
- İl/ilçe/mahalle `src/veri/sabit/turkiyeAdres.json` (Portföy Defteri verisi), `servisler/adres.ts` ile ilk kullanımda yüklenir.
  Varsayılan il Antalya. Firma logosu `firma.logo` (data URL, 600 px, PNG şeffaflığı korunur).

## Gider formu
- Hızlı giriş üstte (proje·tarih özeti, fotoğraf, büyük tutar, son 3 kalem düğmesi, cari, ödeme); KDV/tevkifat,
  miktar, fatura no/vade katlanır. Altta sabit "toplam · Kaydet" çubuğu.
- Cari hiçbir zaman hazır seçili gelmez (yanlış cariye borç riski): son 3 cari düğme (`sonCariler`), seçilen kalemde
  en son kullanılan cari başta ★ ile vurgulu ama seçilmemiş.
- "Carisiz" de bilinçli seçilen bir düğmedir (`carisiz` alanı); cari ya da Carisiz seçilmeden kaydedilmez.
  Kasa hazır gelmez; yalnızca Carisiz, Peşin ya da Kısmen seçilince son kullanılan kasa doldurulur.

## Oda tipi (şema 7)
- Bölümde `odaSayisi` + `salonSayisi` ("3+1"), `dubleks` ayrı işaret ('bahce' | 'cati' | null); serbest yazı yok.
  Eski yazı geçişte çözülür, çözülemeyen kısım "diğer özellikler"e eklenir (`odaTipiMetniCoz`).
- Liste: hazır 1+0…5+1 + firmanın eklediği (`firma.ayarlar.odaTipleri.eklenen`) − gizlenen; kullanım sıklığına göre
  sıralanır (`hesap/odaTipi.ts`, `servisler/odaTipi.ts`). Seçim `arayuz/OdaTipiSecimi.tsx` (daire ve toplu form).
  Çatı dubleksi katındaki yeni daireler `dubleks: 'cati'` gelir.

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
2. ✅ Uygulama kabuğu: PWA, ilk kurulum, alt menü, yayın (önce GitHub Pages, şimdi muteahhit.surex.tr)
3. ✅ Yedekleme · 4. ✅ Proje/bina sihirbazı · 5. ✅ Cariler, açılış bakiyesi, proje ortakları · 6. ✅ Kasa/banka, transfer
7. ✅ Kalem bütçesi · 8. ✅ Alış/gider girişi, ödeme/tahsilat ve eşleştirme, cari ekstresi
9. ✅ İade faturası / tedarikçi iadesi · 10. ✅ Çek/senet
11. ✅ Belgeler · 12. ✅ İptal/geçmiş ekranı, roller · 13. Telefonda uçtan uca deneme

## Kat karşılığı yükümlülükleri ve alacak (şema 8)
- Yükümlülükler (nakit plan `arsaSahibiOdemesi`, kira yardımı, gecikme cezası) cari borcu değildir; `hesap/katKarsiligi.ts`
  hesaplar (saklanmaz). Ödeme gider olarak girilir ("Ödeme yap" → `giderler/yeni/:proje/:cari/:kalem`, Peşin).
  Ödenen = projede arsa sahibine "Arsa ve kat karşılığı giderleri" ana kalemi ve altlarına yazılan giderler
  (gecikme cezası kalemi hariç, o ayrı), vadelere tarih sırasıyla dağıtılır. Ceza kalana girmez, ayrı görünür;
  birimi daire başı aylık, toplam aylık ya da günlük.
  Teslim: kesin tarih ya da `teslimSuresiAy` (Ruhsat takip başlığının bitişinden). Kira/ceza `teslimAlindi`da durur.
- Genel alacak `alacak` (kaynakTur 'ilaveImalat' | 'satis'): cari bakiyesinde alacak hareketi; cariden
  tahsilat açık alacakları en eski vadeden kapatır (`eslestirme.hedefTur = 'alacak'`). İlave imalat arsa sahibi
  öder + onaylandı/yapıldı → alacak; red/talep → alacak iptal (tahsil edilmişse engellenir).
  Gider satırı `ilaveImalatId` ile ilave imalata bağlanır (maliyet / alınan). Eski `taksit` tablosu kullanılmaz.
  Tahsilat formunda açık alacaklara dağıtım ödeme formundaki gibi görünür, elle değiştirilir (`alacakDagitimi`).
- Kalem `sistemKodu`: hazır kalemlerin değişmeyen kodu (`veri/sabit/hazirKalemKodlari.ts`); program kalemi adla değil
  kodla bulur, yoksa `sistemKalemiHazirla` oluşturur. Kod bir kez verilir, değiştirilmez.

## Usta tipleri (şema 9–10)
- `ustaTipi`: kalemler, sorumluluk soruları (varsayılan cevap boşsa her sözleşmede sorulur), hakediş şekli, varsayılan
  bütçe kalemi (kalem sistem kodu; sözleşmede satır başına değiştirilebilir), tipe özel şartlar, kapalı ortak maddeler,
  `sablonSurumu` (her kayıtta +1), `gizli`. Hazır 21 tip `veri/sabit/hazirUstaTipleri.ts` (sistem kodlu), ilk açılışta
  `hazirUstaTipleriniEkle` ile bir kez eklenir. Ortak sözleşme maddeleri `firma.ayarlar.ortakMaddeler` (kalıcı id).
- Sözleşme kurulurken şablon sözleşmeye kopyalanır (şablon değişse de sözleşme değişmez). Hakediş bütçe kalemine
  doğrudan değil, gider kaydı üzerinden yansır (adım 5).
- Tip ve kalem satırı yalnız gider yazılabilen kaleme bağlanır (`YAPRAK_KALEM_KODLARI`: alt kalem ya da alt kalemi
  olmayan ana kalem); satır kodu boşsa tipin varsayılanı. Sözleşme projede olmayan kaleme bağlanırsa kayıtta
  `sistemKalemiHazirla` ile projeye eklenir (adım 3).
- Hazır listede yeri değişen kalem kodunu korur (Temel yalıtımı → Yalıtım altı); eski projedeki kalem yerinde
  kalır, kodu `ESKI_KALEM_KONUMLARI` ile verilir.

## Usta sözleşmesi (şema 11)
- `ustaSozlesmesi`: tipten kurulur (`ustaSozlesmesiOlustur`, servisler/ustaSozlesmesi.ts): kalemler fiyatsız
  (bütçe kalemi satırdan ya da tipten), sorular → `sorumluluklar` (varsayılanlı cevaplı, diğeri `cevap: null`),
  firmanın ortak maddeleri (tipte kapalı olanlar hariç) → `ortakMaddeler` (`cevap` boş), özel şartlar satır satır.
  Tip adı ve `sablonSurumu` kopyalanır; şablon sonra değişse de sözleşme değişmez.
- Eksik bilgi (`hesap/ustaSozlesmesi.ts` `eksikBilgiler`): sözleşme tarihi, kalem adı/birim fiyatı, cevapsız sorumluluk,
  'sozlesmede' cevabın boş hükmü, boş ortak madde. Taslak eksikle kaydedilir, onaylanamaz. Başlama/bitiş tarihi ve
  miktar zorunlu değil (`sozlesmeUyarilari`); miktar boşsa yalnız birim fiyat anlaşılmıştır.
- Onay = imzalandı (`ustaSozlesmesiOnayla`). İmzalıda değişiklik gerekçe ister, `sozlesmeSurumu` +1, eksik bırakılamaz.
  `toplamTutar` kayıtta hesaplanır (miktarlı kalemler). Kalemlerin bütçe kalemleri kayıtta `sistemKalemiHazirla` ile
  projeye eklenir. Sözleşme taahhüttür, borç doğurmaz; iptal belgeye/ödeme planına/değişikliğe yayılır.
- Metin `sozlesmeMetni` (saf): İşveren = firma, Yüklenici = cari; boş bilgi "…" kalır, program uydurmaz.
  Ekran `arayuz/UstaSozlesmesi.tsx`: proje kartı, `#/sozlesmeler/yeni/:projeId`, `#/sozlesmeler/:id` (form, canlı eksik
  listesi, yapay zekâ ile özel şartlar), `#/sozlesmeler/:id/metin` (yazdır / PDF olarak kaydet; `@media print` yalnız
  `.sozlesme-belgesi`). İmzalanmamışsa "TASLAK" damgası. İmzalı sözleşme taraması `belge` (bagliTur 'ustaSozlesmesi').

## Cari branşları ve taşeron (şema 12)
- Meslek cari adına yazılmaz ("Ahmet Demir", "Duvarcı" değil "Ahmet Demir Duvarcı"). Branşlar `cari.ustaTipiIdleri`
  (usta tipi kimlikleri, ilki ana branş); yalnız `usta` ya da `taseron` rolünde tutulur (`BRANSLI_ROLLER`).
  `cari.yetkili`: firma adına imzalayan kişi. Güncellemede verilmeyen branş/yetkili korunur.
- Gösterim `hesap/brans.ts` (`bransKisaAdi` parantezli açıklamayı atar, `bransOzeti` "Taşeron · Sıvacı, Boyacı"),
  ekranda `cariRolMetni` (CariFormu.tsx), tipler `arayuz/useBranslar.ts`. Cari arama branşa da uyar; Cariler'de
  Usta/Taşeron süzgecinde branş süzgeci çıkar. Seçici `oncelikliBrans` ile o branştakileri başa alır.
- Usta sözleşmesi kurulurken kart sözleşmenin tipini bilmiyorsa branşı (gerekirse usta rolü) karta eklenir.
  Sözleşme metninde yüklenici: "Sıfatı: Duvarcı" / "Sıfatı: Taşeron (Kalıpçı)" (sözleşmenin tipinden), yetkili tarafta
  ve imzada.
- Eski kartlar: `addanBransOner` (hesap/brans.ts; adın sonundaki/başındaki/parantezdeki meslek sözcüğü, hazır tip
  kökleri `HAZIR_KOKLER`), ekran `#/cariler/brans-ayir` (Cariler'de uyarı), her öneri tek tek onaylanır.

## Toplu sözleşme (şema 13)
- `ustaSozlesmesi.bolumler`: sözleşmedeki işler (usta tipleri), ilki ana iş; her bölümde tip adı, şablon sürümü ve
  hakediş şekli. Bölüm anahtarı `ustaTipiId` (bir sözleşmede bir tip bir kez); kalem ve sorumluluk `ustaTipiId` ile
  bölüme bağlıdır. Üst düzey `ustaTipiId/ustaTipiAdi/sablonSurumu/hakedisSekli` kayıtta `anaIsAlanlari` ile
  bölümlerden yazılır (ad " + " ile); doğrudan değiştirilmez. Eski sözleşme geçişte tek bölüm olur.
- Kurma ve iş ekleme/çıkarma saf: `bolumEkle` (kalemler fiyatsız, sorular, sözleşmede olmayan özel şart satırları,
  bu tipte kapalı olmayan ortak maddeler firma sırasıyla), `bolumCikar` (kalem/soruları gider, son iş çıkmaz).
  `ustaSozlesmesiOlustur` `ustaTipiIdleri` alır; taşeron seçilince bütün branşları, ustada ana branşı gelir.
- Metin: konu "Sıvacı ve Boyacı işlerinin", tablo işlere göre grup başlığı + ara toplam (`satirTurleri`), sorumluluk
  iş adıyla, hakediş şekilleri farklıysa iş başına liste. Kalemsiz iş eksik bilgidir.

## Hakediş (şema 14)
- Usta tipinde `takipYontemi` ('metraj' | 'asama' | 'tutar'; hazır tiplerde kalıp ve tesisatlar aşama, diğerleri metraj;
  Ayarlar › Usta tiplerinden değişir). Sözleşmede: kaleme kalıcı `id`; bölümde tipten gelen `takipYontemi` (sözleşmede
  değişir; götürü iş = tutar) ve `asamalar` ({id, ad, tutar}; "Binanın katlarından
  öner" `katAsamaOnerisi`); `teminatOrani` (0 = yok). Aşamalı işte aşama yoksa ya da tutarı boşsa eksik bilgidir.
- `hakedis` yalnız imzalı sözleşmeden: satırlar (metraj: kalem miktarı, tutar = miktar × sözleşme birim fiyatı; aşama:
  aşama tutarı; tutar: yazılan), kesintiler (kalıcı; işlere oranla düşer, maliyeti de düşürür), KDV/tevkifat (varsayılan
  %0, önceki hakedişten gelir), teminat %, avans mahsubu. Hesap `hesap/hakedis.ts` (saf), servis `servisler/hakedis.ts`.
  Satır tutarları serviste sözleşmeden yeniden hesaplanır; ödenmiş aşama tekrar girmez; numara iptalde de yeniden kullanılmaz.
- Onay → `giderOlustur` (iş + bütçe kalemi başına satır, `gider.hakedisId`), avans mahsubu en eski açık ödemeden gidere
  eşleştirilir. Borç ve maliyet bu giderdendir; `cariBakiye` hakediş tablosunu saymaz. Hakedişten oluşan gider elle
  değiştirilmez/iptal edilmez; hakediş iptali gideri (BAGLI_KAYITLAR) ve eşleştirmeleri iptal eder, ödeme avansa döner.
  Teminat borcun içindedir, ödenecek = borç − teminat − avans. Ekran `arayuz/Hakedis.tsx` (`#/hakedisler/yeni/:sozlesmeId`,
  `#/hakedisler/:id`), sözleşme ekranında Hakedişler kartı.
- Hakediş belgesi `#/hakedisler/:id/belge` (`hesap/hakedisBelgesi.ts`, saf): taraflar/imzalar sözleşme metninden; kalem
  tablosu işlere göre, metrajda önceki/bu/toplam ("önceki" = numarası küçük onaylı hakedişler, `oncekiOnaylilar`); hesap
  özeti; toplam durum (sözleşmeye oranı, tutulan teminat). Görünüm `arayuz/BelgeGorunumu.tsx` (sözleşmeyle ortak; son madde
  imzalarla aynı sayfada `.sb-son`). Taslakta "TASLAK" damgası. İmzalı nüsha `belge` (bagliTur 'hakedis').

## Teminat, ilave iş, ödeme planı, taahhüt, SGK (şema 15)
- Teminat borcun içindedir; `teminatIadesi` tablosu serbest bırakılanı tutar (borç değişmez, ödeme ayrıca yapılır).
  `teminatDurumu` = onaylı hakedişlerin teminatı − serbest bırakılan. Hakedişi olan sözleşme iptal edilmez.
- Hakediş satırı `tur: 'ilave'`: sözleşmede olmayan iş (miktar × birim fiyat ya da tutar), bütçe kalemi işin kalemi.
- `odemePlani` (vade, tutar, açıklama): taahhüttür; `odemePlaniKaydet` listeyi bütün olarak kaydeder. Plan durumları
  (`hesap/taahhut.ts` `planDurumu`): sözleşmenin hakediş giderlerine eşleşen ödemeler en eski vadeden dağıtılır.
- Taahhüt tablosu `#/projeler/:id/taahhut` (`servisler/taahhut.ts`): imzalı sözleşmeler; sözleşme tutarı
  `sozlesmeTahminiTutari` (aşamalı işte aşama toplamı, diğerinde miktarlı kalemler; `toplamTutar` da böyle).
- SGK `#/projeler/:id/sgk` (`servisler/sgk.ts`, `hesap/sgk.ts`): ay bazında işçi, gün, prim, ödeyen, hakedişe dahil;
  önceki aydan taşıma; imzalı, süren sözleşmede o ay bildirim yoksa uyarı. Bizim ödediğimiz prim gider olarak girilir.

## Aşama 2 adımları
1. ✅ Kat karşılığı sözleşmesi ayrıntıları: tarih, teslim, gecikme cezası, kira yardımı, arsa sahibine nakit ödeme
   planı, ilave imalat. Sözleşme metni üretilmez; imzalı sözleşme belge olarak saklanır.
2. ✅ Usta tipleri ve kalem şablonları (21 hazır tip, Ayarlar'dan düzenlenebilir)
3. ✅ Usta sözleşmesi: form, eksik bilgi soruları, şablon metin, logolu PDF (tarayıcıdan), şablon sürümleri.
   Yapay zekâ kendi sunucumuzdaki PHP API ile (Supabase'den taşındı): anahtar sunucuda gizli; özellik için bir kerelik giriş;
   kullanıcı başına günlük sınır; yalnızca usta tipi ve özel şartlar metni gönderilir (kişisel bilgi yok);
   eksik bilgiyi kendisi doldurmaz, sorar; orijinal ve düzenlenmiş metin yan yana onaylanır;
   internetsiz şablonla devam edilir.
4. ✅ Taahhüt ve tahmini ödeme planı
5. ✅ Hakediş: metraj/aşama/tutar, kesinti, KDV, teminat, avans mahsubu (ilave iş ve ilerleme önerisi sonra)
6. ✅ SGK takibi
7. ✅ Uçtan uca deneme (telefon boyutunda, otomatik; gerçek telefonda kullanıcı denemesi ayrıca)

## Daire satışı (şema 16)
- `satis` (`servisler/satis.ts`, hesap `hesap/satis.ts`): bölüm + müşteri ile rezerve edilir (bölüm `rezerve`, cariye
  'musteri' rolü; arsa sahibine tahsisli ya da satışı olan bölüm satılmaz). Fiyat KDV dahil, indirim, `kdvOrani`, takas
  (açıklama + değer; nakit = net − takas), plan satırları (kapora/peşinat/taksit/teslimde; `planOner` eşit aylık taksit).
  Dövizli satış: `satis.doviz` (para birimi, KDV dahil dövizli fiyat, protokol kuru); TL fiyat = döviz × kur (serviste
  yeniden hesaplanır), plan ve alacaklar TL; protokolde kur sabitlenir, plan tablosunda döviz karşılığı. Kur farkı izlenmez.
  Protokol maddeleri firma ayarı `satisMaddeleri`nden kopyalanır (`HAZIR_SATIS_MADDELERI`).
- Rezervede alınan kapora cariden avans tahsilattır. İmza (`satisOnayla`, eksik varsa olmaz) plan satırları için
  `alacak` (kaynakTur 'satis') doğurur, bölüm `sozlesmeli` olur, müşterinin açık tahsilatları alacaklara vadeyle bağlanır.
  İmzalıda değişiklik gerekçe ister, `sozlesmeSurumu` +1, alacaklar plana eşitlenir (tahsil edilen satır çıkarılamaz).
  Tahsilatlı satış iptal edilmez; iptal alacak ve belgeye yayılır, bölüm satışa döner. Teslim bölüme yazılır.
- Ön satış protokolü `satisProtokolu` (saf, BelgeGorunumu ile), ekranlar `arayuz/Satis.tsx`: proje kartı, krokide
  "Satış yap", `#/satislar/yeni/:projeId[/:bolumId]`, `#/satislar/:id`, `#/satislar/:id/protokol`.

## İlerleme takibi (şema 17)
- `kalemIlerlemesi` (FirmaKaydi, mali değil): `projeId`, `kalemId` (ana kalem), `tarih`, `yuzde` (0–100, bir ondalık),
  `kaynak: 'elle' | 'hakedis'`, `hakedisId`, `not`. Güncelleme yeni satırdır; geçerli yüzde = en yeni tarihli (eşitse en son
  girilen) iptal edilmemiş kayıt (`gecerliIlerlemeler`). Yanlış giriş iptal edilir, bir önceki geçerli olur.
- Hesap `hesap/ilerleme.ts` (saf): genel ilerleme = Σ(ana kalem bütçesi × yüzde) / Σ bütçe (bütçesiz kalem girmez);
  projede hiç giriş yoksa yüzde ve uyarı yok, varsa girilmemiş kalem %0. Harcanan `butceAgaci` gerçekleşeni (KDV ayarına
  göre, iadeler düşülmüş); harcama yüzdesi = harcanan / bütçe. Uyarı: harcama − ilerleme > eşik (`uyariEsigi`: firma ayarı
  `ilerlemeUyariEsigi`, Ayarlar › Maliyet ve KDV; yoksa 10), proje ve ana kalemde ayrı. `devamEdenAsama`: durumu 'devam' olan takip başlıklarının sıraca ilki (+n).
- Hakediş önerisi `hakedisOnerileri`: imzalı sözleşmelerde ana kaleme düşen iş tutarı (metrajda miktarlı kalemler, aşamalıda
  aşama tutarları; kod kalem/hakediş satırından, yoksa `isButceKodu`) içinde onaylı hakedişlerin payı; ilave iş sayılmaz.
  Kullanıcı "Öneriyi kaydet" derse `kaynak: 'hakedis'` kaydı yazılır.
- Servis `servisler/ilerleme.ts`; ekran `arayuz/Ilerleme.tsx`: proje ekranında İlerleme kartı, `#/projeler/:id/ilerleme`
  (kalem başına yüzde girişi, öneri, geçmiş/iptal). Projeler listesi `projeIlerlemeOzetleri` ile (firmanın tablolarını birer
  kez okur; `projeleriListele` başka formlarda da kullanıldığı için genişletilmedi).

## Kâr / zarar raporu
- `hesap/karZarar.ts` (saf), servis `servisler/rapor.ts` `karZararGetir`, ekran `#/projeler/:id/rapor` (`arayuz/KarZarar.tsx`).
  Gelir KDV hariç (satış KDV'si devlete): imzalı + rezerve + ilave imalat alacakları + satılmamış tahmini (imzalı satışların
  brüt m² ortalaması; m² eksikse daire başı). Arsa sahibine tahsisli gelir doğurmaz. Maliyet firma KDV ayarıyla; tahmini maliyet
  = ana kalem başına max(bütçe, harcanan) + kalemsiz. Başa baş: tahmini maliyet − kesin gelir, satılmamış bölüm başına.
- Nakit: tahsil (satış alacaklarına eşleşen + ilave imalat) − ödenen (alış giderlerinin borcu − kalanı); aylık akış: giriş satış
  plan kalanları ve ilave imalat vadesine, çıkış açık gider borçları vadesine (vadesiz fatura tarihine); geçmiş vadeler ayrı satır.

- Firma geneli `firmaRaporu` (saf) / `firmaRaporuGetir` (kişinin projeleri), ekran `#/rapor` (Projeler listesinde bağlantı,
  yetki 'rapor'): projelerin toplamı + projesiz genel giderler (maliyete eklenir, borçları akışa); nakit akışı kasa ve
  bankadaki TL'den (kart borcu düşülmüş) başlar, eksiye düştüğü ay uyarılır.

## Gizlilik ve hesap silme
- `public/gizlilik.html` (bağımsız sayfa, service worker yakalamaz) = Play Store gizlilik adresi; Ayarlar › Gizlilik ve hesap
  (`arayuz/Gizlilik.tsx`). Hesap silme `?islem=hesap_sil` {sifre}: hesap ve oturumlar silinir; hesabın açtığı firma başka
  üyesi varsa ona devredilir, yoksa firma ve kayıtları silinir; cihaz bulut bağlantısını keser, cihazdaki kayıtlar kalır.
  Politikadaki bilgi değişirse (toplanan veri, sunucu, yapay zekâ) sayfa ve yürürlük tarihi güncellenir.

## Rol yetkileri
- Tanım `sunucu/api/_ic/yetkiler.json` (uygulama `hesap/yetki.ts` ile, sunucu `esitleme.php` ile okur): yetkiler (gider,
  odeme, kasa, cari, satis, sozlesme, ilerleme, proje, rapor, belge, ayar), muhasebe/şantiye varsayılanları, tablo başına
  yazma kuralı (yetkilerden biri; 'yonetici': firma, kullanıcı, üyelik; 'herkes': işlem geçmişi). Bağlı kayıtlar (peşin
  giderin ödemesi, hakedişin gideri, iptal yayılması) tabloların listesinde karşılanır.
- Yönetici her şeyi yapar; muhasebe/şantiye yetkilerini yönetici seçer (`firma.ayarlar.rolYetkileri`,
  `rolYetkileriniKaydet`, Ayarlar › Kullanıcılar › Rol yetkileri). `KayitServisi` her ekle/güncelle/iptal/onayda denetler
  (`YetkiHatasi`; firmada üyelik yoksa = ilk kurulum, serbest); `servis.yazabilir/yetkisiVar`. Ekranda `useYetki()`:
  menü, Kayıt seçenekleri, proje kartları gizlenir; `App.tsx` `ekranYetkisi` ekranı kapatır. Okuma kısıtı yalnız ekrandadır.
- İsteğe bağlı kısıtlar (varsayılan kapalı, yöneticiye uygulanmaz): kişi başı proje (`uyelik.projeIdleri`, null = hepsi;
  `projeleriDegistir`, Kullanıcılar › Düzenle; `KayitServisi` kaydın `projeId`sine — proje kaydında `id` — bakar, ekranda
  `useProjeErisimi` + `projeleriListele(…, erisim)`, `App.tsx` projeye girişi kapatır; sunucu her zaman denetler, red
  'proje'). Firma ayarı `kisitlar` (`ekKisitlariKaydet`, Kullanıcılar › Ek kısıtlar): `gorme` — sunucu `cek`te kişinin
  yazamadığı tabloları (herkese açık `OKUMA_SERBEST` hariç; işlem geçmişi kayıt türüne, belge bağlı tabloya göre) ve
  projesi dışındakileri göndermez, `gorunurluk` anahtarı değişince cihaz baştan çeker (önce inmiş kayıt silinmez);
  `sunucuKurallari` — `kuralIhlali`: olusturan/olusturmaZamani değişmez, yeni kayıtta olusturan ve değişen kayıtta
  guncelleyen yazan kişi, onay kaldırılamaz/değişmez, hakedişli gidere yalnız `sozlesme` yetkisi; red 'kural'.
- Hazır kayıtların kimliği sabittir (`bosSabitId`: usta tipleri, sistem kalemleri, vergi dairesi) ki iki cihazda ayrı
  oluşturulunca eşitlemede tek kayıt olsun.

## Bulut eşitleme (şema 18)
- Sunucu (`sunucu/api/_ic/esitleme.php`, tablolar `firmalar`, `firma_uyeleri`, `davetler`, `kayitlar`): kayıtlar cihazdaki
  tabloların aynısı (JSON). Yazmada yetki (rol eşitlenen `uyelik`ten, rol yetkileri `firma` kaydından; firmada henüz üyelik
  yoksa açan hesap yönetici) ve sürüm: cihaz kaydın üstüne yapıldığı sürümü (`tabanSurum`, yeni kayıtta 0) gönderir;
  saklanan sürüme eşit değilse 'eski' reddi (birebir aynısı tekrar gelirse kabul). Sürüm tabandan en çok 10.000 ileride
  olabilir; bozuk/bilinmeyen kayıt yalnız kendisi 'gecersiz' reddedilir. Davet, başka kullanıcıya bağlı hesapla kabul
  edilmez. Firma başına kilit; kabul edilen her kayda artan `sira`. Çekme `sira`dan sonrası, 500 kayıt / 4 MB sayfa.
  Sunucu tablo yetkisini ve proje kısıtını denetler; iş kuralları ve görme kısıtı isteğe bağlı (Rol yetkileri).
- Cihaz (`bulut/esitleme.ts`): `Depo.ekle/yaz` her kaydı `bekleyen` tablosuna işaretler (cihaza özel, yedeğe girmez; ilk
  değişiklikten önceki hâl `taban`). `esitle`: bekleyenleri ~2 MB paketlerle gönderir; 'eski' reddinde `birlestir`
  (üç yollu, `bulut/birlestir.ts`: bu cihazın değiştirdiği alanlar sunucudakinin üstüne, iç içe nesnelerde alt alan
  alan, diziler bütün; sürüm +1; eklenecek değişiklik kalmadıysa yalnız sunucudaki yazılır) ve yeniden gönderir; gönderim
  sürerken yeniden değişen kaydın tabanı kabul edilen hâl olur;
  yetki reddinde sunucudaki hâl yazılır. Sonra çeker (`disaridanYaz`: bekleyen kayıt üzerine yazılmaz). Belge dosyası
  base64 (`blobKodla`). Bağlantı meta `bulut` ({firmaId, kullaniciId, sonSira}; yedeğe girmez).
- `bulutaAc` (yönetici: firma sunucuda kurulur, `hepsiniBekleyenYap`; yeniden bağlanışta taban = kaydın kendisi, yani
  sunucudaki daha yeni hâl kazanır, yalnız sunucuda olmayanlar gider), `bulutFirmasinaKatil` (boş cihaz: davet kodu ya da
  hesabın firması; hepsi çekilir, cihaz kullanıcısı davetteki kişi), `kendiligindenEsitle` (açılış, internet gelince,
  sayfaya dönünce, yazınca 3 sn sonra, dakikada bir). Başka cihazdan kayıt gelince üstte "Yenile" (sayfa yeniden kurulur).
- Bağlıyken yedekten geri yükleme ve "bu cihazda bu kişi olarak devam et" kapalı. Ekranlar `arayuz/Bulut.tsx` (Ayarlar
  kartı, kurulumda katılma, Kullanıcılar'da davet kodu ve hesap bağı), üst çubukta ☁ durumu.
- Deneme: `sunucu/` PHP'si yerel MariaDB + `php -S` ile; uygulamada `esitleme.test.ts` sahte sunucuyla.

## Belge havuzu (şema 19)
- Tek kapı: Kayıt › Belge yükle (`#/havuz`, `arayuz/Havuz.tsx`): kamera, çoklu dosya (resim, PDF, e-Fatura XML), sürükle-bırak,
  telefonda "Paylaş" (Web Share Target: manifest `share_target` → `public/paylas-sw.js` 'paylasilan' önbelleği →
  `#/havuz/paylasim`). Yüklerken cihazda: GİB karekodu (`cihaz/karekod.ts`: BarcodeDetector ya da jsQR, PDF'te pdf.js ile
  ilk 2 sayfa) ve UBL XML okunur (`hesap/eFatura.ts`, saf: `karekodCoz`, `ublCoz`, `tutarliMi`); hiçbir şey dışarı gitmez.
- `belgeHavuzu` (servisler/havuz.ts): dosya bir `belge`dir (bagliTur 'belgeHavuzu'), SHA-256 `ozet` ile aynı dosya ikinci kez
  eklenmez. `havuzOnerisi`: VKN ile cari, aynı cari + fatura no (ya da faturasız gider, tutar ±1 TL, ±7 gün) ile girilmiş gider,
  başka VKN'ye kesilmiş fatura uyarısı. Onay = `havuzBagla` (belgenin bağı asıl kayda çevrilir, havuz 'baglandi'); gereksiz =
  iptal (belgesi de). Onaylamak için hedef kaydın yetkisi gerekir.
- Formlar `#/havuz/:id/gider|odeme|tahsilat` (`HavuzFormlari.tsx`): gider faturadan dolu açılır (taslak kullanılmaz, proje
  seçimi açık), VKN'si eşleşen cari ★ öneri (seçili gelmez), eşleşmeyen satıcı için "Kartı aç ve seç". Kaydedince belge bağlanır.
  Diğerleri "Bir kayda bağla": proje, cari, girilmiş gider, usta/kat karşılığı sözleşmesi, satış.
- Cihaz, kendi sürümünde olmayan tablodan gelen kaydı atlar (`disaridanYaz`), eşitleme durmaz.

## Aşama 3 adımları
1. ✅ Daire satışları: rezervasyon, bedel/takas, ödeme planı → alacak, tahsilat, teslim, ön satış protokolü
2. ✅ İlerleme takibi: ana kalem yüzdesi, hakediş önerisi, erken uyarı, projeler listesi
3. ✅ Proje kâr/zarar ve nakit akışı raporu
4. ✅ İlerleme uyarı eşiği ayarı, dövizli satış
5. ✅ Ayarlanabilir rol yetkileri ve bulut eşitleme (kendi sunucumuz)
6. ✅ İsteğe bağlı kısıtlar: kişi başı proje, görme kısıtı, sunucu iş kuralları
7. ✅ Firma geneli rapor; gizlilik politikası ve hesap silme (Play Store)

## Aşama 4 adımları (belge)
1. ✅ Belge havuzu: tek kapı, paylaş menüsü, karekod/XML okuma, eşleştirme, onay
2. Yapay zekâ ile fatura, fiş, dekont, çek tanıma (rıza ekranı, gizlilik güncellemesi)
3. Eski sözleşmelerin okunması (usta, kat karşılığı, satış)
4. Ruhsat, tapu ve fotoğrafların otomatik ayrılması
