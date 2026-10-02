import type { Eslestirme, Gider, GiderSatiri, Kurus, Tarih, Tevkifat } from '../veri/tipler';
import { tevkifatKalan } from './bakiye';

// Alıcı olarak tevkif ettiğimiz KDV: fatura tarihinin ayında beyan edilir (KDV 2),
// beyan ve ödeme izleyen ayın 28'ine kadar. Veritabanını bilmez.

const aktif = (k: { iptal: unknown }): boolean => k.iptal === null;

/** 'YYYY-AA' */
export const tevkifatDonemi = (tarih: Tarih): string => tarih.slice(0, 7);

/** Dönemin beyan ve ödeme son günü: izleyen ayın 28'i. */
export function beyanSonGunu(donem: string): Tarih {
  const [yil, ay] = donem.split('-').map(Number) as [number, number];
  const sonraki = ay === 12 ? { yil: yil + 1, ay: 1 } : { yil, ay: ay + 1 };
  return `${sonraki.yil}-${String(sonraki.ay).padStart(2, '0')}-28`;
}

/** Beyannamede oran oran yazılır: aynı KDV ve tevkifat oranlı satırlar toplanır. */
export interface TevkifatOranToplami {
  kdvOrani: number;
  tevkifat: Tevkifat;
  /** KDV hariç tutar. */
  matrah: Kurus;
  kdv: Kurus;
  tevkifatTutari: Kurus;
}

export interface TevkifatFaturasi {
  gider: Gider;
  /** Yalnızca tevkifatlı satırların toplamları. */
  matrah: Kurus;
  kdv: Kurus;
  tevkifatTutari: Kurus;
  /** Vergi dairesine henüz ödenmemiş kısım. */
  kalan: Kurus;
}

export interface TevkifatDonemOzeti {
  donem: string;
  sonGun: Tarih;
  oranlar: TevkifatOranToplami[];
  faturalar: TevkifatFaturasi[];
  toplam: Kurus;
  odenen: Kurus;
  kalan: Kurus;
}

/** Aylık beyan edilecek tevkifat; en yeni dönem önce. İptal kayıtlar girmez. */
export function tevkifatDonemleri(giderler: Gider[], satirlar: GiderSatiri[], eslestirmeler: Eslestirme[]): TevkifatDonemOzeti[] {
  const satirlarGidere = new Map<string, GiderSatiri[]>();
  for (const s of satirlar) {
    if (!aktif(s) || s.tevkifatTutari <= 0 || !s.tevkifat) continue;
    satirlarGidere.set(s.giderId, [...(satirlarGidere.get(s.giderId) ?? []), s]);
  }

  const donemler = new Map<string, TevkifatDonemOzeti>();
  for (const gider of giderler) {
    if (!aktif(gider) || gider.tevkifatToplam <= 0) continue;
    const donem = tevkifatDonemi(gider.tarih);
    let d = donemler.get(donem);
    if (!d) {
      d = { donem, sonGun: beyanSonGunu(donem), oranlar: [], faturalar: [], toplam: 0, odenen: 0, kalan: 0 };
      donemler.set(donem, d);
    }
    const fatura: TevkifatFaturasi = { gider, matrah: 0, kdv: 0, tevkifatTutari: gider.tevkifatToplam, kalan: tevkifatKalan(gider, eslestirmeler) };
    for (const s of satirlarGidere.get(gider.id) ?? []) {
      fatura.matrah += s.kdvHaricTutar;
      fatura.kdv += s.kdvTutari;
      let o = d.oranlar.find((x) => x.kdvOrani === s.kdvOrani && x.tevkifat.pay === s.tevkifat!.pay && x.tevkifat.payda === s.tevkifat!.payda);
      if (!o) {
        o = { kdvOrani: s.kdvOrani, tevkifat: s.tevkifat!, matrah: 0, kdv: 0, tevkifatTutari: 0 };
        d.oranlar.push(o);
      }
      o.matrah += s.kdvHaricTutar;
      o.kdv += s.kdvTutari;
      o.tevkifatTutari += s.tevkifatTutari;
    }
    d.faturalar.push(fatura);
    d.toplam += fatura.tevkifatTutari;
    d.kalan += fatura.kalan;
    d.odenen += fatura.tevkifatTutari - fatura.kalan;
  }

  return [...donemler.values()]
    .sort((a, b) => b.donem.localeCompare(a.donem))
    .map((d) => ({
      ...d,
      faturalar: d.faturalar.sort((a, b) => a.gider.tarih.localeCompare(b.gider.tarih) || a.gider.olusturmaZamani.localeCompare(b.gider.olusturmaZamani)),
      oranlar: d.oranlar.sort((a, b) => b.kdvOrani - a.kdvOrani || b.tevkifat.pay / b.tevkifat.payda - a.tevkifat.pay / a.tevkifat.payda),
    }));
}
