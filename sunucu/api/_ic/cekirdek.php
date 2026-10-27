<?php
// Ortak parçalar: ayarlar, veritabanı, JSON yanıt, oturum çerezi, deneme sınırı.
declare(strict_types=1);

final class ApiHatasi extends Exception
{
    public function __construct(public readonly int $durum, string $mesaj)
    {
        parent::__construct($mesaj);
    }
}

const OTURUM_CEREZI = 'yz_oturum';
const OTURUM_GUN = 30;
const EN_KISA_SIFRE = 8;
const EN_UZUN_SIFRE = 200;

/** muteahhit-ayarlar.php: önce MUTEAHHIT_AYARLAR ortam değişkeni, sonra bu klasörden yukarı doğru aranır (web kökünün dışı). */
function ayarlar(): array
{
    static $a = null;
    if ($a !== null) return $a;
    $adaylar = [];
    $ortam = getenv('MUTEAHHIT_AYARLAR');
    if ($ortam) $adaylar[] = $ortam;
    $klasor = __DIR__;
    for ($i = 0; $i < 6; $i++) {
        $klasor = dirname($klasor);
        $adaylar[] = $klasor . '/muteahhit-ayarlar.php';
    }
    foreach ($adaylar as $yol) {
        if (is_file($yol)) {
            $a = require $yol;
            if (!is_array($a)) break;
            return $a;
        }
    }
    throw new ApiHatasi(500, 'Sunucu ayar dosyası (muteahhit-ayarlar.php) bulunamadı.');
}

function vt(): PDO
{
    static $p = null;
    if ($p) return $p;
    $v = ayarlar()['vt'];
    try {
        $p = new PDO("mysql:host={$v['sunucu']};dbname={$v['ad']};charset=utf8mb4", $v['kullanici'], $v['sifre'], [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
    } catch (PDOException) {
        throw new ApiHatasi(500, 'Veritabanına bağlanılamadı.');
    }
    // Saatler UTC tutulur; "gün" ayrıca Türkiye saatine göre hesaplanır.
    $p->exec("SET time_zone = '+00:00'");
    return $p;
}

function simdi(int $saniyeSonra = 0): string
{
    return gmdate('Y-m-d H:i:s', time() + $saniyeSonra);
}

function turkiyeGunu(): string
{
    return (new DateTimeImmutable('now', new DateTimeZone('Europe/Istanbul')))->format('Y-m-d');
}

function yanit(int $durum, array $govde): never
{
    http_response_code($durum);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($govde, JSON_UNESCAPED_UNICODE);
    exit;
}

function girdi(): array
{
    $g = json_decode((string) file_get_contents('php://input'), true);
    if (!is_array($g)) throw new ApiHatasi(400, 'İstek okunamadı.');
    return $g;
}

function metinAl(array $g, string $ad): string
{
    return isset($g[$ad]) && is_string($g[$ad]) ? trim($g[$ad]) : '';
}

function istemciIp(): string
{
    return $_SERVER['REMOTE_ADDR'] ?? 'bilinmiyor';
}

// --- Oturum ---------------------------------------------------------------

function cerezYaz(string $deger, int $sure): void
{
    setcookie(OTURUM_CEREZI, $deger, [
        'expires' => $sure > 0 ? time() + $sure : time() - 3600,
        'path' => '/',
        'secure' => empty(ayarlar()['gelistirme']),
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
}

function oturumAc(int $kullaniciId): void
{
    $anahtar = bin2hex(random_bytes(32));
    vt()->prepare('INSERT INTO oturumlar (anahtar_ozet, kullanici_id, son_kullanma) VALUES (?, ?, ?)')
        ->execute([hash('sha256', $anahtar), $kullaniciId, simdi(OTURUM_GUN * 86400)]);
    cerezYaz($anahtar, OTURUM_GUN * 86400);
    // Ara sıra süresi dolan oturumları temizle.
    if (random_int(1, 20) === 1) vt()->prepare('DELETE FROM oturumlar WHERE son_kullanma < ?')->execute([simdi()]);
}

/** Geçerli oturumun kullanıcısı: ['id' => …, 'eposta' => …] ya da null. */
function oturumKullanicisi(): ?array
{
    $anahtar = $_COOKIE[OTURUM_CEREZI] ?? '';
    if (!is_string($anahtar) || !preg_match('/^[0-9a-f]{64}$/', $anahtar)) return null;
    $s = vt()->prepare(
        'SELECT k.id, k.eposta FROM oturumlar o JOIN kullanicilar k ON k.id = o.kullanici_id
         WHERE o.anahtar_ozet = ? AND o.son_kullanma > ? AND k.onayli = 1'
    );
    $s->execute([hash('sha256', $anahtar), simdi()]);
    $k = $s->fetch();
    return $k ? ['id' => (int) $k['id'], 'eposta' => $k['eposta']] : null;
}

function oturumKapat(): void
{
    $anahtar = $_COOKIE[OTURUM_CEREZI] ?? '';
    if (is_string($anahtar) && $anahtar !== '') {
        vt()->prepare('DELETE FROM oturumlar WHERE anahtar_ozet = ?')->execute([hash('sha256', $anahtar)]);
    }
    cerezYaz('', 0);
}

// --- Deneme sınırı ---------------------------------------------------------

/** Son $saniye içinde $anahtar için $sinir'den fazla deneme varsa 429. Denemeyi kaydeder. */
function denemeSiniri(string $anahtar, int $sinir, int $saniye, string $mesaj): void
{
    $s = vt()->prepare('SELECT COUNT(*) FROM denemeler WHERE anahtar = ? AND zaman > ?');
    $s->execute([$anahtar, simdi(-$saniye)]);
    if ((int) $s->fetchColumn() >= $sinir) throw new ApiHatasi(429, $mesaj);
    vt()->prepare('INSERT INTO denemeler (anahtar, zaman) VALUES (?, ?)')->execute([$anahtar, simdi()]);
    if (random_int(1, 50) === 1) vt()->prepare('DELETE FROM denemeler WHERE zaman < ?')->execute([simdi(-86400)]);
}
