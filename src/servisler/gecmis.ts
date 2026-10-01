import type { Depo } from '../veri/depo';
import type { IslemGecmisi } from '../veri/tipler';

export interface GecmisSatiri {
  islem: IslemGecmisi;
  kullaniciAdi: string;
}

/** Bir kaydın değişiklik geçmişi, en yenisi önce. */
export async function kayitGecmisiGetir(depo: Depo, firmaId: string, kayitId: string): Promise<GecmisSatiri[]> {
  const islemler = await depo.listele('islemGecmisi', { kayitId, firmaId });
  const adlar = new Map<string, string>();
  for (const id of new Set(islemler.map((i) => i.kullaniciId))) {
    adlar.set(id, (await depo.getir('kullanici', id))?.ad ?? 'Bilinmeyen kullanıcı');
  }
  return islemler
    .sort((a, b) => b.zaman.localeCompare(a.zaman) || b.id.localeCompare(a.id))
    .map((islem) => ({ islem, kullaniciAdi: adlar.get(islem.kullaniciId)! }));
}
