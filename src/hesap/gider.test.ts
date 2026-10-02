import { describe, expect, it } from 'vitest';
import { giderToplamlari, satirHesapla, tevkifatGecerli } from './gider';

const TL = (n: number) => Math.round(n * 100);

describe('gider satırı', () => {
  it('KDV hariç girilen tutara KDV eklenir', () => {
    expect(satirHesapla({ tutar: TL(100_000), kdvDahil: false, kdvOrani: 20, tevkifat: null })).toEqual({
      kdvHaricTutar: TL(100_000),
      kdvTutari: TL(20_000),
      tevkifatTutari: 0,
      toplam: TL(120_000),
      odenecek: TL(120_000),
    });
  });

  it('KDV dahil girilen tutar ayrıştırılır', () => {
    expect(satirHesapla({ tutar: TL(120_000), kdvDahil: true, kdvOrani: 20, tevkifat: null })).toMatchObject({
      kdvHaricTutar: TL(100_000),
      kdvTutari: TL(20_000),
      toplam: TL(120_000),
    });
  });

  it('4/10 tevkifat: KDV ayrı görünür, satıcıya ödenecek tevkifat düşülmüş tutardır', () => {
    // 100.000 + %20 KDV 20.000; tevkif 8.000 → satıcıya 112.000
    expect(satirHesapla({ tutar: TL(100_000), kdvDahil: false, kdvOrani: 20, tevkifat: { pay: 4, payda: 10 } })).toEqual({
      kdvHaricTutar: TL(100_000),
      kdvTutari: TL(20_000),
      tevkifatTutari: TL(8_000),
      toplam: TL(120_000),
      odenecek: TL(112_000),
    });
  });

  it('yuvarlama satır bazındadır; toplam satırların toplamı', () => {
    const a = satirHesapla({ tutar: 333, kdvDahil: false, kdvOrani: 20, tevkifat: { pay: 9, payda: 10 } });
    expect(a).toMatchObject({ kdvTutari: 67, tevkifatTutari: 60, toplam: 400, odenecek: 340 });
    const t = giderToplamlari([a, a]);
    expect(t).toEqual({ kdvHaricToplam: 666, kdvToplam: 134, tevkifatToplam: 120, toplam: 800, odenecek: 680 });
  });

  it('tevkifat oranı denetimi', () => {
    expect(tevkifatGecerli(null)).toBe(true);
    expect(tevkifatGecerli({ pay: 4, payda: 10 })).toBe(true);
    expect(tevkifatGecerli({ pay: 11, payda: 10 })).toBe(false);
    expect(tevkifatGecerli({ pay: 0, payda: 10 })).toBe(false);
  });
});
