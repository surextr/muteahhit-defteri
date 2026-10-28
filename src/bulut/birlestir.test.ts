import { describe, expect, it } from 'vitest';
import { birlestir } from './birlestir';

describe('üç yollu birleştirme', () => {
  const taban = { id: 'c', ad: 'Beton AŞ', telefon: null, not: '', surum: 2, guncellemeZamani: 't2', guncelleyen: 'a', iptal: null };
  it('bu cihazın değiştirdiği alan kalır, diğerleri sunucudan; sürüm sunucunun bir fazlası', () => {
    const benim = { ...taban, not: 'benim notum', surum: 3, guncellemeZamani: 't3a' };
    const onlarin = { ...taban, telefon: '0532', surum: 3, guncellemeZamani: 't3b', guncelleyen: 'b' };
    expect(birlestir(taban, benim, onlarin, 't4')).toEqual({
      ...taban,
      not: 'benim notum',
      telefon: '0532',
      surum: 4,
      guncellemeZamani: 't4',
      guncelleyen: 'a',
    });
  });
  it('ikisi aynı alanı değiştirdiyse bu cihazınki; iptal korunur; taban yoksa bu cihazın hâli', () => {
    const benim = { ...taban, ad: 'A', surum: 3 };
    const onlarin = { ...taban, ad: 'B', iptal: { zaman: 'z' }, surum: 5 };
    expect(birlestir(taban, benim, onlarin, 't')).toMatchObject({ ad: 'A', iptal: { zaman: 'z' }, surum: 6 });
    expect(birlestir(null, { id: 'x', ad: 'A', surum: 1 }, { id: 'x', ad: 'B', yalniz: 1, surum: 1 }, 't')).toMatchObject({ ad: 'A', yalniz: 1, surum: 2 });
  });
});
