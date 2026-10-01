import type { Kurus } from '../veri/tipler';

const tlBicimi = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' });

/** 10000000 → "₺100.000,00" */
export function tlYaz(tutar: Kurus): string {
  return tlBicimi.format(tutar / 100);
}

/**
 * Kullanıcının yazdığı tutarı kuruşa çevirir. Türkçe yazım: nokta binlik, virgül kuruş.
 * "100.000" → 10000000, "1250,5" → 125050. Geçersizse null.
 */
export function tlOku(metin: string): Kurus | null {
  const temiz = metin.replace(/₺|TL|\s/gi, '');
  if (!/^-?(\d{1,3}(\.\d{3})+|\d+)(,\d{1,2})?$/.test(temiz)) return null;
  const negatif = temiz.startsWith('-');
  const [tam = '', kurus = ''] = temiz.replace('-', '').split(',');
  const sonuc = Number(tam.replace(/\./g, '')) * 100 + Number(kurus.padEnd(2, '0'));
  return negatif ? -sonuc : sonuc;
}

export interface KdvliTutar {
  kdvHaric: Kurus;
  kdv: Kurus;
  toplam: Kurus;
}

/** KDV hariç tutardan: 100.000 TL, %20 → 20.000 KDV, 120.000 toplam. */
export function kdvEkle(kdvHaric: Kurus, oran: number): KdvliTutar {
  const kdv = Math.round((kdvHaric * oran) / 100);
  return { kdvHaric, kdv, toplam: kdvHaric + kdv };
}

/** KDV dahil tutardan: 120.000 TL, %20 → 100.000 + 20.000. Kuruş farkı KDV'de kalır. */
export function kdvAyir(toplam: Kurus, oran: number): KdvliTutar {
  const kdvHaric = Math.round((toplam * 100) / (100 + oran));
  return { kdvHaric, kdv: toplam - kdvHaric, toplam };
}

export function dovizdenTl(dovizTutari: Kurus, kur: number): Kurus {
  return Math.round(dovizTutari * kur);
}

export function topla(tutarlar: Iterable<Kurus>): Kurus {
  let toplam = 0;
  for (const t of tutarlar) toplam += t;
  return toplam;
}
