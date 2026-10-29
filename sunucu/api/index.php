<?php
// Müteahhit Hesap Defteri — yapay zekâ ile sözleşme düzenleme API'si (Supabase'in yerine, kendi sunucumuzda).
//
//   GET  ?islem=oturum          → { eposta: string|null }
//   POST ?islem=kayit           { eposta, sifre } → { durum: 'onay_bekliyor' }
//   GET  ?islem=onay&kod=…      → e-postadaki bağlantı; uygulamaya yönlendirir (#yz-onay=onaylandi|hata)
//   POST ?islem=giris           { eposta, sifre } → { eposta }
//   POST ?islem=cikis           → { tamam: true }
//   POST ?islem=hesap_sil       { sifre } → { tamam: true }  (hesap ve oturumları; tek üyesi olduğu buluttaki firma da)
//   POST ?islem=duzenle         { ustaTipi, metin } → { duzenlenmis, sorular, kalanHak, model }
//
// Bulut eşitleme (_ic/esitleme.php):
//   GET  ?islem=firmalarim                        → { firmalar: [{ id, ad, kullaniciId }] }
//   POST ?islem=firma_olustur   { firmaId, ad, kullaniciId } → { firmaId, yeni }
//   POST ?islem=davet_olustur   { firmaId, kullaniciId }     → { kod, gun }
//   POST ?islem=davet_kabul     { kod }                      → { firmaId, kullaniciId, ad }
//   GET  ?islem=uyeler&firma=…                    → { uyeler: [{ kullaniciId, eposta }] }
//   POST ?islem=baglanti_kaldir { firmaId, kullaniciId }     → { tamam }
//   POST ?islem=gonder          { firmaId, kayitlar }        → { kabul, red, sonSira }
//   GET  ?islem=cek&firma=…&sonra=N               → { kayitlar, sonSira, devam }
//
// Hatalar: { hata: 'Türkçe mesaj' } ve uygun HTTP durumu. POST isteklerinde "X-Istek: 1" başlığı zorunlu
// (oturum çerezi SameSite=Strict; başlık ayrıca başka sitelerden gelen form isteklerini keser).
declare(strict_types=1);

require __DIR__ . '/_ic/cekirdek.php';
require __DIR__ . '/_ic/eposta.php';
require __DIR__ . '/_ic/yapay_zeka.php';
require __DIR__ . '/_ic/esitleme.php';

$islem = is_string($_GET['islem'] ?? null) ? $_GET['islem'] : '';
$yontem = $_SERVER['REQUEST_METHOD'] ?? 'GET';

try {
    if ($islem === 'onay' && $yontem === 'GET') epostaOnayla();
    if ($islem === 'oturum' && $yontem === 'GET') {
        $k = oturumKullanicisi();
        yanit(200, ['eposta' => $k['eposta'] ?? null]);
    }
    if ($islem === 'firmalarim' && $yontem === 'GET') firmalarim();
    if ($islem === 'uyeler' && $yontem === 'GET') uyeler();
    if ($islem === 'cek' && $yontem === 'GET') cek();

    if ($yontem !== 'POST') throw new ApiHatasi(405, 'Geçersiz istek.');
    if (($_SERVER['HTTP_X_ISTEK'] ?? '') !== '1') throw new ApiHatasi(403, 'Geçersiz istek.');

    match ($islem) {
        'kayit' => kayitOl(girdi()),
        'giris' => girisYap(girdi()),
        'hesap_sil' => hesapSil(girdi()),
        'cikis' => (function () { oturumKapat(); yanit(200, ['tamam' => true]); })(),
        'duzenle' => duzenle(girdi()),
        'firma_olustur' => firmaOlustur(girdi()),
        'davet_olustur' => davetOlustur(girdi()),
        'davet_kabul' => davetKabul(girdi()),
        'baglanti_kaldir' => baglantiKaldir(girdi()),
        'gonder' => gonder(girdi()),
        default => throw new ApiHatasi(404, 'Bilinmeyen işlem.'),
    };
} catch (ApiHatasi $e) {
    yanit($e->durum, ['hata' => $e->getMessage()]);
} catch (Throwable $e) {
    error_log('API hatası: ' . $e->getMessage());
    yanit(500, ['hata' => 'Sunucuda beklenmeyen bir hata oluştu.']);
}

function epostaDogrula(string $eposta): string
{
    $eposta = mb_strtolower($eposta);
    if (strlen($eposta) > 254 || !filter_var($eposta, FILTER_VALIDATE_EMAIL)) throw new ApiHatasi(400, 'E-posta adresi geçerli görünmüyor.');
    return $eposta;
}

