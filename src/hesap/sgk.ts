import type { Kurus, SgkKaydi } from '../veri/tipler';

// SGK takibi: hangi ustanın kaç işçisi, kaç gün bildirildi, prim ne kadar, kim ödüyor. Saf fonksiyonlar.
// Müteahhidin ödediği ve hakedişe dahil olmayan prim maliyettir (gider olarak ayrıca girilir).

export const DONEM = /^\d{4}-(0[1-9]|1[0-2])$/;

/** "2026-11" → "Kasım 2026". */
export function donemAdi(donem: string): string {
  const [y, a] = donem.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, a - 1, 1)).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** Bir önceki ya da sonraki ay. */
export function donemKaydir(donem: string, ay: number): string {
  const [y, a] = donem.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, a - 1 + ay, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export interface SgkOzeti {
  kisi: number;
  gun: number;
  prim: Kurus;
  /** Müteahhidin ödediği, hakedişe dahil olmayan prim (maliyete girer). */
  muteahhitPrimi: Kurus;
}

export function sgkOzeti(kayitlar: Pick<SgkKaydi, 'iptal' | 'isciAdi' | 'gun' | 'prim' | 'odeyen' | 'hakediseDahil'>[]): SgkOzeti {
  const aktif = kayitlar.filter((k) => k.iptal === null);
  return {
    kisi: new Set(aktif.map((k) => k.isciAdi.trim().toLocaleLowerCase('tr-TR'))).size,
    gun: aktif.reduce((t, k) => t + k.gun, 0),
    prim: aktif.reduce((t, k) => t + k.prim, 0),
    muteahhitPrimi: aktif.filter((k) => k.odeyen === 'muteahhit' && !k.hakediseDahil).reduce((t, k) => t + k.prim, 0),
  };
}

export interface SgkGirdisi {
  sozlesmeId: string | null;
  donem: string;
  isciAdi: string;
  girisTarihi: string | null;
  cikisTarihi: string | null;
  gun: number;
  prim: Kurus;
  odeyen: 'muteahhit' | 'taseron';
  hakediseDahil: boolean;
}

export function sgkHatalari(g: SgkGirdisi): string[] {
  const h: string[] = [];
  if (!DONEM.test(g.donem)) h.push('Dönemi (ay) seçin.');
  if (!g.isciAdi.trim()) h.push('İşçinin adını yazın.');
  if (!Number.isInteger(g.gun) || g.gun < 0 || g.gun > 31) h.push('Gün sayısı 0 ile 31 arasında olmalı.');
  if (!Number.isInteger(g.prim) || g.prim < 0) h.push('Prim tutarı geçersiz.');
  if (g.girisTarihi && g.cikisTarihi && g.cikisTarihi < g.girisTarihi) h.push('Çıkış tarihi girişten önce olamaz.');
  if (g.odeyen === 'taseron' && g.hakediseDahil) h.push('Taşeronun ödediği prim hakedişe dahil edilmez.');
  return h;
}
