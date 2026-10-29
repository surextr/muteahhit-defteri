<?php
// Bulut eşitleme: firma, üyelik, davet, kayıt gönderme ve çekme.
//
// Sunucu kayıtları yorumlamaz; cihazlardaki tabloların aynısını JSON olarak saklar. İki kural uygular:
//  1. Yetki: kaydı yazan kişinin rolü (eşitlenen `uyelik` kaydından) ve firmanın rol yetkileri (eşitlenen `firma`
//     kaydından), ortak tanım yetkiler.json. Yetkisiz yazma reddedilir; cihaz sunucudaki hâli geri alır.
//  2. Sürüm: her değişiklikte `surum` bir artar; cihaz değişikliğin üstüne yapıldığı sürümü (`tabanSurum`) de gönderir.
//     Taban sunucudaki sürüme eşitse yazılır; değilse (başka cihaz aynı kaydı önce değiştirmiş) reddedilir, sunucudaki hâl döner ve cihaz kendi değiştirdiği alanları onun üstüne koyup
//     yeniden gönderir (bulut/birlestir.ts). Yalnızca eklenen tablolar (işlem geçmişi, belge dosyası) bir kez yazılır.
declare(strict_types=1);

const DAVET_GUN = 7;
const DAVET_HARFLERI = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CEKME_SINIRI = 500;
const CEKME_BAYT = 4_000_000;
const KAYIT_BAYT = 24_000_000;
/** Bir gönderimde kaydın sürümü, üstüne yapıldığı sürümden en çok bu kadar ileride olabilir (internetsiz düzeltmeler). */
const EN_COK_SURUM_ARTISI = 10_000;
/** Sürümsüz, yalnızca eklenen tablolar. */
const EKLEMELI_TABLOLAR = ['islemGecmisi', 'belgeDosyasi'];
/** firmaId alanı taşımayan tablolar. */
const FIRMASIZ_TABLOLAR = ['firma', 'kullanici'];

function yetkiTanimi(): array
{
    static $t = null;
    if ($t === null) {
        $t = json_decode((string) file_get_contents(__DIR__ . '/yetkiler.json'), true, 512, JSON_THROW_ON_ERROR);
    }
    return $t;
}

function girisGerekli(): array
{
    $k = oturumKullanicisi();
    if (!$k) throw new ApiHatasi(401, "Bulut için önce Ayarlar'dan giriş yapın.");
    return $k;
}

function firmaIdAl(array $g, string $ad = 'firmaId'): string
{
    $id = metinAl($g, $ad);
    if (!preg_match('/^[0-9a-zA-Z-]{8,64}$/', $id)) throw new ApiHatasi(400, 'Firma kimliği geçersiz.');
    return $id;
}

function kimlikAl(array $g, string $ad): string
{
    $id = metinAl($g, $ad);
    if (!preg_match('/^[0-9a-zA-Z_-]{1,64}$/', $id)) throw new ApiHatasi(400, 'Kimlik geçersiz.');
    return $id;
}

/** Firmanın eşitlenmiş tek bir kaydı (çözülmüş JSON) ya da null. */
function sunucuKaydi(string $firmaId, string $tablo, string $id): ?array
{
    $s = vt()->prepare('SELECT veri FROM kayitlar WHERE firma_id = ? AND tablo = ? AND id = ?');
    $s->execute([$firmaId, $tablo, $id]);
    $v = $s->fetchColumn();
    return $v === false ? null : json_decode((string) $v, true);
}

/**
 * Hesabın bu firmadaki durumu: ['kullaniciId', 'rol', 'ayarlar'].
 * Rol eşitlenen `uyelik` kaydındandır; firmada henüz hiç üyelik kaydı yoksa (ilk yükleme) firmayı açan yöneticidir.
 */
