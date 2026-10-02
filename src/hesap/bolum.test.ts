import { describe, expect, it } from 'vitest';
import { bolumNo, cepheKisa, kutucukOzeti } from './bolum';

describe('bölüm gösterimi', () => {
  it('numara blok harfiyle', () => {
    expect(bolumNo('A', '20')).toBe('A-20');
    expect(bolumNo('B', 'D1')).toBe('B-D1');
    expect(bolumNo(null, '20')).toBe('20');
  });

  it('cephe kısaltması; büyük/küçük harf ve eski serbest yazım', () => {
    expect(cepheKisa('Kuzeybatı')).toBe('KB');
    expect(cepheKisa('Doğu, Güney')).toBe('D/G');
    expect(cepheKisa('güney, DOĞU')).toBe('G/D');
    expect(cepheKisa('Deniz')).toBe('Deniz');
    expect(cepheKisa(null)).toBe('');
  });

  it('kutucuk özeti', () => {
    const duz = (m: string) => m.replace(/ /g, ' ');
    expect(duz(kutucukOzeti({ tip: 'daire', odaTipi: '3+1', brutM2: 135.5, cephe: 'Kuzeybatı' }))).toBe('3+1 · 136 m² · KB');
    expect(duz(kutucukOzeti({ tip: 'dukkan', odaTipi: null, brutM2: 60, cephe: null }))).toBe('Dükkan · 60 m²');
    expect(kutucukOzeti({ tip: 'daire', odaTipi: null, brutM2: null, cephe: null })).toBe('');
  });
});
