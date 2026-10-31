import type { Kurus, Tarih } from '../veri/tipler';
import { beyanSonGunu } from './tevkifat';

// KDV beyannamesi tahmini (saf): ay ay hesaplanan KDV (satışlar) − indirilecek KDV (alışlar) − devreden. Ödenecek çıkarsa
// izleyen ayın 28'inde ödenir. Son günü geçmiş dönemler ödenmiş (ya da devretmiş) sayılır: yalnız devreden KDV'yi
// bugüne taşımak için hesaplanır. Tahmindir; beyanname yerine geçmez.

export interface KdvHareketi {
  tarih: Tarih;
  kdv: Kurus;
}

export interface KdvDonemi {
  donem: string;
  sonGun: Tarih;
  hesaplanan: Kurus;
  indirilecek: Kurus;
  /** Dönem başında devreden. */
  devredenOnce: Kurus;
  odenecek: Kurus;
  devredenSonra: Kurus;
}

export interface KdvTakvimi {
  /** Son günü geçmiş son dönemden sonra devreden KDV (bugünkü durum). */
  devreden: Kurus;
  /** Son günü bugün ya da sonra olan dönemler, `bit`e kadar. */
  donemler: KdvDonemi[];
}

export function kdvTakvimi(hesaplanan: KdvHareketi[], indirilecek: KdvHareketi[], bugun: Tarih, bit: Tarih): KdvTakvimi {
  const aylar = new Map<string, { h: Kurus; i: Kurus }>();
  const ekle = (l: KdvHareketi[], alan: 'h' | 'i') => {
    for (const x of l) {
      const d = x.tarih.slice(0, 7);
      const a = aylar.get(d) ?? { h: 0, i: 0 };
      a[alan] += x.kdv;
      aylar.set(d, a);
    }
  };
  ekle(hesaplanan, 'h');
  ekle(indirilecek, 'i');
  // Ufuktaki ve bugünkü dönemler veri olmasa da sıraya girsin (devreden taşınır).
  for (let d = bugun.slice(0, 7); beyanSonGunu(d) <= bit; d = beyanSonGunu(d).slice(0, 7)) if (!aylar.has(d)) aylar.set(d, { h: 0, i: 0 });
  const onceki = (() => {
    const [y, a] = bugun.slice(0, 7).split('-').map(Number) as [number, number];
    return a === 1 ? `${y - 1}-12` : `${y}-${String(a - 1).padStart(2, '0')}`;
  })();
  if (!aylar.has(onceki)) aylar.set(onceki, { h: 0, i: 0 });

  let devreden = 0;
  let bugunkuDevreden = 0;
  const donemler: KdvDonemi[] = [];
  for (const [donem, a] of [...aylar].sort(([x], [y]) => x.localeCompare(y))) {
    const sonGun = beyanSonGunu(donem);
    if (sonGun > bit) break;
    const net = a.h - a.i - devreden;
    const d: KdvDonemi = { donem, sonGun, hesaplanan: a.h, indirilecek: a.i, devredenOnce: devreden, odenecek: Math.max(0, net), devredenSonra: Math.max(0, -net) };
    devreden = d.devredenSonra;
    if (sonGun < bugun) bugunkuDevreden = devreden;
    else donemler.push(d);
  }
  return { devreden: bugunkuDevreden, donemler };
}

/** "Ekim 2026" */
export const donemAdi = (donem: string): string => new Date(`${donem}-01T00:00:00`).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
