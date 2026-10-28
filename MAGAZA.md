# Mağaza uygulaması (Android, sonra iOS)

Web uygulaması (muteahhit.surex.tr) aynen kalır. Mağaza sürümü aynı kodun Capacitor ile paketlenmiş hâlidir:
sayfalar telefondan açılır (internetsiz çalışır), API istekleri `https://muteahhit.surex.tr/api/`'ye gider
(`src/bulut/api.ts` › `telefonUygulamasi`). Oturum çerezi telefonun HTTP katmanında saklanır (`capacitor.config.ts` ›
`CapacitorHttp`, `CapacitorCookies`). Telefon uygulamasında service worker ve "Yeni sürüm" uyarısı yoktur; güncelleme
mağazadan gelir. Veriler telefonda IndexedDB'dedir; bulut eşitleme açıksa sunucuda da durur.

## Android (Windows bilgisayarda)

1. Android Studio'yu kurun (https://developer.android.com/studio). İlk açılışta SDK'yı indirir.
2. Depo klasöründe: `npm install`, sonra `npm run android` (derler ve `android/` klasörüne kopyalar),
   `npm run android:ac` (Android Studio'da açar).
3. Deneme: telefonda **Geliştirici seçenekleri › USB hata ayıklama** açık, kabloyla bağlayın; Android Studio'da ▶ Run.
4. Mağaza paketi: **Build › Generate Signed App Bundle / APK › Android App Bundle**. İlk seferde imza anahtarı
   (keystore) oluşturulur: dosyayı ve şifresini **kaybetmeyin**, yedekleyin (kaybolursa aynı uygulama güncellenemez;
   Play App Signing açıksa yükleme anahtarı sıfırlatılabilir).
5. Her yeni sürümde `android/app/build.gradle` › `versionCode` bir artırılır, `versionName` (örn. "1.1") yazılır.
6. Google Play Console (tek seferlik 25 $ geliştirici hesabı):
   - Uygulama oluştur → ad "Müteahhit Hesap Defteri", dil Türkçe.
   - Gizlilik politikası adresi gerekir (örn. surex.tr'de bir sayfa): toplanan veri giriş e-postası; bulut eşitleme
     açılırsa firmanın kayıtları muteahhit.surex.tr sunucusunda saklanır; yapay zekâ için yalnız usta tipi ve maskelenmiş
     özel şartlar Anthropic'e gönderilir.
   - Veri güvenliği formu: e-posta (hesap), uygulama içi kayıtlar (isteğe bağlı bulut), şifreli aktarım (https) evet.
   - Ekran görüntüleri (telefon), kısa/uzun açıklama, simge 512×512 (`assets/icon-only.png`'den).
   - Önce **Dahili test** kanalına yükleyin, kendi telefonunuzda deneyin, sonra üretime.

Simge ve açılış ekranı `assets/` klasöründen üretilir: `npx @capacitor/assets generate --android
--iconBackgroundColor '#1f3a5f' --splashBackgroundColor '#1f3a5f'`.

## iOS

Mac ve Xcode gerekir (Apple Developer hesabı yıllık 99 $). `npm install @capacitor/ios@<aynı sürüm>`,
`npx cap add ios`, `npm run build && npx cap sync ios`, `npx cap open ios`. Simgeler aynı komutla `--ios` ile.
