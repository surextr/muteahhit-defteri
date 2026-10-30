<?php
// Web Push (anlık bildirim) gönderimi; dış kütüphane gerekmez (openssl + curl).
//   RFC 8291 şifreleme (aes128gcm), RFC 8292 VAPID kimliği (ES256 JWT).
// VAPID anahtar çifti ilk gerektiğinde üretilir ve `sunucu_ayar` tablosunda saklanır (tarayıcıya yalnız açık anahtar gider).
declare(strict_types=1);

function b64u(string $ham): string
{
    return rtrim(strtr(base64_encode($ham), '+/', '-_'), '=');
}

function b64uCoz(string $metin): string
{
    $c = base64_decode(strtr($metin, '-_', '+/') . str_repeat('=', (4 - strlen($metin) % 4) % 4), true);
    if ($c === false) throw new RuntimeException('Geçersiz base64url.');
    return $c;
}

/** P-256 açık noktası (65 bayt, 0x04|x|y) → PEM (SubjectPublicKeyInfo). */
function p256AcikPem(string $nokta): string
{
    if (strlen($nokta) !== 65 || $nokta[0] !== "\x04") throw new RuntimeException('Geçersiz P-256 açık anahtarı.');
    $der = hex2bin('3059301306072a8648ce3d020106082a8648ce3d030107034200') . $nokta;
    return "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($der), 64, "\n") . "-----END PUBLIC KEY-----\n";
}

/** OpenSSL EC anahtarının açık noktası (65 bayt). */
function p256Nokta(OpenSSLAsymmetricKey $anahtar): string
{
    $d = openssl_pkey_get_details($anahtar);
    if (!$d || !isset($d['ec']['x'], $d['ec']['y'])) throw new RuntimeException('EC anahtarı okunamadı.');
    return "\x04" . str_pad($d['ec']['x'], 32, "\0", STR_PAD_LEFT) . str_pad($d['ec']['y'], 32, "\0", STR_PAD_LEFT);
}

function p256Uret(): OpenSSLAsymmetricKey
{
    $k = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'prime256v1']);
    if (!$k) throw new RuntimeException('EC anahtarı üretilemedi: ' . openssl_error_string());
    return $k;
}

/** DER ECDSA imzası → JWS'nin istediği 64 baytlık r||s. */
function derImzaHam(string $der): string
{
    $i = 2;
    if (ord($der[1]) & 0x80) $i += ord($der[1]) & 0x7f;
    $parca = function () use ($der, &$i): string {
        if ($der[$i] !== "\x02") throw new RuntimeException('Geçersiz imza.');
        $uz = ord($der[$i + 1]);
        $v = substr($der, $i + 2, $uz);
        $i += 2 + $uz;
        return str_pad(ltrim($v, "\0"), 32, "\0", STR_PAD_LEFT);
    };
    return $parca() . $parca();
}

function sunucuAyarTablosu(): void
{
    vt()->exec('CREATE TABLE IF NOT EXISTS sunucu_ayar (
        anahtar VARCHAR(64) NOT NULL, deger TEXT NOT NULL, PRIMARY KEY (anahtar)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
}

/** ['ozel' => PEM, 'acik' => base64url(65 bayt)] — yoksa üretir. */
function vapidAnahtarlari(): array
{
    static $v = null;
    if ($v) return $v;
    sunucuAyarTablosu();
    $s = vt()->prepare("SELECT deger FROM sunucu_ayar WHERE anahtar = 'vapid'");
    $s->execute();
    $kayit = $s->fetchColumn();
    if ($kayit === false) {
        $k = p256Uret();
        openssl_pkey_export($k, $pem);
        $yeni = json_encode(['ozel' => $pem, 'acik' => b64u(p256Nokta($k))]);
        // Aynı anda iki istek üretirse ilk yazılan kalır.
        vt()->prepare("INSERT IGNORE INTO sunucu_ayar (anahtar, deger) VALUES ('vapid', ?)")->execute([$yeni]);
        $s->execute();
        $kayit = $s->fetchColumn();
    }
    return $v = json_decode((string) $kayit, true);
}

/** VAPID Authorization başlığı (push servisinin kökü için 12 saat geçerli). */
function vapidBasligi(string $ucNokta): string
{
    $v = vapidAnahtarlari();
    $u = parse_url($ucNokta);
    $aud = $u['scheme'] . '://' . $u['host'] . (isset($u['port']) ? ':' . $u['port'] : '');
    $iletisim = (string) (ayarlar()['vapid_iletisim'] ?? ('mailto:' . (ayarlar()['eposta_gonderen'] ?? 'noreply@surex.tr')));
    $govde = b64u(json_encode(['typ' => 'JWT', 'alg' => 'ES256'])) . '.' . b64u(json_encode(['aud' => $aud, 'exp' => time() + 12 * 3600, 'sub' => $iletisim]));
    if (!openssl_sign($govde, $der, $v['ozel'], OPENSSL_ALGO_SHA256)) throw new RuntimeException('VAPID imzalanamadı.');
    return 'vapid t=' . $govde . '.' . b64u(derImzaHam($der)) . ', k=' . $v['acik'];
}

/**
 * RFC 8291 aes128gcm: mesajı aboneliğin anahtarlarıyla şifreler. $p256dh ve $auth base64url (tarayıcının verdiği).
 * Test için $gecici (sunucunun tek kullanımlık anahtarı) ve $tuz verilebilir.
 */
function pushSifrele(string $mesaj, string $p256dh, string $auth, ?OpenSSLAsymmetricKey $gecici = null, ?string $tuz = null): string
{
    $uaAcik = b64uCoz($p256dh);
    $gizli = b64uCoz($auth);
    $as = $gecici ?? p256Uret();
    $asAcik = p256Nokta($as);
    $ortak = openssl_pkey_derive(p256AcikPem($uaAcik), $as, 32);
    if ($ortak === false) throw new RuntimeException('Ortak anahtar türetilemedi.');
    $ikm = hash_hkdf('sha256', $ortak, 32, "WebPush: info\0" . $uaAcik . $asAcik, $gizli);
    $tuz ??= random_bytes(16);
    $cek = hash_hkdf('sha256', $ikm, 16, "Content-Encoding: aes128gcm\0", $tuz);
    $nonce = hash_hkdf('sha256', $ikm, 12, "Content-Encoding: nonce\0", $tuz);
    $sifreli = openssl_encrypt($mesaj . "\x02", 'aes-128-gcm', $cek, OPENSSL_RAW_DATA, $nonce, $etiket, '', 16);
    if ($sifreli === false) throw new RuntimeException('Şifrelenemedi.');
    return $tuz . pack('N', 4096) . chr(65) . $asAcik . $sifreli . $etiket;
}

/**
 * Bildirimi gönderir. Dönen: HTTP durumu (201/200 başarılı; 404/410 abonelik geçersiz, silinmeli).
 */
function pushGonder(string $ucNokta, string $p256dh, string $auth, array $veri): int
{
    if (!preg_match('#^https://#', $ucNokta)) throw new RuntimeException('Geçersiz bildirim adresi.');
    $govde = pushSifrele(json_encode($veri, JSON_UNESCAPED_UNICODE), $p256dh, $auth);
    $c = curl_init($ucNokta);
    curl_setopt_array($c, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $govde,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/octet-stream',
            'Content-Encoding: aes128gcm',
            'TTL: 86400',
            'Urgency: normal',
            'Authorization: ' . vapidBasligi($ucNokta),
        ],
    ]);
    curl_exec($c);
    $durum = (int) curl_getinfo($c, CURLINFO_HTTP_CODE);
    curl_close($c);
    return $durum;
}
