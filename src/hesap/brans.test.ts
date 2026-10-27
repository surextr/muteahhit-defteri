import { describe, expect, it } from 'vitest';
import { bransAdlari, bransKisaAdi, bransOzeti } from './brans';

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
