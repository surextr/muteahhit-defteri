<?php
// Vade hatırlatmaları: her sabah e-posta özeti ve telefona anlık bildirim.
//
// Vadeleri cihaz hesaplar (kalan borç, iade, tevkifat… kuralları uygulamada) ve kişinin görebildiği açık kalemleri
// buraya yükler; sunucu yalnız tarihine bakıp gönderir. Liste firma başına, giriş hesabı başına tutulur.
//
//   GET  ?islem=hatirlatma_ayar                      → { eposta, bildirim, gunOnce, vapid, abonelik }
//   POST ?islem=hatirlatma_ayar   { eposta, bildirim, gunOnce }      → aynı
//   POST ?islem=hatirlatma_liste  { firmaId, firmaAdi, kalemler }    → { tamam, sayi }
//   POST ?islem=push_abone        { endpoint, keys: { p256dh, auth } } → { tamam }
//   POST ?islem=push_birak        { endpoint }                       → { tamam }
//   POST ?islem=hatirlatma_dene                                      → { eposta, bildirim }  (hemen gönderir)
//   Günlük görev: php _ic/gorev.php hatirlatma   ya da   GET ?islem=gorev&anahtar=… (ayarlardaki 'gorev_anahtari')
declare(strict_types=1);

const EN_COK_HATIRLATMA = 500;

