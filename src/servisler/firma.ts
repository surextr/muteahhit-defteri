import type { Firma, FirmaAyarlari } from '../veri/tipler';
import { IsKuraliHatasi, type KayitServisi } from './kayitServisi';

/**
 * Firma ayarını değiştirir; eski/yeni değer işlem geçmişine yazılır.
 *
 * kdvMaliyeteDahil tarihli saklanmaz: KDV her gider satırında oranıyla ayrı durur,
 * bu ayar yalnızca raporda maliyetin nasıl gösterileceğidir. Değişince bütün dönemler
 * aynı biçimde gösterilir (bir kısmı dahil, bir kısmı hariç karışık rapor olmaz).
 */
export async function firmaAyariDegistir(
  servis: KayitServisi,
  firma: Firma,
  degisiklik: Partial<FirmaAyarlari>,
  gerekce?: string,
): Promise<Firma> {
  if (firma.id !== servis.oturum.firmaId) throw new IsKuraliHatasi('Firma bulunamadı.');
  return servis.guncelle('firma', firma.id, { ayarlar: { ...firma.ayarlar, ...degisiklik } }, gerekce);
}
