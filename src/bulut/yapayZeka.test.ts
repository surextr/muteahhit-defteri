import { describe, expect, it } from 'vitest';
import { duzenlemeYanitiniDogrula } from './yapayZeka';

describe('yapay zekâ yanıtı doğrulama', () => {
  it('geçerli yanıt olduğu gibi döner (JSON metni de okunur)', () => {
    const v = { duzenlenmis: '1. Madde', sorular: ['İskele kimde?'], kalanHak: 19 };
    expect(duzenlemeYanitiniDogrula(v)).toEqual(v);
    expect(duzenlemeYanitiniDogrula(JSON.stringify(v))).toEqual(v);
  });

  it.each([
    ['boş', null],
    ['metin yok', { sorular: [], kalanHak: 1 }],
    ['boş metin', { duzenlenmis: ' ', sorular: [], kalanHak: 1 }],
    ['sorular dizi değil', { duzenlenmis: 'x', sorular: 'yok', kalanHak: 1 }],
    ['soru metin değil', { duzenlenmis: 'x', sorular: [1], kalanHak: 1 }],
    ['kalan hak yok', { duzenlenmis: 'x', sorular: [] }],
    ['kalan hak metin', { duzenlenmis: 'x', sorular: [], kalanHak: '3' }],
    ['bozuk JSON', '{duzenlenmis'],
  ])('%s → beklenmeyen yanıt hatası', (_, veri) => {
    expect(() => duzenlemeYanitiniDogrula(veri)).toThrow('Yapay zekâdan beklenmeyen yanıt');
  });
});
