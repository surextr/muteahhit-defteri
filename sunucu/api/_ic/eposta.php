<?php
// Onay e-postası: cPanel'in PHP mail() işlevi (gönderen adres cPanel'de var olmalı).
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

    $gonderen = (string) $a['eposta_gonderen'];
    $ad = mb_encode_mimeheader((string) ($a['eposta_gonderen_ad'] ?? 'Müteahhit Hesap Defteri'), 'UTF-8', 'B');
    $basliklar = implode("\r\n", [
        "From: $ad <$gonderen>",
        "Reply-To: $gonderen",
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: 8bit',
    ]);
    $tamam = mail($alici, mb_encode_mimeheader($konu, 'UTF-8', 'B'), $govde, $basliklar, '-f' . $gonderen);
    if (!$tamam) throw new ApiHatasi(500, 'Onay e-postası gönderilemedi; biraz sonra yeniden deneyin.');
}
