import Dexie, { type Table } from 'dexie';
import type { Depo, Kosul } from '../depo';
import type { TabloAdi, Tablolar } from '../tipler';
import { SEMA_SURUMU, semaTanimla } from './sema';

/** Depo arayüzünün tarayıcı (IndexedDB) uygulaması. */
export class DexieDepo implements Depo {
  readonly semaSurumu = SEMA_SURUMU;
  private readonly db: Dexie;

  constructor(veritabaniAdi: string) {
    this.db = new Dexie(veritabaniAdi);
    semaTanimla(this.db);
  }

  async ac(): Promise<void> {
    await this.db.open();
  }

  // Dexie'nin tablo tipleri bizim tiplerimizi bilmez; dönüşüm burada, tek yerde yapılır.
  private tablo(ad: TabloAdi | 'meta'): Table<any, string> {
    return this.db.table(ad);
  }

  getir<T extends TabloAdi>(tablo: T, id: string): Promise<Tablolar[T] | undefined> {
    return this.tablo(tablo).get(id);
  }

  async listele<T extends TabloAdi>(tablo: T, kosul: Kosul<Tablolar[T]> = {}): Promise<Tablolar[T][]> {
    const t = this.tablo(tablo);
    const girdiler = Object.entries(kosul).filter(([, v]) => v !== undefined);

    // Dizinli bir alan varsa sorguyu onunla daralt; gerisini bellekte süz.
    const dizinler = new Set([
      t.schema.primKey.name,
      ...t.schema.indexes.filter((i) => !i.multi && !i.compound).map((i) => i.name),
    ]);
    const dizinli = girdiler.find(
      ([alan, deger]) => dizinler.has(alan) && (typeof deger === 'string' || typeof deger === 'number'),
    );
    let sonuc = dizinli
      ? t.where(dizinli[0]).equals(dizinli[1] as string | number)
      : t.toCollection();

    const kalan = girdiler.filter((g) => g !== dizinli);
    if (kalan.length > 0) {
      sonuc = sonuc.filter((kayit) => kalan.every(([alan, deger]) => kayit[alan] === deger));
    }
    return sonuc.toArray();
  }

  async ekle<T extends TabloAdi>(tablo: T, kayit: Tablolar[T]): Promise<void> {
    await this.tablo(tablo).add(kayit);
  }

  async yaz<T extends TabloAdi>(tablo: T, kayit: Tablolar[T]): Promise<void> {
    await this.tablo(tablo).put(kayit);
  }

  islem<R>(is: () => Promise<R>): Promise<R> {
    return this.db.transaction('rw', this.db.tables, is);
  }

  async metaGetir<T = unknown>(anahtar: string): Promise<T | undefined> {
    const satir = await this.tablo('meta').get(anahtar);
    return satir?.deger as T | undefined;
  }

  async metaYaz(anahtar: string, deger: unknown): Promise<void> {
    await this.tablo('meta').put({ anahtar, deger });
  }

  kapat(): void {
    this.db.close();
  }
}
