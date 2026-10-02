import type { OrtamBilgisi } from './ortam';

/**
 * Kalıcı depolama isteğinin sonucu.
 * Chrome soru sormadan kendisi karar verir; Firefox sorar; Safari yalnızca
 * ana ekrana/Dock'a eklenmiş uygulamaya verir.
 */
export type KaliciDepolamaSonucu = 'verildi' | 'reddedildi' | 'desteklenmiyor' | 'guvensiz_baglanti';

export interface DepolamaDurumu {
  /** Tarayıcı veriyi kendiliğinden silmeyecek mi? */
  kalici: boolean;
  /** Bayt; tarayıcı bildirmezse null. */
  kullanilan: number | null;
  kota: number | null;
}

/**
 * Cihaz özellikleri. Şimdi tarayıcı ile, mağaza uygulamasında Capacitor
 * eklentileriyle uygulanır (kamera, paylaşma, bildirim sonradan eklenecek).
 */
export interface Cihaz {
  kaliciDepolamaIste(): Promise<KaliciDepolamaSonucu>;
  depolamaDurumu(): Promise<DepolamaDurumu>;
  ortamBilgisi(): OrtamBilgisi;
  /** Dosyayı kullanıcının cihazına indirir/kaydeder (yedek, PDF…). */
  dosyaKaydet(dosya: Blob, dosyaAdi: string): Promise<void>;
  /** Kullanıcıya dosya seçtirir; vazgeçerse null. kabul: örn. '.json,application/json' */
  dosyaSec(kabul: string): Promise<File | null>;
  /** Birden çok dosya seçtirir; vazgeçerse boş liste. */
  dosyalarSec(kabul: string): Promise<File[]>;
  /** Arka kamerayla fotoğraf çektirir (desteklenmezse galeriden seçtirir); vazgeçerse null. */
  fotografCek(): Promise<File | null>;
  /**
   * Fotoğrafı en uzun kenarı `enUzun` piksel olacak JPEG'e küçültür (fiş/fatura okunur kalır).
   * Resim değilse, okunamıyorsa ya da zaten küçükse dosyayı olduğu gibi döndürür.
   */
  resimKucult(dosya: Blob, enUzun?: number, kalite?: number): Promise<Blob>;
  /**
   * Logo için: en uzun kenar `enUzun` piksele küçültülmüş resim, data URL olarak.
   * PNG şeffaflığı korunur (PNG kalır), diğerleri JPEG olur; SVG olduğu gibi. Resim okunamazsa hata.
   */
  logoHazirla(dosya: Blob, enUzun?: number): Promise<string>;
  /** Dosyayı cihazın göstericisinde açar (PDF, resim). */
  dosyaAc(dosya: Blob, dosyaAdi: string): void;
}
