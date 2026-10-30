<?php
// Onay e-postası. Ayarlarda 'smtp' varsa e-posta hesabıyla SMTP üzerinden (önerilen), yoksa PHP mail() ile gönderilir.
declare(strict_types=1);

function onayEpostasiGonder(string $alici, string $kod): void
{
    $a = ayarlar();
    $baglanti = rtrim((string) $a['site_adresi'], '/') . '/api/?islem=onay&kod=' . $kod;
    $konu = 'Müteahhit Hesap Defteri: e-posta adresinizi onaylayın';
    $govde = "Merhaba,\r\n\r\n"
        . "Müteahhit Hesap Defteri'nde yapay zekâ ile sözleşme düzenleme için hesap açıldı.\r\n"
        . "Adresinizi onaylamak için bağlantıya tıklayın (24 saat geçerli):\r\n\r\n"
        . "$baglanti\r\n\r\n"
        . "Bu kaydı siz yapmadıysanız bu e-postayı yok sayın.\r\n";

    if (!empty($a['gelistirme']) && !empty($a['eposta_klasoru'])) {
        file_put_contents(rtrim($a['eposta_klasoru'], '/') . '/' . $alici . '.txt', $baglanti);
        return;
    }

    try {
        epostaGonder($alici, $konu, $govde);
    } catch (Throwable $e) {
        error_log('E-posta gönderilemedi: ' . $e->getMessage());
        throw new ApiHatasi(500, 'Onay e-postası gönderilemedi; biraz sonra yeniden deneyin.');
    }
}

/** Düz metin e-posta (SMTP ayarı varsa onunla, yoksa mail()). Geliştirmede 'eposta_klasoru'ne dosya olarak yazılır. */
function epostaGonder(string $alici, string $konu, string $govde): void
{
    $a = ayarlar();
    if (!empty($a['gelistirme']) && !empty($a['eposta_klasoru'])) {
        file_put_contents(rtrim($a['eposta_klasoru'], '/') . '/' . $alici . '.' . substr(hash('sha256', $konu . $govde), 0, 8) . '.eml.txt', "Konu: $konu\n\n$govde");
        return;
    }
    $gonderen = (string) $a['eposta_gonderen'];
    $ad = mb_encode_mimeheader((string) ($a['eposta_gonderen_ad'] ?? 'Müteahhit Hesap Defteri'), 'UTF-8', 'B');
    $konuBasligi = mb_encode_mimeheader($konu, 'UTF-8', 'B');
    if (!empty($a['smtp']) && is_array($a['smtp'])) {
        smtpGonder($a['smtp'], $gonderen, $ad, $alici, $konuBasligi, $govde);
        return;
    }
    if (!function_exists('mail')) throw new RuntimeException("PHP mail() bu sunucuda kapalı; ayar dosyasına 'smtp' ekleyin.");
    $basliklar = implode("\r\n", [
        "From: $ad <$gonderen>",
        "Reply-To: $gonderen",
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: 8bit',
    ]);
    if (!mail($alici, $konuBasligi, $govde, $basliklar, '-f' . $gonderen)) throw new RuntimeException('mail() başarısız döndü.');
}

/**
 * Basit SMTP istemcisi (AUTH LOGIN). 'sifreleme': 'ssl' (465, varsayılan), 'tls' (587, STARTTLS) ya da 'yok'.
 * $s: ['sunucu' => 'mail.surex.tr', 'port' => 465, 'kullanici' => 'noreply@surex.tr', 'sifre' => '…']
 */
function smtpGonder(array $s, string $gonderen, string $gonderenAdi, string $alici, string $konu, string $govde): void
{
    $sunucu = (string) ($s['sunucu'] ?? 'localhost');
    $port = (int) ($s['port'] ?? 465);
    $sifreleme = (string) ($s['sifreleme'] ?? ($port === 465 ? 'ssl' : 'tls'));
    $baglam = stream_context_create(['ssl' => [
        'verify_peer' => !empty($s['sertifika_dogrula'] ?? true),
        'verify_peer_name' => !empty($s['sertifika_dogrula'] ?? true),
    ]]);
    $adres = ($sifreleme === 'ssl' ? 'ssl://' : 'tcp://') . $sunucu . ':' . $port;
    $b = @stream_socket_client($adres, $no, $hata, 20, STREAM_CLIENT_CONNECT, $baglam);
    if (!$b) throw new RuntimeException("SMTP bağlantısı kurulamadı ($adres): $hata");
    stream_set_timeout($b, 20);

    $oku = function () use ($b): array {
        $metin = '';
        while (($satir = fgets($b, 1024)) !== false) {
            $metin .= $satir;
            if (strlen($satir) < 4 || $satir[3] === ' ') break;
        }
        return [(int) substr($metin, 0, 3), trim($metin)];
    };
    // $etiket: hata kaydında komut yerine gösterilen ad (kimlik bilgisi ve ileti içeriği kayda yazılmaz).
    $komut = function (?string $k, array $beklenen, ?string $etiket = null) use ($b, $oku): void {
        if ($k !== null) fwrite($b, $k . "\r\n");
        [$kod, $metin] = $oku();
        if (!in_array($kod, $beklenen, true)) {
            $gosterilen = $etiket ?? ($k ?? 'bağlantı');
            throw new RuntimeException("SMTP '$gosterilen' reddedildi: $metin");
        }
    };

    try {
        $komut(null, [220]);
        $makine = gethostname() ?: 'localhost';
        $komut("EHLO $makine", [250]);
        if ($sifreleme === 'tls') {
            $komut('STARTTLS', [220]);
            if (!stream_socket_enable_crypto($b, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) throw new RuntimeException('STARTTLS başarısız.');
            $komut("EHLO $makine", [250]);
        }
        $komut('AUTH LOGIN', [334]);
        $komut(base64_encode((string) $s['kullanici']), [334], 'kullanıcı adı');
        $komut(base64_encode((string) $s['sifre']), [235], 'şifre');
        $komut("MAIL FROM:<$gonderen>", [250]);
        $komut("RCPT TO:<$alici>", [250, 251]);
        $komut('DATA', [354]);
        $ileti = implode("\r\n", [
            "From: $gonderenAdi <$gonderen>",
            "To: <$alici>",
            "Subject: $konu",
            'Date: ' . date(DATE_RFC2822),
            'Message-ID: <' . bin2hex(random_bytes(12)) . '@' . substr(strrchr($gonderen, '@') ?: '@localhost', 1) . '>',
            'MIME-Version: 1.0',
            'Content-Type: text/plain; charset=UTF-8',
            'Content-Transfer-Encoding: base64',
            '',
            rtrim(chunk_split(base64_encode($govde), 76, "\r\n")),
        ]);
        $komut($ileti . "\r\n.", [250], 'ileti');
        fwrite($b, "QUIT\r\n");
    } finally {
        fclose($b);
    }
}