function uyeDurumu(string $firmaId, int $hesapId): array
{
    $s = vt()->prepare('SELECT u.kullanici_id, f.olusturan FROM firma_uyeleri u JOIN firmalar f ON f.id = u.firma_id
                        WHERE u.firma_id = ? AND u.hesap_id = ?');
    $s->execute([$firmaId, $hesapId]);
    $u = $s->fetch();
    if (!$u) throw new ApiHatasi(403, 'Bu firmaya bağlı değilsiniz.');
    $kullaniciId = (string) $u['kullanici_id'];

    $s = vt()->prepare("SELECT veri FROM kayitlar WHERE firma_id = ? AND tablo = 'uyelik'");
    $s->execute([$firmaId]);
    $uyelikVar = false;
    $rol = null;
    $projeIdleri = null;
    foreach ($s->fetchAll(PDO::FETCH_COLUMN) as $v) {
        $uy = json_decode((string) $v, true);
        if (!is_array($uy) || ($uy['iptal'] ?? null) !== null) continue;
        $uyelikVar = true;
        if (($uy['kullaniciId'] ?? null) === $kullaniciId) {
            $rol = (string) $uy['rol'];
            $projeIdleri = is_array($uy['projeIdleri'] ?? null) ? array_values(array_filter($uy['projeIdleri'], 'is_string')) : null;
        }
    }
    if (!$uyelikVar && (int) $u['olusturan'] === $hesapId) $rol = 'yonetici';
    if ($rol === null) throw new ApiHatasi(403, 'Firmadaki üyeliğiniz kaldırılmış.');

    $firma = sunucuKaydi($firmaId, 'firma', $firmaId);
    $ayarlar = is_array($firma['ayarlar'] ?? null) ? $firma['ayarlar'] : [];
    return [
        'kullaniciId' => $kullaniciId,
        'rol' => $rol,
        'ayarlar' => $ayarlar,
        // Kısıtlar yöneticiye uygulanmaz.
        'projeIdleri' => $rol === 'yonetici' ? null : $projeIdleri,
        'gorme' => $rol !== 'yonetici' && !empty($ayarlar['kisitlar']['gorme']),
        'kurallar' => $rol !== 'yonetici' && !empty($ayarlar['kisitlar']['sunucuKurallari']),
    ];
}

/** Kaydın projesi kişinin projeleri içinde mi (projesiz kayıt ve kısıtsız kişi her zaman). */
function projeyeErisir(array $durum, string $tablo, array $veri): bool
{
    if ($durum['projeIdleri'] === null) return true;
    $projeId = $tablo === 'proje' ? ($veri['id'] ?? null) : ($veri['projeId'] ?? null);
    return !is_string($projeId) || in_array($projeId, $durum['projeIdleri'], true);
}

/** Herkesin cihazına inen tablolar (adlar ve proje yapısı; ekranlar bunlarsız açılmaz). */
const OKUMA_SERBEST = ['firma', 'kullanici', 'uyelik', 'proje', 'blok', 'kat', 'bagimsizBolum', 'ortakAlan', 'takipBasligi', 'kalem',
    'kalemIlerlemesi', 'ustaTipi', 'hesap', 'cari', 'ayarDegeri'];

/** Görme kısıtı açıkken kişinin cihazına inecek mi: yazabildiği ya da herkese açık tablolar, kendi projeleri. */
function okuyabilir(array $durum, string $tablo, array $veri, string $firmaId): bool
{
    if (!$durum['gorme']) return true;
    if (!projeyeErisir($durum, $tablo, $veri)) return false;
    $tabloOkunur = fn (string $t) => in_array($t, OKUMA_SERBEST, true) || (isset(yetkiTanimi()['tablolar'][$t]) && tabloyaYazabilir($durum, $t));
    if ($tablo === 'islemGecmisi') return $tabloOkunur((string) ($veri['kayitTur'] ?? ''));
    if ($tablo === 'belge') {
        $bag = (string) ($veri['bagliTur'] ?? '');
        return !isset(yetkiTanimi()['tablolar'][$bag]) || $tabloOkunur($bag);
    }
    if ($tablo === 'belgeDosyasi') {
        $belge = is_string($veri['belgeId'] ?? null) ? sunucuKaydi($firmaId, 'belge', $veri['belgeId']) : null;
        return $belge !== null && okuyabilir($durum, 'belge', $belge, $firmaId);
    }
    return $tabloOkunur($tablo);
}

/** Görme kısıtı değişince (açılış, yetki, proje) cihaz baştan çeker. */
function gorunurlukAnahtari(array $durum): string
{
    if (!$durum['gorme']) return 'acik';
    $y = rolYetkileri($durum['ayarlar'], $durum['rol']);
    sort($y);
    $p = $durum['projeIdleri'];
    if ($p !== null) sort($p);
    return md5(json_encode([$durum['rol'], $y, $p]));
}

/**
 * Sunucu iş kuralları (yönetici açarsa, yönetici dışındakilere): kaydı oluşturan ve zamanı değiştirilemez, kayıt yazanın
 * adıyla yazılır, onay kaldırılamaz/değiştirilemez, hakedişten oluşan gider yalnız sözleşme yetkisiyle yazılır.
 * Dönüş: ihlal varsa açıklama.
 */
function kuralIhlali(array $durum, string $tablo, array $veri, ?array $eski): ?string
{
    if (!$durum['kurallar']) return null;
    if ($eski) {
        foreach (['olusturan', 'olusturmaZamani'] as $alan) {
            if (array_key_exists($alan, $eski) && ($veri[$alan] ?? null) !== $eski[$alan]) return 'olusturan';
        }
        if (($eski['onay'] ?? null) !== null && json_encode($veri['onay'] ?? null) !== json_encode($eski['onay'])) return 'onay';
    } elseif (array_key_exists('olusturan', $veri) && $veri['olusturan'] !== $durum['kullaniciId']) {
        return 'olusturan';
    }
    if (array_key_exists('guncelleyen', $veri) && $veri['guncelleyen'] !== $durum['kullaniciId'] && (!$eski || $veri['guncelleyen'] !== ($eski['guncelleyen'] ?? null))) {
        return 'guncelleyen';
    }
    if ($tablo === 'gider' && (($veri['hakedisId'] ?? null) !== null || ($eski['hakedisId'] ?? null) !== null)
        && !in_array('sozlesme', rolYetkileri($durum['ayarlar'], $durum['rol']), true)) {
        return 'hakedis';
    }
    return null;
}

function rolYetkileri(array $ayarlar, string $rol): array
{
    $t = yetkiTanimi();
    if ($rol === 'yonetici') return array_column($t['yetkiler'], 'kod');
    $secili = $ayarlar['rolYetkileri'][$rol] ?? null;
    return is_array($secili) ? $secili : ($t['varsayilan'][$rol] ?? []);
}

function tabloyaYazabilir(array $durum, string $tablo): bool
{
    if ($durum['rol'] === 'yonetici') return true;
    $gerek = yetkiTanimi()['tablolar'][$tablo] ?? 'yonetici';
    if ($gerek === 'herkes') return true;
    if ($gerek === 'yonetici') return false;
    return count(array_intersect($gerek, rolYetkileri($durum['ayarlar'], $durum['rol']))) > 0;
}

// ─── Firma ve üyelik ──────────────────────────────────────────────────

/** Hesabın bağlı olduğu firmalar. */
function firmalarim(): never
{
    $k = girisGerekli();
    $s = vt()->prepare('SELECT f.id, f.ad, u.kullanici_id FROM firma_uyeleri u JOIN firmalar f ON f.id = u.firma_id
                        WHERE u.hesap_id = ? ORDER BY f.ad');
    $s->execute([$k['id']]);
    $firmalar = array_map(fn ($r) => ['id' => $r['id'], 'ad' => $r['ad'], 'kullaniciId' => $r['kullanici_id']], $s->fetchAll());
    yanit(200, ['firmalar' => $firmalar]);
}

/** Cihazdaki firmayı buluta açar; açan kişi yöneticidir. Ardından cihaz bütün kayıtlarını gönderir. */
function firmaOlustur(array $g): never
{
    $k = girisGerekli();
    $firmaId = firmaIdAl($g);
    $kullaniciId = kimlikAl($g, 'kullaniciId');
    $ad = mb_substr(metinAl($g, 'ad'), 0, 200) ?: 'Firma';

    $s = vt()->prepare('SELECT olusturan FROM firmalar WHERE id = ?');
    $s->execute([$firmaId]);
    $var = $s->fetchColumn();
    if ($var !== false) {
        // Aynı kişi yeniden bağlanıyorsa sorun yok; başka hesabın firmasıysa reddet.
        $u = vt()->prepare('SELECT 1 FROM firma_uyeleri WHERE firma_id = ? AND hesap_id = ?');
        $u->execute([$firmaId, $k['id']]);
        if (!$u->fetchColumn()) throw new ApiHatasi(409, 'Bu firma bulutta başka bir hesapla açılmış.');
        yanit(200, ['firmaId' => $firmaId, 'yeni' => false]);
    }
    $p = vt();
    $p->beginTransaction();
    $p->prepare('INSERT INTO firmalar (id, ad, son_sira, olusturan, olusturma) VALUES (?, ?, 0, ?, ?)')->execute([$firmaId, $ad, $k['id'], simdi()]);
    $p->prepare('INSERT INTO firma_uyeleri (firma_id, hesap_id, kullanici_id, baglanma) VALUES (?, ?, ?, ?)')->execute([$firmaId, $k['id'], $kullaniciId, simdi()]);
    $p->commit();
    yanit(200, ['firmaId' => $firmaId, 'yeni' => true]);
}

/** Yönetici, firmadaki bir kullanıcı için davet kodu üretir (eskisi geçersiz olur). */
function davetOlustur(array $g): never
{
    $k = girisGerekli();
    $firmaId = firmaIdAl($g);
    $kullaniciId = kimlikAl($g, 'kullaniciId');
    $d = uyeDurumu($firmaId, $k['id']);
    if ($d['rol'] !== 'yonetici') throw new ApiHatasi(403, 'Davet kodunu yalnız yönetici üretir.');

    // Kullanıcının etkin üyeliği buluta gönderilmiş olmalı.
    $s = vt()->prepare("SELECT veri FROM kayitlar WHERE firma_id = ? AND tablo = 'uyelik'");
    $s->execute([$firmaId]);
    $uye = false;
    foreach ($s->fetchAll(PDO::FETCH_COLUMN) as $v) {
        $uy = json_decode((string) $v, true);
        if (is_array($uy) && ($uy['kullaniciId'] ?? null) === $kullaniciId && ($uy['iptal'] ?? null) === null) $uye = true;
    }
    if (!$uye) throw new ApiHatasi(400, 'Kullanıcı henüz buluta gönderilmedi; eşitleme bitince yeniden deneyin.');

    $kod = '';
    for ($i = 0; $i < 8; $i++) $kod .= DAVET_HARFLERI[random_int(0, strlen(DAVET_HARFLERI) - 1)];
    vt()->prepare('DELETE FROM davetler WHERE firma_id = ? AND kullanici_id = ?')->execute([$firmaId, $kullaniciId]);
    vt()->prepare('INSERT INTO davetler (kod_ozet, firma_id, kullanici_id, son, olusturan) VALUES (?, ?, ?, ?, ?)')
        ->execute([hash('sha256', $kod), $firmaId, $kullaniciId, simdi(DAVET_GUN * 86400), $k['id']]);
    yanit(200, ['kod' => substr($kod, 0, 4) . '-' . substr($kod, 4), 'gun' => DAVET_GUN]);
}

/** Davet kodunu giren hesap, koddaki kullanıcı olarak firmaya bağlanır (o kullanıcıya önceden bağlı hesap düşer). */
function davetKabul(array $g): never
{
    $k = girisGerekli();
    $cok = 'Çok sık deneme yapıldı; biraz bekleyip yeniden deneyin.';
    denemeSiniri('davet-ip:' . istemciIp(), 10, 900, $cok);
    denemeSiniri('davet-hesap:' . $k['id'], 10, 900, $cok);

    $kod = strtoupper(preg_replace('/[^0-9A-Za-z]/', '', metinAl($g, 'kod')) ?? '');
    $s = vt()->prepare('SELECT d.firma_id, d.kullanici_id, f.ad FROM davetler d JOIN firmalar f ON f.id = d.firma_id
                        WHERE d.kod_ozet = ? AND d.son > ?');
    $s->execute([hash('sha256', $kod), simdi()]);
    $d = $s->fetch();
    if (!$d) throw new ApiHatasi(404, 'Davet kodu geçersiz ya da süresi dolmuş.');

    // Bu hesap firmaya başka bir kullanıcı olarak bağlıysa (örn. yönetici kendi hesabıyla şantiye kodunu denedi) reddet:
    // yoksa firma yöneticisiz kalabilir.
    $s = vt()->prepare('SELECT kullanici_id FROM firma_uyeleri WHERE firma_id = ? AND hesap_id = ?');
    $s->execute([$d['firma_id'], $k['id']]);
    $mevcut = $s->fetchColumn();
    if ($mevcut !== false && $mevcut !== $d['kullanici_id']) {
        throw new ApiHatasi(409, 'Bu giriş hesabı firmada başka bir kullanıcıya bağlı. Davet kodunu, kodun verildiği kişi kendi hesabıyla girmeli.');
    }

    $p = vt();
    $p->beginTransaction();
    $p->prepare('DELETE FROM firma_uyeleri WHERE firma_id = ? AND (kullanici_id = ? OR hesap_id = ?)')->execute([$d['firma_id'], $d['kullanici_id'], $k['id']]);
    $p->prepare('INSERT INTO firma_uyeleri (firma_id, hesap_id, kullanici_id, baglanma) VALUES (?, ?, ?, ?)')
        ->execute([$d['firma_id'], $k['id'], $d['kullanici_id'], simdi()]);
    $p->prepare('DELETE FROM davetler WHERE kod_ozet = ?')->execute([hash('sha256', $kod)]);
    // Üyeliği iptal edilmiş kullanıcıya bağlanılamaz.
    try {
        uyeDurumu($d['firma_id'], $k['id']);
    } catch (ApiHatasi $e) {
        $p->rollBack();
        throw $e;
    }
    $p->commit();
    yanit(200, ['firmaId' => $d['firma_id'], 'kullaniciId' => $d['kullanici_id'], 'ad' => $d['ad']]);
}

/** Firmadaki kullanıcıların bağlı giriş hesapları (yalnız yönetici görür). */
function uyeler(): never
{
    $k = girisGerekli();
    $firmaId = firmaIdAl($_GET, 'firma');
    $d = uyeDurumu($firmaId, $k['id']);
    if ($d['rol'] !== 'yonetici') throw new ApiHatasi(403, 'Yalnız yönetici görür.');
    $s = vt()->prepare('SELECT u.kullanici_id, h.eposta FROM firma_uyeleri u JOIN kullanicilar h ON h.id = u.hesap_id WHERE u.firma_id = ?');
    $s->execute([$firmaId]);
    $uyeler = array_map(fn ($r) => ['kullaniciId' => $r['kullanici_id'], 'eposta' => $r['eposta']], $s->fetchAll());
    yanit(200, ['uyeler' => $uyeler]);
}

/** Yönetici bir kullanıcının hesap bağını kaldırır (o hesap artık eşitleyemez). */
function baglantiKaldir(array $g): never
{
    $k = girisGerekli();
    $firmaId = firmaIdAl($g);
    $kullaniciId = kimlikAl($g, 'kullaniciId');
    $d = uyeDurumu($firmaId, $k['id']);
    if ($d['rol'] !== 'yonetici') throw new ApiHatasi(403, 'Yalnız yönetici kaldırabilir.');
    if ($kullaniciId === $d['kullaniciId']) throw new ApiHatasi(400, 'Kendi bağınızı buradan kaldıramazsınız.');
    vt()->prepare('DELETE FROM firma_uyeleri WHERE firma_id = ? AND kullanici_id = ?')->execute([$firmaId, $kullaniciId]);
    vt()->prepare('DELETE FROM davetler WHERE firma_id = ? AND kullanici_id = ?')->execute([$firmaId, $kullaniciId]);
    yanit(200, ['tamam' => true]);
}

// ─── Kayıt gönderme ve çekme ──────────────────────────────────────────

/**
 * Cihazdaki değişiklikler: { firmaId, kayitlar: [{ tablo, veri }] } → { kabul: [{tablo,id}], red: [{tablo,id,sebep,sunucu}], sonSira }.
 * Firma kilitlenir; sıra numaraları kabul sırasıyla verilir (çeken cihaz hiçbir değişikliği atlamaz).
 */
function gonder(array $g): never
{
    $k = girisGerekli();
    $firmaId = firmaIdAl($g);
    $kayitlar = $g['kayitlar'] ?? null;
    if (!is_array($kayitlar) || count($kayitlar) > 2000) throw new ApiHatasi(400, 'Kayıt listesi geçersiz.');
    $tablolar = yetkiTanimi()['tablolar'];

    $p = vt();
    $p->beginTransaction();
    try {
        $s = $p->prepare('SELECT son_sira FROM firmalar WHERE id = ? FOR UPDATE');
        $s->execute([$firmaId]);
        $sira = $s->fetchColumn();
        if ($sira === false) throw new ApiHatasi(404, 'Firma bulutta yok.');
        $sira = (int) $sira;
        $durum = uyeDurumu($firmaId, $k['id']);

        $oku = $p->prepare('SELECT veri, surum, zaman FROM kayitlar WHERE firma_id = ? AND tablo = ? AND id = ?');
        $yaz = $p->prepare('INSERT INTO kayitlar (firma_id, tablo, id, veri, surum, zaman, sira, yazan) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                            ON DUPLICATE KEY UPDATE veri = VALUES(veri), surum = VALUES(surum), zaman = VALUES(zaman), sira = VALUES(sira), yazan = VALUES(yazan)');
        $kabul = [];
        $red = [];
        $firmaAdi = null;
        foreach ($kayitlar as $x) {
            $tablo = is_array($x) && is_string($x['tablo'] ?? null) ? $x['tablo'] : '';
            $veri = is_array($x) ? ($x['veri'] ?? null) : null;
            $id = is_array($veri) && is_string($veri['id'] ?? null) ? $veri['id'] : '';
            // Bozuk ya da bu sürümün bilmediği kayıt yalnız kendisi reddedilir; gönderimin geri kalanı işlenir.
            if (!isset($tablolar[$tablo]) || !preg_match('/^[0-9a-zA-Z_-]{1,64}$/', $id)) {
                $red[] = ['tablo' => $tablo, 'id' => $id, 'sebep' => 'gecersiz', 'sunucu' => null];
                continue;
            }

            $oku->execute([$firmaId, $tablo, $id]);
            $eski = $oku->fetch();
            $reddet = function (string $sebep) use (&$red, $tablo, $id, $eski) {
                $red[] = ['tablo' => $tablo, 'id' => $id, 'sebep' => $sebep, 'sunucu' => $eski ? json_decode((string) $eski['veri'], true) : null];
            };

            // Kayıt bu firmanın olmalı.
            $baskaFirma = in_array($tablo, FIRMASIZ_TABLOLAR, true)
                ? ($tablo === 'firma' && $id !== $firmaId)
                : (($veri['firmaId'] ?? null) !== $firmaId);
            if ($baskaFirma) { $reddet('firma'); continue; }
            if (!tabloyaYazabilir($durum, $tablo)) { $reddet('yetki'); continue; }
            $eskiVeri = $eski ? json_decode((string) $eski['veri'], true) : null;
            // Proje kısıtı: kişi yalnız kendi projelerinin kayıtlarını yazar (eski kayıt da onun projesinde olmalı).
            if (!projeyeErisir($durum, $tablo, $veri) || ($eskiVeri && !projeyeErisir($durum, $tablo, $eskiVeri))) { $reddet('proje'); continue; }
            if (kuralIhlali($durum, $tablo, $veri, $eskiVeri) !== null) { $reddet('kural'); continue; }
            // İşlem geçmişi yazanın adıyla eklenir (yönetici ilk yüklemede cihazdaki başka kişilerin geçmişini de gönderir).
            if ($tablo === 'islemGecmisi' && $durum['rol'] !== 'yonetici' && ($veri['kullaniciId'] ?? null) !== $durum['kullaniciId']) { $reddet('yetki'); continue; }

            $json = json_encode($veri, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            if ($json === false || strlen($json) > KAYIT_BAYT) { $reddet('boyut'); continue; }
            $surum = $veri['surum'] ?? 0;
            $taban = $x['tabanSurum'] ?? 0;
            // Sürüm makul bir tam sayı olmalı: bir cihaz çok büyük sürüm gönderip eşitlemeyi kilitleyemez.
            if (!is_int($surum) || !is_int($taban) || $surum < 0 || $taban < 0 || $surum > $taban + EN_COK_SURUM_ARTISI || $surum > 2_000_000_000) {
                $reddet('gecersiz');
                continue;
            }
            $zaman = (string) ($veri['guncellemeZamani'] ?? ($veri['zaman'] ?? ''));

            if ($eski) {
                if (in_array($tablo, EKLEMELI_TABLOLAR, true)) { $kabul[] = ['tablo' => $tablo, 'id' => $id]; continue; }
                // Aynısı yeniden geldiyse (cevabı kaybolan gönderim, yeniden bağlanma) değişiklik yok.
                if ($json === (string) $eski['veri']) { $kabul[] = ['tablo' => $tablo, 'id' => $id]; continue; }
                // Değişiklik sunucudaki sürümün üstüne yapılmamış (başka cihaz önce değiştirmiş): cihaz sunucudakiyle alan
                // alan birleştirip yeniden gönderir.
                if ($taban !== (int) $eski['surum'] || $surum <= (int) $eski['surum']) { $reddet('eski'); continue; }
            }
            $sira++;
            $yaz->execute([$firmaId, $tablo, $id, $json, $surum, $zaman, $sira, $k['id']]);
            $kabul[] = ['tablo' => $tablo, 'id' => $id];
            if ($tablo === 'firma' && is_string($veri['ad'] ?? null)) $firmaAdi = mb_substr($veri['ad'], 0, 200);
        }
        $p->prepare('UPDATE firmalar SET son_sira = ? WHERE id = ?')->execute([$sira, $firmaId]);
        // Firma adı listede güncel görünsün (yalnız kabul edilen firma kaydından).
        if ($firmaAdi !== null) $p->prepare('UPDATE firmalar SET ad = ? WHERE id = ?')->execute([$firmaAdi, $firmaId]);
        $p->commit();
    } catch (Throwable $e) {
        $p->rollBack();
        throw $e;
    }
    yanit(200, ['kabul' => $kabul, 'red' => $red, 'sonSira' => $sira]);
}

/** ?islem=cek&firma=…&sonra=N → { kayitlar: [{tablo, veri, sira}], sonSira, devam, gorunurluk } */
function cek(): never
{
    $k = girisGerekli();
    $firmaId = firmaIdAl($_GET, 'firma');
    $sonra = max(0, (int) ($_GET['sonra'] ?? 0));
    $durum = uyeDurumu($firmaId, $k['id']);

    $s = vt()->prepare('SELECT tablo, veri, sira FROM kayitlar WHERE firma_id = ? AND sira > ? ORDER BY sira LIMIT ' . CEKME_SINIRI);
    $s->execute([$firmaId, $sonra]);
    $kayitlar = [];
    $bayt = 0;
    $sonSira = $sonra;
    $devam = false;
    $satirlar = $s->fetchAll();
    foreach ($satirlar as $r) {
        $bayt += strlen((string) $r['veri']);
        if ($bayt > CEKME_BAYT && count($kayitlar) > 0) { $devam = true; break; }
        $sonSira = (int) $r['sira'];
        $veri = json_decode((string) $r['veri'], true);
        // Görme kısıtında kişinin göremeyeceği kayıt atlanır (sıra yine ilerler).
        if (!is_array($veri) || !okuyabilir($durum, (string) $r['tablo'], $veri, $firmaId)) continue;
        $kayitlar[] = ['tablo' => $r['tablo'], 'veri' => $veri, 'sira' => (int) $r['sira']];
    }
    if (count($satirlar) === CEKME_SINIRI) $devam = true;
    yanit(200, ['kayitlar' => $kayitlar, 'sonSira' => $sonSira, 'devam' => $devam, 'gorunurluk' => gorunurlukAnahtari($durum)]);
}
