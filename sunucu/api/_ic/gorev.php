<?php
// Günlük görevler (yalnız komut satırından; cPanel › Cron Jobs):
//   php /home/KULLANICI/<site klasörü>/api/_ic/gorev.php hatirlatma
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require __DIR__ . '/cekirdek.php';
require __DIR__ . '/eposta.php';
require __DIR__ . '/esitleme.php';
require __DIR__ . '/webpush.php';
require __DIR__ . '/hatirlatma.php';

$gorev = $argv[1] ?? '';
try {
    if ($gorev === 'hatirlatma') {
        echo 'Gönderilen hesap: ' . hatirlatmalariGonder() . PHP_EOL;
        exit(0);
    }
    fwrite(STDERR, "Kullanım: php gorev.php hatirlatma\n");
    exit(2);
} catch (Throwable $e) {
    fwrite(STDERR, 'Hata: ' . $e->getMessage() . PHP_EOL);
    exit(1);
}
