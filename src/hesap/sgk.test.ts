import { describe, expect, it } from 'vitest';
import { donemAdi, donemKaydir, sgkHatalari, sgkOzeti } from './sgk';

const k = (isciAdi: string, gun: number, prim: number, odeyen: 'muteahhit' | 'taseron' = 'taseron', hakediseDahil = false, iptal: unknown = null) => ({
  isciAdi,
  gun,
  prim,
  odeyen,
  hakediseDahil,
  iptal: iptal as null,
});

describe('SGK', () => {
  it('özet: kişi tekil, gün ve prim toplam; müteahhidin ödediği ve hakedişe dahil olmayan prim maliyet', () => {
    expect(sgkOzeti([k('Ali', 20, 1000), k('ali', 5, 200), k('Veli', 30, 1500, 'muteahhit'), k('Can', 30, 1500, 'muteahhit', true), k('X', 30, 9, 'taseron', false, {})])).toEqual({
      kisi: 3,
      gun: 85,
      prim: 4200,
      muteahhitPrimi: 1500,
    });
  });

  it('dönem adı ve kaydırma', () => {
    expect(donemAdi('2026-11')).toBe('Kasım 2026');
    expect(donemKaydir('2026-01', -1)).toBe('2025-12');
    expect(donemKaydir('2026-12', 1)).toBe('2027-01');
  });

  it('denetim', () => {
    const g = { sozlesmeId: null, donem: '2026-11', isciAdi: 'Ali', girisTarihi: '2026-11-10', cikisTarihi: '2026-11-01', gun: 32, prim: 0, odeyen: 'taseron' as const, hakediseDahil: true };
    expect(sgkHatalari(g)).toEqual(['Gün sayısı 0 ile 31 arasında olmalı.', 'Çıkış tarihi girişten önce olamaz.', 'Taşeronun ödediği prim hakedişe dahil edilmez.']);
  });
});
