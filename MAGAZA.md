# Mağaza uygulamaları (Google Play ve App Store)

Web uygulaması (muteahhit.surex.tr) aynen kalır. Mağaza sürümü aynı kodun Capacitor ile paketlenmiş hâlidir:
sayfalar telefondan açılır (internetsiz çalışır), API istekleri `https://muteahhit.surex.tr/api/`'ye gider
(`src/cihaz/uygulama.ts` › `telefonUygulamasi`). Oturum çerezi telefonun HTTP katmanında saklanır (`capacitor.config.ts` ›
`CapacitorHttp`, `CapacitorCookies`). Telefon uygulamasında service worker, "Yeni sürüm" uyarısı ve anlık bildirim yoktur
(hatırlatma e-postayla); güncelleme mağazadan gelir. Veriler telefonda IndexedDB'dedir; bulut eşitleme açıksa sunucuda da durur.

Uygulamadaki farklar (`src/cihaz/yerel.ts` `YerelCihaz`): web görünümünde indirme ve dosyalı paylaşım çalışmadığı için
yedek, Excel, PDF dosyası uygulamanın geçici klasörüne yazılır ve telefonun paylaş menüsü açılır (`@capacitor/filesystem`,
`@capacitor/share`). "PDF / Yazdır" (`cihaz/paylas.ts` `yazdir`) uygulamada sayfayı PDF yapıp paylaşır. WhatsApp bağlantısı
sayfa içi geçişle açılır; uygulama dış adresi telefona (WhatsApp uygulamasına) devreder.

Paketler bilgisayarda değil, GitHub'ın makinelerinde derlenir (iOS için Mac gerekmez):

| İş akışı | Ne yapar |
|---|---|
| `.github/workflows/android.yml` "Android paketi" | imzalı `.aab` (Actions sayfasında indirilebilir), hizmet hesabı varsa Play › Dahili test'e taslak |
| `.github/workflows/ios.yml` "iOS paketi" | GitHub'ın Mac'inde derler, Apple bulut imzasıyla imzalar, TestFlight'a yükler |

İkisi de elle başlatılır: GitHub › Actions › iş akışı › **Run workflow** (`ozellik/magaza-*` dallarına gönderimde de
çalışır). Anahtarlar girilmemişse imzasız deneme derlemesi yapar. Derleme numarası çalıştırma numarasıdır (her pakette
artar); sürüm adı `package.json` › `version` (yeni mağaza sürümünde artırın: 1.0.0 → 1.1.0).

## Bir kez yapılacaklar

### Google Play

1. Play Console › **Uygulama oluştur**: ad "Müteahhit Hesap Defteri", dil Türkçe, uygulama, ücretsiz.
2. GitHub › Settings › Secrets and variables › Actions › **New repository secret** (değerler `ANDROID-ANAHTAR-BILGILERI.txt`'de):
   `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_SIFRESI`, `ANDROID_ANAHTAR_ADI`, `ANDROID_ANAHTAR_SIFRESI`.
   Yükleme anahtarı (`muteahhit-yukleme.jks`) depoda yoktur; dosyayı ve bilgi dosyasını güvenli yerde saklayın.
3. Actions › "Android paketi" › Run workflow → bitince sayfanın altındaki `.aab`'ı indirin.
4. Play Console › Test › **Dahili test** › Yeni sürüm → `.aab`'ı yükleyin (ilk paket elle yüklenir; Play App Signing
   kabul edilir). Test kullanıcısı olarak kendi Gmail'inizi ekleyin, bağlantıdan telefona kurun.
5. Mağaza bilgileri:
   - Gizlilik politikası: `https://muteahhit.surex.tr/gizlilik.html`.
   - Hesap silme: uygulamada Ayarlar › Gizlilik ve hesap › Giriş hesabımı sil; web adresi olarak gizlilik sayfasının
     6. maddesi.
   - Veri güvenliği: e-posta (hesap), uygulama içi kayıtlar (isteğe bağlı bulut), fotoğraflar (belge), aktarımda şifreleme
     evet, silme isteği evet. Konum toplanmaz (şantiye konumu yalnız cihazda/kayıtta, fotoğrafın konumu saklanmaz).
   - Simge 512×512 (`assets/icon-only.png`), öne çıkan görsel 1024×500, en az 2 telefon ekran görüntüsü.
6. (İsteğe bağlı, sonraki sürümler otomatik yüklensin) Google Cloud'da hizmet hesabı + JSON anahtar, Play Console ›
   Kullanıcılar ve izinler'de bu hesaba sürüm yetkisi; JSON'u `PLAY_HIZMET_HESABI` gizli değişkeni yapın.

### App Store

1. developer.apple.com › Account › Membership: **Team ID**'yi not edin.
2. Certificates, Identifiers & Profiles › Identifiers › **+** › App IDs › App: açıklama "Muteahhit Hesap Defteri",
   Bundle ID (Explicit) `tr.surex.muteahhit`. Ek yetenek gerekmez.
3. App Store Connect › Apps › **+ New App**: iOS, ad "Müteahhit Hesap Defteri", dil Türkçe, Bundle ID
   `tr.surex.muteahhit`, SKU `muteahhit-defteri`.
4. App Store Connect › Users and Access › Integrations › **App Store Connect API** › Team Keys › **+**: ad "GitHub",
   erişim **Admin** (bulut imza sertifikası oluşturabilmek için). **Issuer ID** ve **Key ID**'yi not edin, `.p8`
   dosyasını indirin (bir kez indirilebilir).
5. GitHub gizli değişkenleri: `APPLE_TAKIM_KIMLIGI` (Team ID), `ASC_YAYINCI_KIMLIGI` (Issuer ID), `ASC_ANAHTAR_KIMLIGI`
   (Key ID), `ASC_ANAHTAR_P8` (`.p8` dosyasını Not Defteri ile açıp içeriğin tamamı).
6. Actions › "iOS paketi" › Run workflow. ~15 dk sonra App Store Connect › TestFlight'ta derleme görünür (Apple'ın
   işlemesi 10–30 dk daha). Internal Testing grubuna kendinizi ekleyin; iPhone'a **TestFlight** uygulamasıyla kurun.
7. İnceleme için: gizlilik adresi, App Privacy formu (Play'dekiyle aynı), ekran görüntüleri (6,9" iPhone), inceleme
   notunda deneme hesabı (bulut girişi için e-posta + şifre) ve "veriler cihazda tutulur, giriş yalnız bulut ve yapay zekâ
   için" açıklaması. Hesap silme uygulamada var (Apple şartı).

## Yerelde (isteğe bağlı)

Android Studio ile: `npm run android` (derler ve `android/`'a kopyalar), `npm run android:ac`, telefon USB hata
ayıklamada ▶ Run. iOS yerelde yalnız Mac'te: `npm run ios`, `npx cap open ios`.

Simge ve açılış ekranı `assets/`'tan üretilir (çıktılar depoda): `npx @capacitor/assets generate --android --ios
--iconBackgroundColor '#1f3a5f' --splashBackgroundColor '#1f3a5f' --iconBackgroundColorDark '#1f3a5f'
--splashBackgroundColorDark '#1f3a5f'`.

İzin metinleri: iOS `ios/App/App/Info.plist` (kamera, galeri, konum — "Şantiyedeyim"), Android
`android/app/src/main/AndroidManifest.xml` (konum). Yeni bir cihaz özelliği eklenirse ikisine de yazılır.
