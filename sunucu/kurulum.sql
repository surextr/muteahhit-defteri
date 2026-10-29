-- Müteahhit Hesap Defteri — yapay zekâ ile sözleşme düzenleme için sunucu tabloları (MySQL / MariaDB).
-- cPanel › phpMyAdmin › veritabanını seçin › İçe Aktar (Import) › bu dosya. Tekrar çalıştırmak zararsızdır.
-- Uygulamanın kayıtları buraya gelmez; yalnızca giriş bilgisi ve günlük kullanım sayısı tutulur.

CREATE TABLE IF NOT EXISTS kullanicilar (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  eposta VARCHAR(254) NOT NULL,
  sifre_ozet VARCHAR(255) NOT NULL,
  onayli TINYINT(1) NOT NULL DEFAULT 0,
  onay_kodu_ozet CHAR(64) NULL,
  onay_son DATETIME NULL,
  olusturma DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY eposta (eposta),
  KEY onay_kodu_ozet (onay_kodu_ozet)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Oturum: tarayıcıdaki çerezde rastgele anahtar, burada yalnızca SHA-256 özeti.
CREATE TABLE IF NOT EXISTS oturumlar (
  anahtar_ozet CHAR(64) NOT NULL,
  kullanici_id INT UNSIGNED NOT NULL,
  son_kullanma DATETIME NOT NULL,
  PRIMARY KEY (anahtar_ozet),
  KEY kullanici_id (kullanici_id),
  CONSTRAINT oturum_kullanici FOREIGN KEY (kullanici_id) REFERENCES kullanicilar (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Kullanıcı başına günlük düzenleme sayısı (gün Türkiye saatine göre).
CREATE TABLE IF NOT EXISTS yz_kullanim (
  kullanici_id INT UNSIGNED NOT NULL,
  gun DATE NOT NULL,
  sayi INT NOT NULL DEFAULT 0,
  PRIMARY KEY (kullanici_id, gun),
  CONSTRAINT kullanim_kullanici FOREIGN KEY (kullanici_id) REFERENCES kullanicilar (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Kullanıcı başına günlük yapay zekâ ile belge okuma sayısı (yoksa API ilk kullanımda kendisi kurar).
CREATE TABLE IF NOT EXISTS yz_belge_kullanim (
  kullanici_id INT UNSIGNED NOT NULL,
  gun DATE NOT NULL,
  sayi INT NOT NULL DEFAULT 0,
  PRIMARY KEY (kullanici_id, gun),
  CONSTRAINT belge_kullanim_kullanici FOREIGN KEY (kullanici_id) REFERENCES kullanicilar (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Kaba kuvvet ve e-posta seli önlemi: giriş/kayıt denemeleri (eski satırlar kendiliğinden silinir).
CREATE TABLE IF NOT EXISTS denemeler (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  anahtar VARCHAR(300) NOT NULL,
  zaman DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY anahtar_zaman (anahtar, zaman)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Bulut eşitleme (şema eklemesi; tekrar çalıştırmak zararsızdır) ───────────────────────────
-- Firmanın kayıtları cihazlardaki IndexedDB tablolarının aynısıdır: her satır bir kayıt (JSON). Sunucu kaydı yorumlamaz;
-- yalnızca yetkiyi (yetkiler.json) ve "son yazan kazanır" sürüm kuralını uygular. `sira` firmanın değişiklik sayacıdır:
-- cihaz en son aldığı sıradan sonrasını çeker.

CREATE TABLE IF NOT EXISTS firmalar (
  id VARCHAR(64) NOT NULL,
  ad VARCHAR(200) NOT NULL,
  son_sira BIGINT UNSIGNED NOT NULL DEFAULT 0,
  olusturan INT UNSIGNED NOT NULL,
  olusturma DATETIME NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT firma_olusturan FOREIGN KEY (olusturan) REFERENCES kullanicilar (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Hangi giriş hesabı firmada hangi kullanıcıdır (cihazdaki `kullanici` kaydının kimliği). Rol, eşitlenen `uyelik`
-- kaydından okunur; yönetici rolü değiştirince sunucu da yeni rolle denetler.
CREATE TABLE IF NOT EXISTS firma_uyeleri (
  firma_id VARCHAR(64) NOT NULL,
  hesap_id INT UNSIGNED NOT NULL,
  kullanici_id VARCHAR(64) NOT NULL,
  baglanma DATETIME NOT NULL,
  PRIMARY KEY (firma_id, hesap_id),
  UNIQUE KEY firma_kullanici (firma_id, kullanici_id),
  KEY hesap (hesap_id),
  CONSTRAINT uye_firma FOREIGN KEY (firma_id) REFERENCES firmalar (id) ON DELETE CASCADE,
  CONSTRAINT uye_hesap FOREIGN KEY (hesap_id) REFERENCES kullanicilar (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Davet kodu: yönetici üretir, katılan kişi kendi hesabıyla girer. Burada yalnızca kodun SHA-256 özeti.
CREATE TABLE IF NOT EXISTS davetler (
  kod_ozet CHAR(64) NOT NULL,
  firma_id VARCHAR(64) NOT NULL,
  kullanici_id VARCHAR(64) NOT NULL,
  son DATETIME NOT NULL,
  olusturan INT UNSIGNED NOT NULL,
  PRIMARY KEY (kod_ozet),
  KEY firma_kullanici (firma_id, kullanici_id),
  CONSTRAINT davet_firma FOREIGN KEY (firma_id) REFERENCES firmalar (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS kayitlar (
  firma_id VARCHAR(64) NOT NULL,
  tablo VARCHAR(40) NOT NULL,
  id VARCHAR(64) NOT NULL,
  veri LONGTEXT NOT NULL,
  surum INT NOT NULL DEFAULT 0,
  zaman VARCHAR(40) NOT NULL DEFAULT '',
  sira BIGINT UNSIGNED NOT NULL,
  yazan INT UNSIGNED NOT NULL,
  PRIMARY KEY (firma_id, tablo, id),
  KEY firma_sira (firma_id, sira),
  CONSTRAINT kayit_firma FOREIGN KEY (firma_id) REFERENCES firmalar (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