function hatirlatmaTablolari(): void
{
    static $tamam = false;
    if ($tamam) return;
    $vt = vt();
    $vt->exec('CREATE TABLE IF NOT EXISTS hatirlatma_ayar (
        hesap_id INT UNSIGNED NOT NULL, eposta TINYINT(1) NOT NULL DEFAULT 0, bildirim TINYINT(1) NOT NULL DEFAULT 0,
        gun_once TINYINT UNSIGNED NOT NULL DEFAULT 3, son_gonderim DATE NULL, PRIMARY KEY (hesap_id),
        CONSTRAINT hatirlatma_ayar_hesap FOREIGN KEY (hesap_id) REFERENCES kullanicilar (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
    $vt->exec('CREATE TABLE IF NOT EXISTS hatirlatma_listesi (
        hesap_id INT UNSIGNED NOT NULL, firma_id VARCHAR(64) NOT NULL, firma_adi VARCHAR(200) NOT NULL,
        kalemler MEDIUMTEXT NOT NULL, guncelleme DATETIME NOT NULL, PRIMARY KEY (hesap_id, firma_id),
        CONSTRAINT hatirlatma_liste_hesap FOREIGN KEY (hesap_id) REFERENCES kullanicilar (id) ON DELETE CASCADE,
        CONSTRAINT hatirlatma_liste_firma FOREIGN KEY (firma_id) REFERENCES firmalar (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
    $vt->exec('CREATE TABLE IF NOT EXISTS push_abonelik (
        ozet CHAR(64) NOT NULL, hesap_id INT UNSIGNED NOT NULL, uc_nokta VARCHAR(1000) NOT NULL,
        p256dh VARCHAR(200) NOT NULL, auth VARCHAR(64) NOT NULL, olusturma DATETIME NOT NULL,
        PRIMARY KEY (ozet), KEY hesap (hesap_id),
        CONSTRAINT push_hesap FOREIGN KEY (hesap_id) REFERENCES kullanicilar (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
    $tamam = true;
}

function hatirlatmaAyariOku(int $hesapId): array
{
    hatirlatmaTablolari();
    $s = vt()->prepare('SELECT eposta, bildirim, gun_once FROM hatirlatma_ayar WHERE hesap_id = ?');
    $s->execute([$hesapId]);
    $a = $s->fetch() ?: ['eposta' => 0, 'bildirim' => 0, 'gun_once' => 3];
    $s = vt()->prepare('SELECT COUNT(*) FROM push_abonelik WHERE hesap_id = ?');
    $s->execute([$hesapId]);
    return [
        'eposta' => (int) $a['eposta'] === 1,
        'bildirim' => (int) $a['bildirim'] === 1,
        'gunOnce' => (int) $a['gun_once'],
        'abonelik' => (int) $s->fetchColumn(),
        'vapid' => vapidAnahtarlari()['acik'],
    ];
}

function hatirlatmaAyar(?array $g): never
{
    $k = girisGerekli();
    if ($g !== null) {
        $gun = (int) ($g['gunOnce'] ?? 3);
        if (!in_array($gun, [0, 1, 3, 7], true)) $gun = 3;
        hatirlatmaTablolari();
        vt()->prepare('INSERT INTO hatirlatma_ayar (hesap_id, eposta, bildirim, gun_once) VALUES (?, ?, ?, ?)
                       ON DUPLICATE KEY UPDATE eposta = VALUES(eposta), bildirim = VALUES(bildirim), gun_once = VALUES(gun_once)')
            ->execute([$k['id'], !empty($g['eposta']) ? 1 : 0, !empty($g['bildirim']) ? 1 : 0, $gun]);
    }
    yanit(200, hatirlatmaAyariOku($k['id']));
}

/** Cihazdan gelen kalemleri denetler; bozuk olanı atar. */
function hatirlatmaKalemleri(mixed $liste): array
{
    if (!is_array($liste)) throw new ApiHatasi(400, 'Hatırlatma listesi okunamadı.');
    $temiz = [];
    foreach (array_slice($liste, 0, EN_COK_HATIRLATMA) as $x) {
        if (!is_array($x)) continue;
        $vade = is_string($x['vade'] ?? null) ? $x['vade'] : '';
        $tutar = $x['tutar'] ?? null;
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $vade) || !is_int($tutar)) continue;
        $tur = in_array($x['tur'] ?? '', ['odenecek_fatura', 'tahsil_alacak', 'alinan_cek', 'verilen_cek'], true) ? $x['tur'] : 'odenecek_fatura';
        $temiz[] = [
            'tur' => $tur,
            'vade' => $vade,
            'tutar' => $tutar,
            'baslik' => mb_substr(is_string($x['baslik'] ?? null) ? $x['baslik'] : '', 0, 120),
            'ayrinti' => mb_substr(is_string($x['ayrinti'] ?? null) ? $x['ayrinti'] : '', 0, 160),
            'yol' => is_string($x['yol'] ?? null) && preg_match('#^[a-z]+/[0-9a-zA-Z-]+$#', $x['yol']) ? $x['yol'] : '',
        ];
    }
    return $temiz;
}

function hatirlatmaListesi(array $g): never
{
    $k = girisGerekli();
    $firmaId = firmaIdAl($g);
    uyeDurumu($firmaId, $k['id']); // firmaya bağlı ve üyeliği süren hesap
    $kalemler = hatirlatmaKalemleri($g['kalemler'] ?? null);
    $firmaAdi = mb_substr(metinAl($g, 'firmaAdi'), 0, 200);
    hatirlatmaTablolari();
    vt()->prepare('INSERT INTO hatirlatma_listesi (hesap_id, firma_id, firma_adi, kalemler, guncelleme) VALUES (?, ?, ?, ?, ?)
                   ON DUPLICATE KEY UPDATE firma_adi = VALUES(firma_adi), kalemler = VALUES(kalemler), guncelleme = VALUES(guncelleme)')
        ->execute([$k['id'], $firmaId, $firmaAdi, json_encode($kalemler, JSON_UNESCAPED_UNICODE), simdi()]);
    yanit(200, ['tamam' => true, 'sayi' => count($kalemler)]);
}

function pushAbone(array $g): never
{
    $k = girisGerekli();
    $uc = metinAl($g, 'endpoint');
    $anahtarlar = is_array($g['keys'] ?? null) ? $g['keys'] : [];
    $p256dh = is_string($anahtarlar['p256dh'] ?? null) ? $anahtarlar['p256dh'] : '';
    $auth = is_string($anahtarlar['auth'] ?? null) ? $anahtarlar['auth'] : '';
    if (!preg_match('#^https://[^\s]{10,990}$#', $uc) || !preg_match('/^[A-Za-z0-9_-]{80,100}$/', $p256dh) || !preg_match('/^[A-Za-z0-9_-]{16,32}$/', $auth)) {
        throw new ApiHatasi(400, 'Bildirim aboneliği geçersiz.');
    }
    hatirlatmaTablolari();
    vt()->prepare('INSERT INTO push_abonelik (ozet, hesap_id, uc_nokta, p256dh, auth, olusturma) VALUES (?, ?, ?, ?, ?, ?)
                   ON DUPLICATE KEY UPDATE hesap_id = VALUES(hesap_id), p256dh = VALUES(p256dh), auth = VALUES(auth)')
        ->execute([hash('sha256', $uc), $k['id'], $uc, $p256dh, $auth, simdi()]);
    yanit(200, ['tamam' => true]);
}

function pushBirak(array $g): never
{
    $k = girisGerekli();
    hatirlatmaTablolari();
    vt()->prepare('DELETE FROM push_abonelik WHERE ozet = ? AND hesap_id = ?')->execute([hash('sha256', metinAl($g, 'endpoint')), $k['id']]);
    yanit(200, ['tamam' => true]);
}

// --- Gönderim -------------------------------------------------------------

function gunEkle(string $gun, int $n): string
{
    return (new DateTimeImmutable($gun))->modify(sprintf("%+d day", $n))->format("Y-m-d");
}

function tlMetni(int $kurus): string
{
    return '₺' . number_format($kurus / 100, 2, ',', '.');
}

function tarihMetni(string $gun): string
{
    return substr($gun, 8, 2) . '.' . substr($gun, 5, 2) . '.' . substr($gun, 0, 4);
}

const HATIRLATMA_TURU = [
    'odenecek_fatura' => 'Ödenecek',
    'tahsil_alacak' => 'Tahsil edilecek',
    'alinan_cek' => 'Alınan çek',
    'verilen_cek' => 'Verilen çek',
];

/**
 * Hesabın bugün bildirilecek kalemleri: vadesi geçmiş, bugün, ve `gunOnce` gün içinde dolacaklar. Firma başına.
 * Dönen: [['firma' => ad, 'guncelleme' => …, 'gecmis' => [], 'bugun' => [], 'yakin' => []], …]
 */
function bildirilecekler(int $hesapId, int $gunOnce, string $bugun): array
{
    hatirlatmaTablolari();
    $s = vt()->prepare('SELECT l.firma_adi, l.kalemler, l.guncelleme FROM hatirlatma_listesi l
                        JOIN firma_uyeleri u ON u.firma_id = l.firma_id AND u.hesap_id = l.hesap_id WHERE l.hesap_id = ?');
    $s->execute([$hesapId]);
    $son = gunEkle($bugun, $gunOnce);
    $sonuc = [];
    foreach ($s->fetchAll() as $l) {
        $grup = ['firma' => $l['firma_adi'], 'guncelleme' => $l['guncelleme'], 'gecmis' => [], 'bugun' => [], 'yakin' => []];
        foreach (json_decode((string) $l['kalemler'], true) ?: [] as $x) {
            if ($x['vade'] < $bugun) $grup['gecmis'][] = $x;
            elseif ($x['vade'] === $bugun) $grup['bugun'][] = $x;
            elseif ($x['vade'] <= $son) $grup['yakin'][] = $x;
        }
        foreach (['gecmis', 'bugun', 'yakin'] as $a) usort($grup[$a], fn($p, $q) => strcmp($p['vade'], $q['vade']) ?: $q['tutar'] <=> $p['tutar']);
        if ($grup['gecmis'] || $grup['bugun'] || $grup['yakin']) $sonuc[] = $grup;
    }
    return $sonuc;
}

function hatirlatmaEpostasi(array $gruplar, int $gunOnce, string $bugun): array
{
    $site = rtrim((string) (ayarlar()['site_adresi'] ?? ''), '/');
    $toplamSayi = 0;
    $satirlar = [];
    foreach ($gruplar as $g) {
        if (count($gruplar) > 1) $satirlar[] = "■ {$g['firma']}";
        foreach (['gecmis' => 'Vadesi geçmiş', 'bugun' => 'Bugün', 'yakin' => "$gunOnce gün içinde"] as $a => $baslik) {
            if (!$g[$a]) continue;
            $satirlar[] = '';
            $satirlar[] = "$baslik:";
            foreach ($g[$a] as $x) {
                $toplamSayi++;
                $satirlar[] = '  • ' . tarihMetni($x['vade']) . ' · ' . HATIRLATMA_TURU[$x['tur']] . ' · ' . tlMetni($x['tutar']) . ' · ' . $x['baslik']
                    . ($x['ayrinti'] !== '' ? " ({$x['ayrinti']})" : '');
            }
        }
        $guncel = substr((string) $g['guncelleme'], 0, 10);
        if ($guncel < gunEkle($bugun, -3)) {
            $satirlar[] = '';
            $satirlar[] = 'Not: bu liste en son ' . tarihMetni($guncel) . " tarihinde güncellendi; programı açınca tazelenir.";
        }
        $satirlar[] = '';
    }
    $konu = "Vade hatırlatması: $toplamSayi kalem (" . tarihMetni($bugun) . ')';
    $govde = "Günaydın,\r\n\r\nMüteahhit Hesap Defteri'nde vadesi gelen ödeme ve tahsilatlar:\r\n\r\n"
        . implode("\r\n", $satirlar)
        . "\r\nAyrıntı ve ödeme için: $site/#/bugun\r\n\r\n"
        . "Bu e-postayı programda Ayarlar › Vade hatırlatmaları bölümünden kapatabilirsiniz.\r\n";
    return [$konu, $govde, $toplamSayi];
}

function hatirlatmaBildirimi(array $gruplar): array
{
    $gecmis = $bugunSayi = $yakin = 0;
    $tutar = 0;
    foreach ($gruplar as $g) {
        $gecmis += count($g['gecmis']);
        $bugunSayi += count($g['bugun']);
        $yakin += count($g['yakin']);
        foreach (['gecmis', 'bugun'] as $a) foreach ($g[$a] as $x) $tutar += $x['tutar'];
    }
    $parcalar = array_filter([
        $bugunSayi ? "$bugunSayi bugün" : '',
        $gecmis ? "$gecmis vadesi geçmiş" : '',
        $yakin ? "$yakin yaklaşan" : '',
    ]);
    $ilk = $gruplar[0]['bugun'][0] ?? $gruplar[0]['gecmis'][0] ?? $gruplar[0]['yakin'][0] ?? null;
    return [
        'baslik' => 'Vade hatırlatması: ' . implode(', ', $parcalar),
        'govde' => ($tutar > 0 ? 'Bugün ve geçmiş toplam ' . tlMetni($tutar) . '. ' : '') . ($ilk ? HATIRLATMA_TURU[$ilk['tur']] . ': ' . $ilk['baslik'] . ' ' . tlMetni($ilk['tutar']) : ''),
        'yol' => 'bugun',
        'etiket' => 'vade-hatirlatma',
    ];
}

/** Bir hesaba gönderir. Dönen: ['eposta' => bool|null, 'bildirim' => başarılı sayı|null]. */
function hesabaHatirlat(array $hesap, string $bugun, bool $deneme = false): array
{
    $gunOnce = (int) $hesap['gun_once'];
    $gruplar = bildirilecekler((int) $hesap['id'], $gunOnce, $bugun);
    $sonuc = ['eposta' => null, 'bildirim' => null, 'kalem' => 0];
    if (!$gruplar && !$deneme) return $sonuc;
    if ((int) $hesap['eposta'] === 1) {
        [$konu, $govde, $sayi] = $gruplar ? hatirlatmaEpostasi($gruplar, $gunOnce, $bugun) : ['Vade hatırlatması (deneme)', "Bu bir deneme e-postasıdır. Şu an vadesi gelen ödeme ya da tahsilat yok.\r\n", 0];
        $sonuc['kalem'] = $sayi;
        try {
            epostaGonder((string) $hesap['eposta_adresi'], $konu, $govde);
            $sonuc['eposta'] = true;
        } catch (Throwable $e) {
            error_log('Hatırlatma e-postası gönderilemedi: ' . $e->getMessage());
            $sonuc['eposta'] = false;
        }
    }
    if ((int) $hesap['bildirim'] === 1) {
        $veri = $gruplar ? hatirlatmaBildirimi($gruplar) : ['baslik' => 'Vade hatırlatması (deneme)', 'govde' => 'Bildirimler açık. Şu an vadesi gelen bir şey yok.', 'yol' => 'bugun', 'etiket' => 'vade-hatirlatma'];
        $s = vt()->prepare('SELECT ozet, uc_nokta, p256dh, auth FROM push_abonelik WHERE hesap_id = ?');
        $s->execute([$hesap['id']]);
        $basarili = 0;
        foreach ($s->fetchAll() as $a) {
            try {
                $durum = pushGonder($a['uc_nokta'], $a['p256dh'], $a['auth'], $veri);
                if ($durum >= 200 && $durum < 300) $basarili++;
                elseif ($durum === 404 || $durum === 410) vt()->prepare('DELETE FROM push_abonelik WHERE ozet = ?')->execute([$a['ozet']]);
                else error_log("Bildirim gönderilemedi: HTTP $durum");
            } catch (Throwable $e) {
                error_log('Bildirim gönderilemedi: ' . $e->getMessage());
            }
        }
        $sonuc['bildirim'] = $basarili;
    }
    return $sonuc;
}

function hatirlatmaHesaplari(?int $hesapId = null): array
{
    hatirlatmaTablolari();
    $s = vt()->prepare('SELECT k.id, k.eposta AS eposta_adresi, a.eposta, a.bildirim, a.gun_once, a.son_gonderim
                        FROM hatirlatma_ayar a JOIN kullanicilar k ON k.id = a.hesap_id
                        WHERE (a.eposta = 1 OR a.bildirim = 1)' . ($hesapId ? ' AND a.hesap_id = ?' : ''));
    $s->execute($hesapId ? [$hesapId] : []);
    return $s->fetchAll();
}

/** Günlük görev: her hesaba günde bir kez. Dönen: gönderilen hesap sayısı. */
function hatirlatmalariGonder(): int
{
    $bugun = turkiyeGunu();
    $n = 0;
    foreach (hatirlatmaHesaplari() as $h) {
        if ($h['son_gonderim'] === $bugun) continue;
        // Önce işaretle: görev iki kez çalışırsa aynı gün iki e-posta gitmesin.
        $s = vt()->prepare('UPDATE hatirlatma_ayar SET son_gonderim = ? WHERE hesap_id = ? AND (son_gonderim IS NULL OR son_gonderim <> ?)');
        $s->execute([$bugun, $h['id'], $bugun]);
        if ($s->rowCount() !== 1) continue;
        $r = hesabaHatirlat($h, $bugun);
        if ($r['eposta'] || $r['bildirim']) $n++;
    }
    return $n;
}

function hatirlatmaDene(): never
{
    $k = girisGerekli();
    denemeSiniri('hatirlatma-dene:' . $k['id'], 5, 3600, 'Çok sık deneme yapıldı; biraz sonra yeniden deneyin.');
    $h = hatirlatmaHesaplari($k['id'])[0] ?? null;
    if (!$h) throw new ApiHatasi(400, 'Önce e-posta ya da bildirim hatırlatmasını açın.');
    $r = hesabaHatirlat($h, turkiyeGunu(), true);
    yanit(200, $r);
}

/** HTTP ile tetiklenen günlük görev (cPanel cron'da curl/wget). */
function gorevCalistir(): never
{
    $beklenen = (string) (ayarlar()['gorev_anahtari'] ?? '');
    $gelen = is_string($_GET['anahtar'] ?? null) ? $_GET['anahtar'] : '';
    if (strlen($beklenen) < 16 || !hash_equals($beklenen, $gelen)) throw new ApiHatasi(403, 'Geçersiz istek.');
    yanit(200, ['gonderilen' => hatirlatmalariGonder()]);
}
