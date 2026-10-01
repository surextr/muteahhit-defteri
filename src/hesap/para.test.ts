import { describe, expect, it } from 'vitest';
import { dovizdenTl, kdvAyir, kdvEkle, tlOku, tlYaz } from './para';

describe('tlOku', () => {
  it.each([
    ['100.000', 10_000_000],
    ['100000', 10_000_000],
    ['1.250,5', 125_050],
    ['1250,50', 125_050],
    ['₺ 70.000,00', 7_000_000],
    ['70.000 TL', 7_000_000],
    ['-500', -50_000],
    ['0,05', 5],
  ])('%s → %i kuruş', (metin, beklenen) => {
    expect(tlOku(metin)).toBe(beklenen);
  });

  it.each(['', 'abc', '1,234', '12.34', '1.2345', '1,2,3'])('geçersiz: "%s"', (metin) => {
    expect(tlOku(metin)).toBeNull();
  });
});

describe('tlYaz', () => {
  it('Türkçe biçimde yazar', () => {
    // Boşluk karakteri ortama göre değişebildiği için rakamlara bakıyoruz.
    expect(tlYaz(10_000_000).replace(/\s/g, '')).toBe('₺100.000,00');
  });
});

describe('KDV', () => {
  it('KDV hariçten ekler', () => {
    expect(kdvEkle(10_000_000, 20)).toEqual({ kdvHaric: 10_000_000, kdv: 2_000_000, toplam: 12_000_000 });
  });

  it('KDV dahilden ayırır; toplam her zaman korunur', () => {
    expect(kdvAyir(12_000_000, 20)).toEqual({ kdvHaric: 10_000_000, kdv: 2_000_000, toplam: 12_000_000 });
    const r = kdvAyir(1_001, 20);
    expect(r.kdvHaric + r.kdv).toBe(1_001);
  });
});

it('dövizden TL kuruşa yuvarlar', () => {
  expect(dovizdenTl(100_00, 41.2345)).toBe(4_123_45);
});
