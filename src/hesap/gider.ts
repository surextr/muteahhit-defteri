import type { Kurus, Tevkifat } from '../veri/tipler';
import { kdvAyir, kdvEkle } from './para';

// Gider satırı ve fatura toplamları. Veritabanını bilmez.

export const KDV_ORANLARI = [0, 1, 10, 20] as const;

/** Sık kullanılan KDV tevkifat oranları (inşaatta: yapım işleri 4/10, işgücü 9/10…). */
export const TEVKIFAT_ORANLARI: Tevkifat[] = [2, 3, 4, 5, 7, 9].map((pay) => ({ pay, payda: 10 }));

export const tevkifatYaz = (t: Tevkifat) => `${t.pay}/${t.payda}`;

export interface SatirGirdisi {
  /** Kullanıcının yazdığı tutar; `kdvDahil` ise fatura satır toplamıdır. */
  tutar: Kurus;
  kdvDahil: boolean;
  kdvOrani: number;
  tevkifat: Tevkifat | null;
}

export interface SatirTutarlari {
  kdvHaricTutar: Kurus;
  kdvTutari: Kurus;
  tevkifatTutari: Kurus;
  /** KDV hariç + KDV. */
  toplam: Kurus;
  /** Satıcıya ödenecek: toplam − tevkifat. */
  odenecek: Kurus;
}

/** KDV ve tevkifat satır bazında hesaplanıp kuruşa yuvarlanır; fatura toplamı satırların toplamıdır. */
export function satirHesapla(g: SatirGirdisi): SatirTutarlari {
  const { kdvHaric, kdv, toplam } = g.kdvDahil ? kdvAyir(g.tutar, g.kdvOrani) : kdvEkle(g.tutar, g.kdvOrani);
  const tevkifatTutari = g.tevkifat ? Math.round((kdv * g.tevkifat.pay) / g.tevkifat.payda) : 0;
  return { kdvHaricTutar: kdvHaric, kdvTutari: kdv, tevkifatTutari, toplam, odenecek: toplam - tevkifatTutari };
}

export interface GiderToplamlari {
  kdvHaricToplam: Kurus;
  kdvToplam: Kurus;
  tevkifatToplam: Kurus;
  toplam: Kurus;
  odenecek: Kurus;
}

export function giderToplamlari(
  satirlar: Pick<SatirTutarlari, 'kdvHaricTutar' | 'kdvTutari' | 'tevkifatTutari' | 'toplam'>[],
): GiderToplamlari {
  const t = { kdvHaricToplam: 0, kdvToplam: 0, tevkifatToplam: 0, toplam: 0 };
  for (const s of satirlar) {
    t.kdvHaricToplam += s.kdvHaricTutar;
    t.kdvToplam += s.kdvTutari;
    t.tevkifatToplam += s.tevkifatTutari;
    t.toplam += s.toplam;
  }
  return { ...t, odenecek: t.toplam - t.tevkifatToplam };
}

export function tevkifatGecerli(t: Tevkifat | null): boolean {
  return t === null || (Number.isInteger(t.pay) && Number.isInteger(t.payda) && t.payda > 0 && t.pay > 0 && t.pay <= t.payda);
}
