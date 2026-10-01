import Dexie, { type Table } from 'dexie';
import { ARSIV_SINIRI, type ArsivKaydi, type ArsivOzeti, type YedekArsivi } from '../yedekArsivi';

/** Otomatik yedekler için ayrı bir IndexedDB veritabanı. */
export class DexieYedekArsivi implements YedekArsivi {
  private readonly db: Dexie;
  private readonly yedek: Table<ArsivKaydi, string>;

  constructor(veritabaniAdi: string) {
    this.db = new Dexie(veritabaniAdi);
    this.db.version(1).stores({ yedek: 'id, zaman' });
    this.yedek = this.db.table('yedek');
  }

  async ac(): Promise<void> {
    await this.db.open();
  }

  async kaydet(kayit: ArsivKaydi): Promise<void> {
    await this.db.transaction('rw', this.yedek, async () => {
      await this.yedek.add(kayit);
      const fazlalar = await this.yedek.orderBy('zaman').reverse().offset(ARSIV_SINIRI).primaryKeys();
      await this.yedek.bulkDelete(fazlalar);
    });
  }

  async listele(): Promise<ArsivOzeti[]> {
    const kayitlar = await this.yedek.orderBy('zaman').reverse().toArray();
    return kayitlar.map(({ icerik: _icerik, ...ozet }) => ozet);
  }

  getir(id: string): Promise<ArsivKaydi | undefined> {
    return this.yedek.get(id);
  }

  kapat(): void {
    this.db.close();
  }
}
