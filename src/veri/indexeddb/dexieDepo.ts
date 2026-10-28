import Dexie, { type Table } from 'dexie';
import type { BekleyenKayit, Depo, DisKayit, GecistenOnce, Kosul, TabloIcerigi } from '../depo';
import type { TabloAdi, Tablolar } from '../tipler';
import { SEMA_SURUMU, semaTanimla } from './sema';

/** Veri tablosu olmayan, cihaza özel tablolar. */
const CIHAZ_TABLOLARI = new Set(['meta', 'bekleyen']);
const anahtar = (tablo: string, id: string) => `${tablo}\u0001${id}`;

/** Depo arayüzünün tarayıcı (IndexedDB) uygulaması. */
export class DexieDepo implements Depo {
  readonly semaSurumu = SEMA_SURUMU;
  private readonly db: Dexie;
  private dinleyici: (() => void) | null = null;
  private sonSayac = 0;

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
  private tablo(ad: TabloAdi | 'meta' | 'bekleyen'): Table<any, string> {
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

  /** Artan sayaç (aynı milisaniyede iki değişiklik de ayrı sayılır). */
  private sayac(): number {
    this.sonSayac = Math.max(Date.now(), this.sonSayac + 1);
    return this.sonSayac;
  }

  /** Kaydı gönderilecek işaretler; taban (ilk değişiklikten önceki hâl) ilk işarette saklanır, sonrakilerde korunur. */
  private async isaretle(tablo: TabloAdi, id: string, onceki: unknown = null, tabanZorla = false): Promise<void> {
    const b = this.tablo('bekleyen');
    const a = anahtar(tablo, id);
    const eski = tabanZorla ? undefined : await b.get(a);
    await b.put({ anahtar: a, tablo, id, sayac: this.sayac(), taban: eski ? eski.taban : (onceki ?? null) });
    // İşlem bitmeden haber verilirse eşitleme yarım veriyi okuyabilir; kısa gecikmeyle ve işlem dışında çağrılır.
    if (this.dinleyici) setTimeout(() => this.dinleyici?.(), 0);
  }

  async ekle<T extends TabloAdi>(tablo: T, kayit: Tablolar[T]): Promise<void> {
    await this.db.transaction('rw', [this.tablo(tablo), this.tablo('bekleyen')], async () => {
      await this.tablo(tablo).add(kayit);
      await this.isaretle(tablo, (kayit as { id: string }).id);
    });
  }

  async yaz<T extends TabloAdi>(tablo: T, kayit: Tablolar[T]): Promise<void> {
    await this.db.transaction('rw', [this.tablo(tablo), this.tablo('bekleyen')], async () => {
      const id = (kayit as { id: string }).id;
      const onceki = await this.tablo(tablo).get(id);
      await this.tablo(tablo).put(kayit);
      await this.isaretle(tablo, id, onceki);
    });
  }

  async bekleyenTabani(tablo: TabloAdi, id: string): Promise<Record<string, unknown> | null> {
    return (await this.tablo('bekleyen').get(anahtar(tablo, id)))?.taban ?? null;
  }

  async birlesikYaz({ tablo, kayit }: DisKayit, taban: Record<string, unknown>): Promise<void> {
    await this.db.transaction('rw', [this.tablo(tablo), this.tablo('bekleyen')], async () => {
      await this.tablo(tablo).put(kayit);
      await this.isaretle(tablo, kayit.id, taban, true);
    });
  }

  async bekleyenler(sinir: number): Promise<BekleyenKayit[]> {
    const satirlar = await this.tablo('bekleyen').orderBy('sayac').limit(sinir).toArray();
    return satirlar.map((s) => ({ tablo: s.tablo, id: s.id, sayac: s.sayac }));
  }

  bekleyenSayisi(): Promise<number> {
    return this.tablo('bekleyen').count();
  }

  async bekleyenleriTemizle(gonderilen: BekleyenKayit[]): Promise<void> {
    const t = this.tablo('bekleyen');
    await this.db.transaction('rw', t, async () => {
      for (const g of gonderilen) {
        const simdiki = await t.get(anahtar(g.tablo, g.id));
        if (simdiki && simdiki.sayac === g.sayac) await t.delete(simdiki.anahtar);
      }
    });
  }

  async hepsiniBekleyenYap(): Promise<number> {
    let sayi = 0;
    await this.db.transaction('rw', this.db.tables, async () => {
      // Önce firma, kullanıcılar ve üyelikler gitsin: sunucu yetkiyi bunlardan okur.
      const sira = ['firma', 'kullanici', 'uyelik'];
      const tablolar = [...this.veriTablolari()];
      const oncelik = (ad: string) => (sira.includes(ad) ? sira.indexOf(ad) : sira.length);
      tablolar.sort((a, b) => oncelik(a.name) - oncelik(b.name));
      for (const t of tablolar) {
        const idler = (await t.toCollection().primaryKeys()) as string[];
        await this.tablo('bekleyen').bulkPut(idler.map((id) => ({ anahtar: anahtar(t.name, id), tablo: t.name, id, sayac: this.sayac() })));
        sayi += idler.length;
      }
    });
    return sayi;
  }

  async disaridanYaz(kayitlar: DisKayit[], zorla = false): Promise<number> {
    let sayi = 0;
    const b = this.tablo('bekleyen');
    await this.db.transaction('rw', this.db.tables, async () => {
      for (const { tablo, kayit } of kayitlar) {
        const a = anahtar(tablo, kayit.id);
        if (await b.get(a)) {
          if (!zorla) continue;
          await b.delete(a);
        }
        await this.tablo(tablo).put(kayit);
        sayi++;
      }
    });
    return sayi;
  }

  degisinceHaberVer(dinleyici: (() => void) | null): void {
    this.dinleyici = dinleyici;
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

  async metaSil(anahtar: string): Promise<void> {
    await this.tablo('meta').delete(anahtar);
  }

  async metaHepsi(): Promise<Record<string, unknown>> {
    const satirlar = await this.tablo('meta').toArray();
    return Object.fromEntries(satirlar.map((s) => [s.anahtar, s.deger]));
  }

  private veriTablolari(): Table<any, string>[] {
    return this.db.tables.filter((t) => !CIHAZ_TABLOLARI.has(t.name));
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
      // Geri yüklenen veri buluta gönderilecek değişiklik sayılmaz (bulut bağlıyken geri yükleme yapılmaz).
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
