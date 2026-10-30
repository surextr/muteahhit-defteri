import { describe, expect, it } from 'vitest';
import { alanEtiketi, farklar, GENEL_BICIM, genelDeger } from './GecmisListesi';

describe('geçmiş farkları', () => {
  it('nesne dizisi öge öge: eklenen parsel, değişen maliyet satırı, [object Object] yok', () => {
    const f = farklar({ parseller: [] }, { parseller: [{ ada: '101', parsel: '5', alanM2: 500 }] });
    expect(f).toEqual([['parseller[101/5]', null, 'eklendi']]);
    expect(alanEtiketi(GENEL_BICIM, f[0]![0])).toBe('Parsel › 101/5');

    const satir = (id: string, ad: string, ozelFiyat: number | null) => ({ id, ad, miktar: 360, ozelFiyat, dondurulan: null });
    const g = farklar(
      { satirlar: [satir('1', 'Beton', null), satir('2', 'Demir', null), satir('3', 'Kum', null)] },
      { satirlar: [satir('1', 'Beton', 100000), satir('2', 'Demir', null), satir('4', 'Vinç', null)] },
    );
    expect(g).toEqual([
      ['satirlar[Beton].ozelFiyat', null, 100000],
      ['satirlar[Vinç]', null, 'eklendi'],
      ['satirlar[Kum]', 'vardı', 'çıkarıldı'],
    ]);
    expect(alanEtiketi(GENEL_BICIM, g[0]![0])).toBe('Satır › Beton › Özel fiyat');
    expect(GENEL_BICIM.degerYaz!(g[0]![0], 100000)).toBe('₺1.000,00');
    expect(g.map(([, e, y]) => genelDeger(e) + genelDeger(y)).join()).not.toContain('object');
  });

  it('kimliksiz, adı tekrarlayan dizi sırayla eşlenir; düz nesne genelDeger adını yazar', () => {
    expect(farklar({ l: [{ ad: 'a', x: 1 }, { ad: 'a', x: 2 }] }, { l: [{ ad: 'a', x: 1 }, { ad: 'a', x: 3 }] })).toEqual([['l[2. a].x', 2, 3]]);
    expect(genelDeger({ ad: 'Salon', alan: 3 })).toBe('Salon');
    expect(farklar({ etiket: ['x'] }, { etiket: ['x', 'y'] })).toEqual([['etiket', ['x'], ['x', 'y']]]);
  });
});