function kayitOl(array $g): never
{
    $eposta = epostaDogrula(metinAl($g, 'eposta'));
    $sifre = isset($g['sifre']) && is_string($g['sifre']) ? $g['sifre'] : '';
    if (mb_strlen($sifre) < EN_KISA_SIFRE) throw new ApiHatasi(400, 'Şifre kabul edilmedi: en az ' . EN_KISA_SIFRE . ' karakter kullanın.');
    if (mb_strlen($sifre) > EN_UZUN_SIFRE) throw new ApiHatasi(400, 'Şifre çok uzun.');

    $cok = 'Çok sık deneme yapıldı; biraz bekleyip yeniden deneyin.';
    denemeSiniri('kayit-ip:' . istemciIp(), 5, 3600, $cok);
    denemeSiniri('kayit-eposta:' . $eposta, 3, 3600, $cok);

    $s = vt()->prepare('SELECT id, onayli, onay_son FROM kullanicilar WHERE eposta = ?');
    $s->execute([$eposta]);
    $var = $s->fetch();
    // Onaylı hesap ya da süresi dolmamış onay bekleyen kayıt varsa yeniden kayıt yok.
    if ($var && ((int) $var['onayli'] === 1 || ($var['onay_son'] !== null && $var['onay_son'] > simdi()))) {
        throw new ApiHatasi(409, (int) $var['onayli'] === 1
            ? 'Bu e-posta ile zaten hesap var; "Giriş yap"ı kullanın.'
            : 'Bu adrese onay e-postası daha önce gönderildi; e-postanızı (gereksiz klasörü dahil) kontrol edin.');
    }

    $kod = bin2hex(random_bytes(32));
    $ozet = password_hash($sifre, PASSWORD_DEFAULT);
    if ($var) {
        $id = (int) $var['id'];
        vt()->prepare('UPDATE kullanicilar SET sifre_ozet = ?, onay_kodu_ozet = ?, onay_son = ? WHERE id = ?')
            ->execute([$ozet, hash('sha256', $kod), simdi(86400), $id]);
    } else {
        vt()->prepare('INSERT INTO kullanicilar (eposta, sifre_ozet, onay_kodu_ozet, onay_son, olusturma) VALUES (?, ?, ?, ?, ?)')
            ->execute([$eposta, $ozet, hash('sha256', $kod), simdi(86400), simdi()]);
        $id = (int) vt()->lastInsertId();
    }
    try {
        onayEpostasiGonder($eposta, $kod);
    } catch (Throwable $e) {
        // E-posta gitmediyse kayıt bekletilmez; aynı adresle hemen yeniden denenebilir.
        vt()->prepare('DELETE FROM kullanicilar WHERE id = ? AND onayli = 0')->execute([$id]);
        throw $e;
    }
    yanit(200, ['durum' => 'onay_bekliyor']);
}

