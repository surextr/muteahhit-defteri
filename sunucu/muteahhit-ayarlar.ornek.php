<?php
// Müteahhit Hesap Defteri — sunucu ayarları (ÖRNEK).
//
// Bu dosyanın bir kopyasını "muteahhit-ayarlar.php" adıyla sunucuda web klasörünün DIŞINA koyun
// (cPanel'de ana klasör, örn. /home/kullaniciadi/muteahhit-ayarlar.php). API dosyası bulunduğu klasörden
// yukarı doğru bu adı arar. Gerçek değerler depoya girmez; bu örnek dosyada gizli bilgi yazmayın.

return [
    // cPanel › MySQL Veritabanları'nda oluşturduğunuz veritabanı ve kullanıcı.
    'vt' => [
        'sunucu' => 'localhost',
        'ad' => 'kullaniciadi_muteahhit',
        'kullanici' => 'kullaniciadi_muteahhit',
        'sifre' => 'BURAYA-VERITABANI-SIFRESI',
    ],

    // Anthropic API anahtarı (console.anthropic.com). Yalnızca sunucuda durur, tarayıcıya gitmez.
    'anthropic_anahtari' => 'sk-ant-BURAYA',
    'model' => 'claude-opus-5-5',

    // Kullanıcı başına günlük yapay zekâ düzenleme sayısı.
    'gunluk_sinir' => 20,

    // Onay e-postasındaki bağlantı bu adrese döner (sonunda / olmadan).
    'site_adresi' => 'https://muteahhit.surex.tr',

    // Onay e-postasının gönderen adresi: cPanel › E-posta Hesapları'nda var olmalı.
    'eposta_gonderen' => 'noreply@surex.tr',
    'eposta_gonderen_ad' => 'Müteahhit Hesap Defteri',

    // Yalnızca bilgisayarda deneme için: true olursa çerez https şartı aranmaz ve e-postalar
    // gönderilmek yerine 'eposta_klasoru'ne dosya olarak yazılır. Sunucuda false kalmalı.
    'gelistirme' => false,
    'eposta_klasoru' => null,
];
