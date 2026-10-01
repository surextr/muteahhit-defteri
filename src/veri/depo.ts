import type { TabloAdi, Tablolar } from './tipler';

/** Alan = değer eşitlik koşulları; hepsi birlikte sağlanmalı. */
export type Kosul<T> = { [K in keyof T]?: T[K] };

/**
 * Veri saklama arayüzü. Uygulamanın geri kalanı yalnızca bunu bilir.
 * Şimdi IndexedDB (Dexie) ile, ileride SQLite (Capacitor) ile uygulanır.
 *
 * Bilerek silme metodu yoktur: kayıtlar iptal edilir (servisler/kayitServisi).
 */
export interface Depo {
  /** Veritabanı şemasının numaralı sürümü. */
  readonly semaSurumu: number;

  getir<T extends TabloAdi>(tablo: T, id: string): Promise<Tablolar[T] | undefined>;
  listele<T extends TabloAdi>(tablo: T, kosul?: Kosul<Tablolar[T]>): Promise<Tablolar[T][]>;
  /** Yeni kayıt; aynı id varsa hata verir. */
  ekle<T extends TabloAdi>(tablo: T, kayit: Tablolar[T]): Promise<void>;
  /** Var olan kaydın yerine yazar. */
  yaz<T extends TabloAdi>(tablo: T, kayit: Tablolar[T]): Promise<void>;
  /**
   * İçindeki bütün okuma/yazmalar tek seferde uygulanır ya da hiçbiri uygulanmaz.
   * İçeride yalnızca bu depo çağrılarını bekleyin (fetch, zamanlayıcı vb. değil).
   */
  islem<R>(is: () => Promise<R>): Promise<R>;

  /** Cihaza özel küçük ayarlar (cihazId, aktif firma, son yedek zamanı…). */
  metaGetir<T = unknown>(anahtar: string): Promise<T | undefined>;
  metaYaz(anahtar: string, deger: unknown): Promise<void>;

  kapat(): void;
}