function epostaOnayla(): never
{
    $kod = is_string($_GET['kod'] ?? null) ? $_GET['kod'] : '';
    $sonuc = 'hata';
    if (preg_match('/^[0-9a-f]{64}$/', $kod)) {
        $s = vt()->prepare('UPDATE kullanicilar SET onayli = 1, onay_kodu_ozet = NULL, onay_son = NULL
                            WHERE onay_kodu_ozet = ? AND onay_son > ?');
        $s->execute([hash('sha256', $kod), simdi()]);
        if ($s->rowCount() === 1) $sonuc = 'onaylandi';
    }
    header('Cache-Control: no-store');
    header('Location: ' . rtrim((string) ayarlar()['site_adresi'], '/') . '/#yz-onay=' . $sonuc, true, 302);
    exit;
}

function girisYap(array $g): never
{
    $eposta = mb_strtolower(metinAl($g, 'eposta'));
    $sifre = isset($g['sifre']) && is_string($g['sifre']) ? $g['sifre'] : '';
    if ($eposta === '' || $sifre === '' || strlen($eposta) > 254 || mb_strlen($sifre) > EN_UZUN_SIFRE) {
        throw new ApiHatasi(400, 'E-posta ya da şifre hatalı.');
    }
    $cok = 'Çok sık deneme yapıldı; biraz bekleyip yeniden deneyin.';
    denemeSiniri('giris-ip:' . istemciIp(), 20, 900, $cok);
    denemeSiniri('giris-eposta:' . $eposta, 10, 900, $cok);

    $s = vt()->prepare('SELECT id, sifre_ozet, onayli FROM kullanicilar WHERE eposta = ?');
    $s->execute([$eposta]);
    $k = $s->fetch();
    // Hesap yoksa da aynı süre harcansın (hangi adreslerin kayıtlı olduğu anlaşılmasın).
    $ozet = $k['sifre_ozet'] ?? password_hash(bin2hex(random_bytes(8)), PASSWORD_DEFAULT);
    if (!password_verify($sifre, $ozet) || !$k) throw new ApiHatasi(401, 'E-posta ya da şifre hatalı.');
    if ((int) $k['onayli'] !== 1) throw new ApiHatasi(403, 'E-posta adresiniz henüz onaylanmadı; e-postanızdaki onay bağlantısına tıklayın.');

    if (password_needs_rehash($ozet, PASSWORD_DEFAULT)) {
        vt()->prepare('UPDATE kullanicilar SET sifre_ozet = ? WHERE id = ?')->execute([password_hash($sifre, PASSWORD_DEFAULT), $k['id']]);
    }
    oturumAc((int) $k['id']);
    yanit(200, ['eposta' => $eposta]);
}

function duzenle(array $g): never
{
    $k = oturumKullanicisi();
    if (!$k) throw new ApiHatasi(401, "Yapay zekâ için önce Ayarlar'dan giriş yapın.");

    $ustaTipi = mb_substr(metinAl($g, 'ustaTipi'), 0, 120);
    $metin = metinAl($g, 'metin');
    if ($ustaTipi === '' || $metin === '') throw new ApiHatasi(400, 'Usta tipi ve özel şartlar metni gerekli.');
    if (mb_strlen($metin) > EN_UZUN_METIN) throw new ApiHatasi(400, 'Metin en çok ' . EN_UZUN_METIN . ' karakter olabilir.');

    $kalanHak = hakKullan($k['id'], (int) (ayarlar()['gunluk_sinir'] ?? 20));
    try {
        $sonuc = claudeIleDuzenle($ustaTipi, $metin);
    } catch (Throwable $e) {
        hakIade($k['id']);
        throw $e;
    }
    yanit(200, $sonuc + ['kalanHak' => $kalanHak]);
}

/**
 * Hesabı siler (Play Store kuralı: kullanıcı hesabını uygulamadan silebilmeli). Şifre yeniden istenir.
 * Hesabın açtığı buluttaki firma başka üyesi varsa ona devredilir; tek üyesi bu hesapsa firma ve kayıtları silinir.
 * Cihazlardaki kayıtlara dokunulmaz.
 */
function hesapSil(array $g): never
{
    $k = oturumKullanicisi();
    if (!$k) throw new ApiHatasi(401, 'Önce giriş yapın.');
    $sifre = isset($g['sifre']) && is_string($g['sifre']) ? $g['sifre'] : '';
    denemeSiniri('sil-hesap:' . $k['id'], 5, 900, 'Çok sık deneme yapıldı; biraz bekleyip yeniden deneyin.');
    $s = vt()->prepare('SELECT sifre_ozet FROM kullanicilar WHERE id = ?');
    $s->execute([$k['id']]);
    if (!password_verify($sifre, (string) $s->fetchColumn())) throw new ApiHatasi(401, 'Şifre hatalı.');

    $p = vt();
    $p->beginTransaction();
    try {
        $f = $p->prepare('SELECT id FROM firmalar WHERE olusturan = ?');
        $f->execute([$k['id']]);
        foreach ($f->fetchAll(PDO::FETCH_COLUMN) as $firmaId) {
            $u = $p->prepare('SELECT hesap_id FROM firma_uyeleri WHERE firma_id = ? AND hesap_id <> ? LIMIT 1');
            $u->execute([$firmaId, $k['id']]);
            $baska = $u->fetchColumn();
            if ($baska !== false) $p->prepare('UPDATE firmalar SET olusturan = ? WHERE id = ?')->execute([$baska, $firmaId]);
            else $p->prepare('DELETE FROM firmalar WHERE id = ?')->execute([$firmaId]);
        }
        $p->prepare('DELETE FROM davetler WHERE olusturan = ?')->execute([$k['id']]);
        $p->prepare('DELETE FROM kullanicilar WHERE id = ?')->execute([$k['id']]);
        $p->commit();
    } catch (Throwable $e) {
        $p->rollBack();
        throw $e;
    }
    cerezYaz('', 0);
    yanit(200, ['tamam' => true]);
}
