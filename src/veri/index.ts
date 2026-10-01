import type { Depo } from './depo';
import { DexieDepo } from './indexeddb/dexieDepo';

export const VERITABANI_ADI = 'muteahhit-defteri';

/**
 * Uygulamanın kullanacağı depoyu açar. Mobil uygulamaya geçişte
 * yalnızca burası SQLite deposunu döndürecek şekilde değişir.
 */
export async function veriKatmaniniAc(veritabaniAdi: string = VERITABANI_ADI): Promise<Depo> {
  const depo = new DexieDepo(veritabaniAdi);
  await depo.ac();
  return depo;
}
