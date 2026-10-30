<?php
// Daire alıcısına bağlantı: cihaz satışın özetini (ödeme planı, tahsilat, son fotoğraflar) yükler, sunucu tahmin
// edilemez bir anahtar verir; alıcı /alici.html?t=… sayfasından girişsiz görür. Aynı satış için aynı anahtar kullanılır.
//
//   POST ?islem=alici_yayinla { satisId, veri, firmaId? } → { token }
//   POST ?islem=alici_kaldir  { satisId, firmaId? }       → { tamam }
//   GET  ?islem=alici_durum&satis=…[&firma=…]            → { token|null, guncelleme }
//   GET  ?islem=alici&t=…                                 → { veri, guncelleme }   (girişsiz)
declare(strict_types=1);

const ALICI_EN_BUYUK_BAYT = 2_500_000;

function aliciTablolari(): void
{
    static $tamam = false;
    if ($tamam) return;
    vt()->exec('CREATE TABLE IF NOT EXISTS alici_baglantilari (
        token CHAR(32) NOT NULL, hesap_id INT UNSIGNED NOT NULL, firma_id VARCHAR(64) NULL, satis_id VARCHAR(64) NOT NULL,
        veri MEDIUMTEXT NOT NULL, olusturma DATETIME NOT NULL, guncelleme DATETIME NOT NULL,
        PRIMARY KEY (token), KEY hesap_satis (hesap_id, satis_id), KEY firma_satis (firma_id, satis_id),
        CONSTRAINT alici_hesap FOREIGN KEY (hesap_id) REFERENCES kullanicilar (id) ON DELETE CASCADE,
        CONSTRAINT alici_firma FOREIGN KEY (firma_id) REFERENCES firmalar (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
    $tamam = true;
}

/**
 * Bağlantının sahibi: buluta bağlı firmada firma (üyelik ve satış yazma yetkisi denetlenir; bütün yetkili üyeler aynı
 * bağlantıyı görür), değilse giriş yapan hesap.
 */
function aliciSahibi(?string $firmaId): array
{
    $k = girisGerekli();
    if ($firmaId !== null && $firmaId !== '') {
        if (!preg_match('/^[0-9a-zA-Z-]{8,64}$/', $firmaId)) throw new ApiHatasi(400, 'Firma kimliği geçersiz.');
        $durum = uyeDurumu($firmaId, (int) $k['id']);
        if (!tabloyaYazabilir($durum, 'satis')) throw new ApiHatasi(403, 'Satış yetkiniz yok.');
        return ['hesap' => (int) $k['id'], 'firma' => $firmaId];
    }
    return ['hesap' => (int) $k['id'], 'firma' => null];
}

function aliciKaydi(array $sahip, string $satisId): ?array
{
    aliciTablolari();
    if ($sahip['firma'] !== null) {
        $s = vt()->prepare('SELECT token, guncelleme FROM alici_baglantilari WHERE firma_id = ? AND satis_id = ?');
        $s->execute([$sahip['firma'], $satisId]);
    } else {
        $s = vt()->prepare('SELECT token, guncelleme FROM alici_baglantilari WHERE hesap_id = ? AND firma_id IS NULL AND satis_id = ?');
        $s->execute([$sahip['hesap'], $satisId]);
    }
    $r = $s->fetch();
    return $r ?: null;
}

function aliciYayinla(array $g): never
{
    $satisId = kimlikAl($g, 'satisId');
    $sahip = aliciSahibi(metinAl($g, 'firmaId') ?: null);
    $veri = $g['veri'] ?? null;
    if (!is_array($veri)) throw new ApiHatasi(400, 'Bağlantı bilgisi okunamadı.');
    $json = json_encode($veri, JSON_UNESCAPED_UNICODE);
    if ($json === false || strlen($json) > ALICI_EN_BUYUK_BAYT) throw new ApiHatasi(413, 'Bağlantı bilgisi çok büyük (fotoğrafları azaltın).');
    denemeSiniri('alici:' . $sahip['hesap'], 300, 3600, 'Çok fazla güncelleme; biraz sonra deneyin.');
    $var = aliciKaydi($sahip, $satisId);
    if ($var) {
        $s = vt()->prepare('UPDATE alici_baglantilari SET veri = ?, guncelleme = ? WHERE token = ?');
        $s->execute([$json, simdi(), $var['token']]);
        yanit(200, ['token' => $var['token']]);
    }
    $token = bin2hex(random_bytes(16));
    $s = vt()->prepare('INSERT INTO alici_baglantilari (token, hesap_id, firma_id, satis_id, veri, olusturma, guncelleme) VALUES (?, ?, ?, ?, ?, ?, ?)');
    $s->execute([$token, $sahip['hesap'], $sahip['firma'], $satisId, $json, simdi(), simdi()]);
    yanit(200, ['token' => $token]);
}

function aliciKaldir(array $g): never
{
    $satisId = kimlikAl($g, 'satisId');
    $sahip = aliciSahibi(metinAl($g, 'firmaId') ?: null);
    $var = aliciKaydi($sahip, $satisId);
    if ($var) vt()->prepare('DELETE FROM alici_baglantilari WHERE token = ?')->execute([$var['token']]);
    yanit(200, ['tamam' => true]);
}

function aliciDurum(): never
{
    $satisId = is_string($_GET['satis'] ?? null) ? $_GET['satis'] : '';
    if (!preg_match('/^[0-9a-zA-Z_-]{1,64}$/', $satisId)) throw new ApiHatasi(400, 'Kimlik geçersiz.');
    $firma = is_string($_GET['firma'] ?? null) ? $_GET['firma'] : null;
    $var = aliciKaydi(aliciSahibi($firma), $satisId);
    yanit(200, ['token' => $var['token'] ?? null, 'guncelleme' => $var['guncelleme'] ?? null]);
}

/** Girişsiz: anahtarı bilen görür. Anahtar 128 bit rastgeledir; deneme sınırı tahmin denemelerini keser. */
function aliciGoster(): never
{
    $t = is_string($_GET['t'] ?? null) ? $_GET['t'] : '';
    denemeSiniri('alici_bak:' . istemciIp(), 120, 600, 'Çok fazla istek; biraz sonra deneyin.');
    if (!preg_match('/^[0-9a-f]{32}$/', $t)) throw new ApiHatasi(404, 'Bağlantı bulunamadı.');
    aliciTablolari();
    $s = vt()->prepare('SELECT veri, guncelleme FROM alici_baglantilari WHERE token = ?');
    $s->execute([$t]);
    $r = $s->fetch();
    if (!$r) throw new ApiHatasi(404, 'Bağlantı bulunamadı ya da kaldırılmış.');
    header('X-Robots-Tag: noindex');
    yanit(200, ['veri' => json_decode((string) $r['veri'], true), 'guncelleme' => $r['guncelleme']]);
}
