import type { TabloAdi, Tablolar } from './tipler';

/** Alan = değer eşitlik koşulları; hepsi birlikte sağlanmalı. */
export type Kosul<T> = { [K in keyof T]?: T[K] };

/** Bütün tabloların içeriği (yedekleme için). */
export type TabloIcerigi = { [K in TabloAdi]?: Tablolar[K][] };

/**
 * Veritabanı yapısı güncellenmeden hemen önce çağrılır; eski veri bu fırsatta yedeklenir.
 * Hata verirse güncelleme yapılmaz ve veritabanı açılmaz.
 */
export type GecistenOnce = (eski: {
  eskiSurum: number;
  yeniSurum: number;
  icerik: TabloIcerigi;
  meta: Record<string, unknown>;
}) => Promise<void>;

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
  metaSil(anahtar: string): Promise<void>;
  metaHepsi(): Promise<Record<string, unknown>>;

  /** Yedek için bütün tabloları okur (meta hariç). */
  hepsiniOku(): Promise<TabloIcerigi>;
  /**
   * Yalnızca yedekten geri yükleme içindir: bütün tabloları ve meta değerlerini
   * boşaltıp verilenlerle doldurur. Tek işlemdir; hata olursa eski veri olduğu gibi kalır.
   */
  hepsiniDegistir(icerik: TabloIcerigi, meta: Record<string, unknown>): Promise<void>;

  // ─── Bulut eşitleme (veri katmanı izler; bkz. bulut/esitleme.ts) ───

  /**
   * Buluta gönderilmeyi bekleyen kayıtlar. `ekle`/`yaz` her yazdığı kaydı buraya işler (cihaza özel, yedeğe girmez).
   * `sayac`: kayıt sonra yeniden değişirse büyür; gönderim bittiğinde yalnız aynı sayaçlı işaret silinir.
   */
  bekleyenler(sinir: number): Promise<BekleyenKayit[]>;
  bekleyenSayisi(): Promise<number>;
  /** Gönderilen işaretleri siler (o arada yeniden değişenler kalır). */
  bekleyenleriTemizle(gonderilen: BekleyenKayit[]): Promise<void>;
  /** Bütün kayıtları gönderilecek işaretler (buluta ilk bağlanışta). */
  hepsiniBekleyenYap(): Promise<number>;
  /**
   * Sunucudan gelen kayıtları yazar; bekleyen işaret konmaz. Bu cihazda gönderilmeyi bekleyen kayıt atlanır (önce o
   * gönderilir, sunucu karar verir); `zorla` ise işareti kaldırıp yazar (sunucunun reddettiği kayıt). Dönüş: yazılan sayısı.
   */
  disaridanYaz(kayitlar: DisKayit[], zorla?: boolean): Promise<number>;
  /**
   * Bekleyen kaydın, bu cihazda değiştirilmeden önceki (en son eşitlenen) hâli; yeni kayıtta null. Sunucu değişikliği
   * reddedince üç yollu birleştirmede taban olur.
   */
  bekleyenTabani(tablo: TabloAdi, id: string): Promise<Record<string, unknown> | null>;
  /** Birleştirilen kaydı yazar ve gönderilecek işaretler (taban: sunucudaki hâl). */
  birlesikYaz(kayit: DisKayit, taban: Record<string, unknown>): Promise<void>;
  /** Bekleyen işaret konunca çağrılır (eşitlemeyi tetiklemek için). */
  degisinceHaberVer(dinleyici: (() => void) | null): void;

  kapat(): void;
}

export interface BekleyenKayit {
  tablo: TabloAdi;
  id: string;
  sayac: number;
}

export interface DisKayit {
  tablo: TabloAdi;
  kayit: Record<string, unknown> & { id: string };
}
