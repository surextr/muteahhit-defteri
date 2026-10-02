import { describe, expect, it } from 'vitest';
import { aramaAnahtari, aramaUyar } from './metin';

describe('Türkçe arama', () => {
  it.each([
    ['sahin', 'Şahin Yapı'],
    ['celik', 'Çelik Usta'],
    ['ISIK', 'Işık Hırdavat'],
    ['isik', 'IŞIK HIRDAVAT'],
    ['istanbul', 'İSTANBUL'],
    ['İzmir', 'izmir'],
    ['gul', 'Gül Apartmanı'],
    ['ogretmen', 'Öğretmenler Mah'],
    ['  kum   ocagi ', 'KUM OCAĞI'],
    ['ince seramik', 'İnce inşaat › Seramik ve fayans'],
    ['usta ahmet', 'Ahmet Usta'],
  ])('"%s" → "%s" bulunur', (arama, kaynak) => {
    expect(aramaUyar(kaynak, arama)).toBe(true);
  });

  it('I ile İ karışmaz: "ı" aranınca "i" de bulunur, harfsiz yazım ikisine de uyar', () => {
    expect(aramaAnahtari('IRMAK')).toBe('irmak');
    expect(aramaAnahtari('İnci')).toBe('inci');
    expect(aramaUyar('Demir', 'xyz')).toBe(false);
    expect(aramaUyar('Demir', '')).toBe(true);
  });
});
