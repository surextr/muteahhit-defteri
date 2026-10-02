import { describe, expect, it } from 'vitest';
import { adresVerisi, ilceler, iller, mahalleler, tamAdres, VARSAYILAN_IL } from './adres';

describe('Türkiye adres verisi', () => {
  it('81 il; varsayılan il listede; ilçe ve mahalle sıralı gelir', async () => {
    const v = await adresVerisi();
    expect(iller(v)).toHaveLength(81);
    expect(iller(v)[0]).toBe('Adana');
    expect(iller(v)).toContain(VARSAYILAN_IL);
    const antalya = ilceler(v, 'Antalya');
    expect(antalya).toContain('Konyaaltı');
    expect(antalya).toEqual([...antalya].sort((a, b) => a.localeCompare(b, 'tr')));
    expect(mahalleler(v, 'Antalya', 'Konyaaltı').length).toBeGreaterThan(10);
    expect(ilceler(v, null)).toEqual([]);
    expect(mahalleler(v, 'Antalya', null)).toEqual([]);
  });

  it('tam adres boş parçaları atlar', () => {
    expect(tamAdres({ il: 'Antalya', ilce: 'Konyaaltı', mahalle: 'Liman', adres: ' Atatürk Cad. 5 ' })).toBe(
      'Atatürk Cad. 5, Liman, Konyaaltı / Antalya',
    );
    expect(tamAdres({ il: null, ilce: null, mahalle: null, adres: '' })).toBe('');
  });
});
