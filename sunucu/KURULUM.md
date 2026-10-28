# muteahhit.surex.tr kurulumu (cPanel)

Uygulama ve yapay zekâ API'si aynı adreste çalışır: `https://muteahhit.surex.tr` (uygulama) ve
`https://muteahhit.surex.tr/api/` (PHP, `sunucu/api`). Supabase kullanılmaz. Bulut eşitleme açılmadıkça uygulamanın kayıtları cihazda
durur; sunucuda yalnızca giriş bilgisi ve günlük yapay zekâ kullanım sayısı tutulur.

Gerekenler: PHP 8.1+ (cURL, PDO MySQL), MySQL/MariaDB. cPanel › **MultiPHP Manager**'da alt alan adının PHP
sürümünü 8.1 ya da üstü seçin.

## 1. Alt alan adı ve SSL

1. cPanel › **Domains** (ya da **Subdomains**) › **Create A New Domain**: `muteahhit.surex.tr`.
   Belge kökü (Document Root) önerilen hâliyle kalsın (örn. `/home/KULLANICI/muteahhit.surex.tr`). Bu klasörü not edin.
2. cPanel › **SSL/TLS Status** › `muteahhit.surex.tr` için **Run AutoSSL**. https açılmadan giriş çalışmaz
   (oturum çerezi yalnızca https'te gönderilir).

## 2. Veritabanı

1. cPanel › **MySQL Databases** (MySQL Veritabanları):
   - Yeni veritabanı: `muteahhit` (cPanel başına `KULLANICI_` ekler → örn. `KULLANICI_muteahhit`).
   - Yeni kullanıcı: aynı ad, güçlü bir şifre (şifreyi not edin).
   - **Add User To Database** → **ALL PRIVILEGES**.
2. cPanel › **phpMyAdmin** › soldan veritabanını seçin › **İçe Aktar (Import)** › `sunucu/kurulum.sql` › **Git**.
   Tablolar oluşur: `kullanicilar`, `oturumlar`, `yz_kullanim`, `denemeler` ve bulut eşitleme için `firmalar`,
   `firma_uyeleri`, `davetler`, `kayitlar`. Dosyayı yeniden içe aktarmak zararsızdır (var olan tabloya dokunmaz);
   yeni sürümde tablo eklendiğinde aynı adımı tekrarlayın.

## 3. Onay e-postasının gönderen adresi

cPanel › **Email Accounts** › `noreply@surex.tr` hesabını oluşturun (yoksa); şifresini not edin. Onay e-postaları
bu hesapla SMTP üzerinden gider (ayar dosyasındaki `smtp` bölümü). `smtp` yoksa PHP `mail()` denenir; birçok
sunucuda kapalıdır.
Gereksiz klasörüne düşmemesi için cPanel › **Email Deliverability**'de surex.tr için SPF ve DKIM'in "Valid"
olduğunu kontrol edin; değilse **Repair** deyin.

## 4. Sunucu ayar dosyası (gizli bilgiler burada)

1. `sunucu/muteahhit-ayarlar.ornek.php` dosyasının içeriğini kopyalayın.
2. cPanel › **File Manager** › ana klasörünüz (`/home/KULLANICI/`, yani `public_html`'in **yanı**, içi değil) ›
   **+ File** › ad: `muteahhit-ayarlar.php` › içeriği yapıştırın.
3. Doldurun: veritabanı adı/kullanıcı/şifre, `anthropic_anahtari` (Anthropic API anahtarınız),
   `site_adresi` = `https://muteahhit.surex.tr`, `eposta_gonderen` = `noreply@surex.tr`, `smtp` › `sifre` =
   noreply hesabının şifresi. `gelistirme` **false** kalsın. Değerler tek tırnak içinde; şifrelerde `'` ve `\`
   kullanmayın (dosya bozulur, `api/error_log`'a "syntax error" yazılır).
4. Dosyanın izinlerini **600** yapın (sağ tık › Change Permissions).

API, bulunduğu klasörden yukarı doğru bu dosyayı arar; web klasörünün dışında olduğu için tarayıcıdan açılamaz ve
FTP yayını ona dokunmaz.

## 5. FTP hesabı ve otomatik yayın

1. cPanel › **FTP Accounts** › yeni hesap, örn. `yayin@muteahhit.surex.tr`, **Directory**: 1. adımdaki belge kökü
   (örn. `muteahhit.surex.tr`). Şifreyi not edin.
2. GitHub › depo › **Settings** › **Secrets and variables** › **Actions** › **New repository secret** (üç tane):
   - `FTP_SUNUCU`: `ftp.surex.tr` (cPanel › FTP Accounts › **Configure FTP Client**'ta yazan sunucu)
   - `FTP_KULLANICI`: `yayin@muteahhit.surex.tr`
   - `FTP_SIFRE`: hesabın şifresi
3. GitHub › **Settings** › **Pages** › yayını kapatın (**Unpublish site**); artık kullanılmıyor.
4. `master`'a her gönderimde **Actions** › **Yayın**: testler, derleme, `sunucu/api` → `api/`, FTP ile yükleme.
   İlk yayını elle başlatmak için: **Actions** › **Yayın** › **Run workflow**.

FTPS bağlantı hatası verirse `.github/workflows/yayin.yml`'de `protocol: ftps` satırını `protocol: ftp` yapın.

## 6. Deneme

1. `https://muteahhit.surex.tr/api/?islem=oturum` → `{"eposta":null}` görünmeli.
   "ayar dosyası bulunamadı" görünürse 4. adımdaki dosyanın yeri yanlıştır.
2. Uygulama → **Ayarlar** → **Yapay zekâ ile sözleşme düzenleme** → **Kayıt ol** → e-postadaki onay bağlantısı
   (uygulama Ayarlar'da "onaylandı" ile açılır) → **Giriş yap** → **Dene**.
3. Sorunlarda: alt alan adı klasöründeki `api/error_log` dosyası. "E-posta gönderilemedi: SMTP …" satırı e-posta
   sorununu gösterir (şifre ve ileti kayda yazılmaz). E-posta gönderilemezse kayıt geri alınır, hemen yeniden denenebilir.

## 7. Bulut eşitleme

1. Bu sürümle gelen tablolar için 2. adımdaki **İçe Aktar**'ı `sunucu/kurulum.sql` ile bir kez daha yapın.
2. Belge ve fotoğraflar da eşitlenir (en büyük belge 15 MB, gönderimde ~20 MB). cPanel › **MultiPHP INI Editor**'da
   alt alan adı için `post_max_size` ve `upload_max_filesize` en az **32M**, `memory_limit` en az **256M** olsun.
   MySQL'in `max_allowed_packet` değeri 32 MB'tan küçükse büyük PDF'ler eşitlenmez (`api/error_log`'a yazılır).
3. Uygulama → **Ayarlar** → **Bulut eşitleme**: yönetici kendi hesabıyla girer → **Firmayı buluta aç** (bütün kayıtlar
   gönderilir). **Ayarlar › Kullanıcılar**'da her kişiye **Davet kodu oluştur**; kişi kendi telefonunda uygulamayı açar,
   **Buluttaki firmaya katıl** → kendi e-postasıyla kayıt/giriş → kodu yazar.
4. Sunucu her yazmayı rolün yetkisiyle (`sunucu/api/_ic/yetkiler.json`, Ayarlar › Kullanıcılar › Rol yetkileri) denetler.

## Sınırlar (ayar dosyasından ve kodda)

- Kullanıcı başına günlük düzenleme: `gunluk_sinir` (varsayılan 20); gün Türkiye saatine göre.
- Kayıt: IP başına saatte 5, adres başına saatte 3. Giriş: IP başına 15 dakikada 20, adres başına 10.
- Onay bağlantısı 24 saat geçerli; süresi dolan onaysız kayıt aynı adresle yeniden yapılabilir.
- Oturum 30 gün (HttpOnly, SameSite=Strict çerez).
- Davet kodu 7 gün geçerli, bir kez kullanılır; IP ve hesap başına 15 dakikada 10 deneme.

## Bilgisayarda deneme

`npm run dev` ile açılan uygulamada `/api/` istekleri canlı sunucuya (`muteahhit.surex.tr`) yönlendirilir
(`vite.config.ts` › `proxy`); yerel PHP sunucusu için `API_HEDEF=http://127.0.0.1:8090 npm run dev`. API'yi bilgisayarda çalıştırmak için: yerel MySQL'e `kurulum.sql`, ayar dosyasında
`gelistirme => true` ve `eposta_klasoru` (e-postalar gönderilmez, o klasöre bağlantı olarak yazılır), sonra
`npm run build`, `dist/` ile `sunucu/api`'yi aynı klasöre koyup orada
`MUTEAHHIT_AYARLAR=/yol/muteahhit-ayarlar.php php -S localhost:8080`.
