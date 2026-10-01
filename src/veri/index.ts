import type { Depo, GecistenOnce } from './depo';
import { DexieDepo } from './indexeddb/dexieDepo';
import { DexieYedekArsivi } from './indexeddb/dexieYedekArsivi';
import type { YedekArsivi } from './yedekArsivi';

export const VERITABANI_ADI = 'muteahhit-defteri';

/**
 * Uygulamanın kullanacağı depoyu açar. Mobil uygulamaya geçişte
 * yalnızca burası SQLite deposunu döndürecek şekilde değişir.
 * gecistenOnce: veritabanı yapısı güncellenecekse önce eski veriyi yedeklemek için.
 */
export async function veriKatmaniniAc(
  veritabaniAdi: string = VERITABANI_ADI,
  gecistenOnce?: GecistenOnce,
): Promise<Depo> {
  const depo = new DexieDepo(veritabaniAdi, gecistenOnce);
  await depo.ac();
  return depo;
}

export async function yedekArsiviniAc(veritabaniAdi: string = VERITABANI_ADI): Promise<YedekArsivi> {
  const arsiv = new DexieYedekArsivi(`${veritabaniAdi}-yedekler`);
  await arsiv.ac();
  return arsiv;
}
