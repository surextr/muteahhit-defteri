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
}
