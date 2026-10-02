import { describe, expect, it } from 'vitest';
import { arsaPaylari, type PayBolumu } from './arsaPayi';

const b = (id: string, brutM2: number | null, netM2: number | null = null, tip: PayBolumu['tip'] = 'daire'): PayBolumu => ({
  id,
  tip,
  brutM2,
  netM2,
});
const sahipler = [
  { cariId: 'ahmet', hisse: 50 },
  { cariId: 'ayse', hisse: 50 },
];

describe('arsaPaylari', () => {
  const bolumler = [b('1', 100, 80), b('2', 120, 95), b('3', 130, 100), b('4', 150, 120)];
  const tahsis = new Map([
    ['1', 'ahmet'],
    ['3', 'ayse'],
  ]);

  it('brüt m²: beklenen = toplam × arsa payı × hisse', () => {
    const p = arsaPaylari(bolumler, tahsis, 45, sahipler, 'brut');
    expect(p.toplam).toBe(500);
    expect(p.sahipler.map((s) => s.beklenen)).toEqual([112.5, 112.5]);
    expect(p.sahipler[0]).toMatchObject({ cariId: 'ahmet', daire: 1, dukkan: 0, brutM2: 100, netM2: 80 });
    expect(p.sahipler[1]).toMatchObject({ cariId: 'ayse', daire: 1, brutM2: 130 });
    expect(p.muteahhit).toEqual({ daire: 2, dukkan: 0, brutM2: 270, netM2: 215 });
    expect(p.eksikAlan).toBe(0);
  });

  it('net m² ve bölüm sayısı', () => {
    expect(arsaPaylari(bolumler, tahsis, 40, sahipler, 'net').sahipler[0]!.beklenen).toBe(79);
    const adet = arsaPaylari(bolumler, tahsis, 50, [{ cariId: 'ahmet', hisse: 100 }], 'adet');
    expect(adet.toplam).toBe(4);
    expect(adet.sahipler[0]!.beklenen).toBe(2);
  });

  it('bölüm sayısında konut ve dükkan ayrı sayılır, beklenen türe göre ayrı', () => {
    const karisik = [b('1', 100), b('2', 100), b('3', 100), b('4', 100), b('D1', 60, null, 'dukkan'), b('O1', 80, null, 'ofis')];
    const p = arsaPaylari(karisik, new Map([['1', 'ahmet'], ['D1', 'ahmet']]), 50, sahipler, 'adet');
    expect(p.sahipler[0]).toMatchObject({ daire: 1, dukkan: 1, beklenen: 1.5, beklenenDaire: 1, beklenenDukkan: 0.5 });
    expect(p.muteahhit).toMatchObject({ daire: 3, dukkan: 1 });
  });

  it("m²'si girilmemiş bölüm toplama girmez, ayrıca sayılır", () => {
    const p = arsaPaylari([b('1', 100), b('2', null)], new Map(), 50, sahipler, 'brut');
    expect(p.toplam).toBe(100);
    expect(p.eksikAlan).toBe(1);
    expect(arsaPaylari([b('1', 100), b('2', null)], new Map(), 50, sahipler, 'adet').eksikAlan).toBe(0);
  });

  it('listede olmayan sahibe tahsis müteahhitte sayılır', () => {
    const p = arsaPaylari([b('1', 100)], new Map([['1', 'baskasi']]), 50, sahipler, 'brut');
    expect(p.muteahhit.daire).toBe(1);
  });
});
