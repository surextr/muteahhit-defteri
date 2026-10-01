import type { Depo } from '../veri/depo';
import type { AcilisBakiyesi, Kurus, Tarih } from '../veri/tipler';
import { IsKuraliHatasi, type KayitServisi } from './kayitServisi';

// Açılış bakiyesi: programa geçmeden önceki durum, cari ya da kasa/banka için ayrı kayıt.
// Bir hedefin en fazla bir geçerli açılış bakiyesi olur.

/**
 * İşaret bakiye hesabıyla aynı:
 * - cari:  artı = borcumuz, eksi = alacağımız (TL)
 * - hesap: artı = hesapta para var (hesabın para biriminde)
 */
export interface AcilisGirdisi {
  tutar: Kurus;
  tarih: Tarih;
}

export type AcilisHedefi = AcilisBakiyesi['hedefTur'];

export function acilisHatalari(a: AcilisGirdisi | null): string[] {
  if (!a) return [];
  const hatalar: string[] = [];
  if (!Number.isInteger(a.tutar)) hatalar.push('Açılış bakiyesi geçerli bir tutar olmalı.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.tarih)) hatalar.push('Açılış bakiyesinin tarihini girin.');
  return hatalar;
}

/** Yeni kayıtla birlikte açılış bakiyesi; sıfır ya da boşsa kayıt açılmaz. Çağıran işlem içinde olmalı. */
export async function acilisEkle(
  servis: KayitServisi,
  hedefTur: AcilisHedefi,
  hedefId: string,
  acilis: AcilisGirdisi | null,
): Promise<void> {
  if (acilis && acilis.tutar !== 0) {
    await servis.ekle('acilisBakiyesi', { hedefTur, hedefId, tarih: acilis.tarih, tutar: acilis.tutar });
  }
}

export async function acilisBakiyesiGetir(
  depo: Depo,
  firmaId: string,
  hedefTur: AcilisHedefi,
  hedefId: string,
): Promise<AcilisBakiyesi | null> {
  const liste = await depo.listele('acilisBakiyesi', { hedefId, firmaId });
  return liste.find((a) => a.iptal === null && a.hedefTur === hedefTur) ?? null;
}

/**
 * Açılış bakiyesini girer, değiştirir ya da (null / 0 ile) iptal eder.
 * Değişiklik ve iptal işlem geçmişine yazılır; gerekçe kuralı geçerlidir.
 */
export async function acilisBakiyesiAyarla(
  depo: Depo,
  servis: KayitServisi,
  hedefTur: AcilisHedefi,
  hedefId: string,
  acilis: AcilisGirdisi | null,
  gerekce?: string,
): Promise<void> {
  const hatalar = acilisHatalari(acilis);
  if (hatalar.length > 0) throw new IsKuraliHatasi(hatalar.join(' '));
  await depo.islem(async () => {
    const mevcut = await acilisBakiyesiGetir(depo, servis.oturum.firmaId, hedefTur, hedefId);
    const sifir = !acilis || acilis.tutar === 0;
    if (mevcut && sifir) await servis.iptal('acilisBakiyesi', mevcut.id, gerekce);
    else if (mevcut && acilis) {
      await servis.guncelle('acilisBakiyesi', mevcut.id, { tutar: acilis.tutar, tarih: acilis.tarih }, gerekce);
    } else await acilisEkle(servis, hedefTur, hedefId, acilis);
  });
}
