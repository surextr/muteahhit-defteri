import Dexie, { type Table } from 'dexie';
import type { Depo, GecistenOnce, Kosul, TabloIcerigi } from '../depo';
import type { TabloAdi, Tablolar } from '../tipler';
import { SEMA_SURUMU, semaTanimla } from './sema';

/** Depo arayüzünün tarayıcı (IndexedDB) uygulaması. */
export class DexieDepo implements Depo {
  readonly semaSurumu = SEMA_SURUMU;
  private readonly db: Dexie;

  constructor(
    veritabaniAdi: string,
    private readonly gecistenOnce?: GecistenOnce,
  ) {
    this.db = new Dexie(veritabaniAdi);
    semaTanimla(this.db);
  }

  async ac(): Promise<void> {
    if (this.gecistenOnce) await this.gecisGerekiyorsaYedekle(this.gecistenOnce);
    await this.db.open();
  }

  /** Cihazdaki veritabanı eski sürümdeyse, Dexie güncellemeden önce eski haliyle okunur. */
  private async gecisGerekiyorsaYedekle(gecistenOnce: GecistenOnce): Promise<void> {
    if (!(await Dexie.exists(this.db.name))) return;
    // Şema tanımlamadan açmak, veritabanını değiştirmeden mevcut sürümüyle okur.
    const eski = new Dexie(this.db.name);
    await eski.open();
    try {
      if (eski.verno >= SEMA_SURUMU) return;
      const icerik: Record<string, unknown[]> = {};
      let meta: Record<string, unknown> = {};
      for (const t of eski.tables) {
        const satirlar = await t.toArray();
        if (t.name === 'meta') meta = Object.fromEntries(satirlar.map((s) => [s.anahtar, s.deger]));
        else icerik[t.name] = satirlar;
      }
      await gecistenOnce({ eskiSurum: eski.verno, yeniSurum: SEMA_SURUMU, icerik: icerik as TabloIcerigi, meta });
    } finally {
      eski.close();
    }
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

  async metaHepsi(): Promise<Record<string, unknown>> {
    const satirlar = await this.tablo('meta').toArray();
    return Object.fromEntries(satirlar.map((s) => [s.anahtar, s.deger]));
  }

  private veriTablolari(): Table<any, string>[] {
    return this.db.tables.filter((t) => t.name !== 'meta');
  }

  async hepsiniOku(): Promise<TabloIcerigi> {
    const icerik: Record<string, unknown[]> = {};
    await this.db.transaction('r', this.veriTablolari(), async () => {
      for (const t of this.veriTablolari()) icerik[t.name] = await t.toArray();
    });
    return icerik as TabloIcerigi;
  }

  async hepsiniDegistir(icerik: TabloIcerigi, meta: Record<string, unknown>): Promise<void> {
    const bilinen = new Set(this.veriTablolari().map((t) => t.name));
    const bilinmeyen = Object.keys(icerik).filter((ad) => !bilinen.has(ad));
    if (bilinmeyen.length > 0) throw new Error(`Yedekte bu sürümde olmayan tablolar var: ${bilinmeyen.join(', ')}`);

    await this.db.transaction('rw', this.db.tables, async () => {
      for (const t of this.db.tables) await t.clear();
      for (const [ad, kayitlar] of Object.entries(icerik)) {
        if (kayitlar && kayitlar.length > 0) await this.db.table(ad).bulkAdd(kayitlar);
      }
      await this.tablo('meta').bulkAdd(Object.entries(meta).map(([anahtar, deger]) => ({ anahtar, deger })));
    });
  }

  kapat(): void {
    this.db.close();
  }
}
