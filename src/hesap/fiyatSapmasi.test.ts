import { describe, expect, it } from 'vitest';
import { fiyatDegisimleri, fiyatGruplari, oranYaz, pahaliAlimlar, type AlimSatiri } from './fiyatSapmasi';

const TL = (n: number) => Math.round(n * 100);
let n = 0;
const alim = (tarih: string, aciklama: string, miktar: number, birim: string, tutar: number, cari = 'Yıldız'): AlimSatiri => ({
  satirId: `s${++n}`,
  giderId: `g${n}`,
  tarih,
  cariId: cari,
  cariAdi: cari,
  projeId: 'p',
  aciklama,
  miktar,
  birim,
  tutar: TL(tutar),
});

describe('alış fiyatları', () => {
  const katalog = [
    { id: 'demir12', ad: 'Nervürlü inşaat demiri Ø12', birim: 'ton' },
    { id: 'cimento', ad: 'Çimento CEM I 42,5', birim: 'torba' },
  ];
  const l = [
    alim('2026-03-01', 'Ø12 nervürlü demir', 10, 'ton', 200_000),
    alim('2026-04-01', '12 lik demir nervürlü', 5_000, 'kg', 105_000, 'Akdeniz'),
    alim('2026-04-20', 'Nervürlü demir Ø12', 4, 'ton', 84_000),
    alim('2026-05-10', 'Nervürlü demir 12', 2, 'ton', 56_000, 'Akdeniz'), // 28.000/ton: pahalı
    alim('2026-06-01', 'Kum (yıkanmış)', 10, 'm3', 5_000),
    alim('2026-06-02', 'kum (yıkanmış)', 5, 'm³', 2_000),
    alim('2026-06-03', 'Elektrik malzemesi', 0, '', 1_000),
  ];

  it('katalog kalemine gruplar, kg → ton çevirir; değişim, tedarikçi, sapma', () => {
    const g = fiyatGruplari(l, katalog);
    const demir = g.find((x) => x.katalogId === 'demir12')!;
    expect(demir.alimlar.map((a) => [a.fiyat / 100, a.grupMiktari])).toEqual([
      [20_000, 10],
      [21_000, 5],
      [21_000, 4],
      [28_000, 2],
    ]);
    expect(demir.degisim).toBeCloseTo(0.4);
    expect(demir.tedarikciler.map((t) => [t.ad, t.ortalama / 100])).toEqual([
      ['Yıldız', 20_285.71],
      ['Akdeniz', 23_000],
    ]);
    const son = demir.alimlar[3]!;
    expect([son.ortanca! / 100, son.fazla / 100]).toEqual([21_000, 14_000]);
    expect(demir.fazla).toBe(TL(14_000));

    const kum = g.find((x) => x.ad.startsWith('Kum'))!;
    expect([kum.birim, kum.alimlar.length, kum.katalogId]).toEqual(['m³', 2, null]);
    expect(g).toHaveLength(2);

    const d = fiyatDegisimleri(g);
    expect(d.artanlar.map((x) => x.katalogId)).toEqual(['demir12']);
    // Kum: iki alım arası 1 gün, değişime girmez.
    expect(d.azalanlar).toEqual([]);
    expect(pahaliAlimlar(g).map((x) => x.alim.fiyat)).toEqual([TL(28_000)]);
    expect([oranYaz(0.4), oranYaz(-0.125)]).toEqual(['+%40', '−%12,5']);
  });
});
