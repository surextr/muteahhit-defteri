import { describe, expect, it } from 'vitest';
import { otomatikDagit } from './eslestirme';

describe('otomatik dağıtım', () => {
  const borclar = [
    { id: 'yeni', sira: '2026-10-20', kalan: 500 },
    { id: 'eski', sira: '2026-09-01', kalan: 300 },
  ];

  it('en eski vadeden başlar; kısmi kapatır', () => {
    expect(otomatikDagit(400, borclar)).toEqual({ dagitim: new Map([['eski', 300], ['yeni', 100]]), avans: 0 });
  });

  it('borçtan fazlası avans kalır', () => {
    expect(otomatikDagit(1_000, borclar)).toEqual({ dagitim: new Map([['eski', 300], ['yeni', 500]]), avans: 200 });
  });

  it('borç yoksa hepsi avans', () => {
    expect(otomatikDagit(250, [])).toEqual({ dagitim: new Map(), avans: 250 });
  });
});
