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

-- Kaba kuvvet ve e-posta seli önlemi: giriş/kayıt denemeleri (eski satırlar kendiliğinden silinir).
CREATE TABLE IF NOT EXISTS denemeler (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  anahtar VARCHAR(300) NOT NULL,
  zaman DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY anahtar_zaman (anahtar, zaman)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
