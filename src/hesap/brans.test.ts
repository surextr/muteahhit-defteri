import { describe, expect, it } from 'vitest';
import { addanBransOner, bransAdlari, bransKisaAdi, bransOzeti } from './brans';

const tipler = new Map([
  ['k', 'Kalıpçı (demir işçiliği dahil)'],
  ['s', 'Sıvacı'],
  ['f', 'Seramikçi / fayansçı'],
]);

describe('branş', () => {
  it('kısa ad parantezli açıklamayı atar', () => {
    expect(bransKisaAdi('Kalıpçı (demir işçiliği dahil)')).toBe('Kalıpçı');
    expect(bransKisaAdi('Seramikçi / fayansçı')).toBe('Seramikçi / fayansçı');
    expect(bransKisaAdi('(özel)')).toBe('(özel)');
  });

  it('adlar sırayla gelir, bilinmeyen tip atlanır', () => {
    expect(bransAdlari(['s', 'yok', 'k'], tipler)).toEqual(['Sıvacı', 'Kalıpçı']);
  });

  it('özet: taşeronda başa "Taşeron" yazılır, branş yoksa null', () => {
    expect(bransOzeti({ roller: ['usta'], ustaTipiIdleri: ['k'] }, tipler)).toBe('Kalıpçı');
    expect(bransOzeti({ roller: ['usta', 'taseron'], ustaTipiIdleri: ['s', 'f'] }, tipler)).toBe('Taşeron · Sıvacı, Seramikçi / fayansçı');
    expect(bransOzeti({ roller: ['usta'], ustaTipiIdleri: [] }, tipler)).toBeNull();
  });
});

describe('addan branş önerisi', () => {
  const TIPLER = [
    { id: 'duvar', ad: 'Duvarcı', sistemKodu: 'duvarci' },
    { id: 'kalip', ad: 'Kalıpçı (demir işçiliği dahil)', sistemKodu: 'kalipci' },
    { id: 'siva', ad: 'Sıvacı', sistemKodu: 'sivaci' },
    { id: 'boya', ad: 'Boyacı', sistemKodu: 'boyaci' },
    { id: 'peyzaj', ad: 'Peyzajcı', sistemKodu: null },
  ];
  const oner = (ad: string) => addanBransOner(ad, TIPLER);

  it('sondaki, parantezdeki ve baştaki meslek ayrılır; usta sözcüğü de atılır', () => {
    expect(oner('Ahmet Demir Tuğlası')).toEqual({ yeniAd: 'Ahmet Demir', ustaTipiId: 'duvar', bulunan: 'Tuğlası' });
    expect(oner('Ali Yılmaz (kalıpçı)')).toEqual({ yeniAd: 'Ali Yılmaz', ustaTipiId: 'kalip', bulunan: 'kalıpçı' });
    expect(oner('Mehmet Kaya sıva ustası')).toEqual({ yeniAd: 'Mehmet Kaya', ustaTipiId: 'siva', bulunan: 'sıva ustası' });
    expect(oner('Sıvacı Mehmet')).toEqual({ yeniAd: 'Mehmet', ustaTipiId: 'siva', bulunan: 'Sıvacı' });
    expect(oner('Hasan PEYZAJCI')?.ustaTipiId).toBe('peyzaj');
  });

  it('eşleşme yoksa ya da tek sözcükse öneri yok', () => {
    expect(oner('Ahmet Demir')).toBeNull();
    expect(oner('Sıvacı')).toBeNull();
    expect(oner('Beton A.Ş.')).toBeNull();
  });
});
