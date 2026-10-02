import { telBicim } from '../hesap/bicim';
import type { Firma, FirmaAyarlari, FirmaBilgileri } from '../veri/tipler';
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

export interface FirmaBilgiGirdisi {
  ad: string;
  bilgiler: FirmaBilgileri;
}

const EPOSTA = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Firma adı ve iletişim/vergi bilgileri (PDF başlıklarında kullanılır). Değişiklik geçmişe yazılır. */
export async function firmaBilgileriniDegistir(
  servis: KayitServisi,
  firma: Firma,
  girdi: FirmaBilgiGirdisi,
  gerekce?: string,
): Promise<Firma> {
  if (firma.id !== servis.oturum.firmaId) throw new IsKuraliHatasi('Firma bulunamadı.');
  const b = Object.fromEntries(Object.entries(girdi.bilgiler).map(([k, v]) => [k, v.trim()])) as unknown as FirmaBilgileri;
  b.telefon = telBicim(b.telefon);
  b.vergiNo = b.vergiNo.replace(/\s/g, '');
  b.eposta = b.eposta.toLowerCase();
  const ad = girdi.ad.trim().replace(/\s+/g, ' ');
  const hatalar: string[] = [];
  if (!ad) hatalar.push('Firma adı boş olamaz.');
  if (b.eposta && !EPOSTA.test(b.eposta)) hatalar.push('E-posta adresi geçerli görünmüyor.');
  if (b.vergiNo && !/^\d{10,11}$/.test(b.vergiNo)) hatalar.push('Vergi no 10 haneli, TC kimlik no 11 haneli olmalı.');
  if (b.telefon && b.telefon.replace(/\D/g, '').length < 10) hatalar.push('Telefon numarası eksik görünüyor.');
  if (hatalar.length > 0) throw new IsKuraliHatasi(hatalar.join(' '));
  return servis.guncelle('firma', firma.id, { ad, bilgiler: b }, gerekce);
}

/** Logo (data URL) ya da null (kaldır). Çok büyük resim reddedilir; küçültme cihazda yapılır. */
export async function firmaLogosunuDegistir(servis: KayitServisi, firma: Firma, logo: string | null, gerekce?: string): Promise<Firma> {
  if (firma.id !== servis.oturum.firmaId) throw new IsKuraliHatasi('Firma bulunamadı.');
  if (logo !== null && !/^data:image\/(png|jpeg|svg\+xml);/.test(logo)) throw new IsKuraliHatasi('Logo PNG, JPG ya da SVG olmalı.');
  if (logo !== null && logo.length > 1_500_000) throw new IsKuraliHatasi('Logo dosyası çok büyük; daha küçük bir resim seçin.');
  return servis.guncelle('firma', firma.id, { logo }, gerekce);
}
