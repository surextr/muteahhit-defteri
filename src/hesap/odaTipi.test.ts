import { describe, expect, it } from 'vitest';
import { odaTipiMetniCoz, odaTipiOku, odaTipiSecenekleri } from './odaTipi';

describe('oda tipi', () => {
  it('okuma', () => {
    expect(odaTipiOku('3+1')).toEqual({ oda: 3, salon: 1 });
    expect(odaTipiOku(' 4 + 2 ')).toEqual({ oda: 4, salon: 2 });
    expect(odaTipiOku('0+1')).toBeNull();
    expect(odaTipiOku('3')).toBeNull();
  });

  it('seçenekler: en çok kullanılan başta, gizli çıkmaz (seçili hariç), eklenen sonda', () => {
    const ayar = { eklenen: ['4+2'], gizli: ['5+1', '1+0'] };
    const kullanim = new Map([
      ['3+1', 10],
      ['2+1', 4],
      ['4+2', 4],
    ]);
    expect(odaTipiSecenekleri(ayar, kullanim)).toEqual(['3+1', '2+1', '4+2', '1+1', '4+1']);
    expect(odaTipiSecenekleri(ayar, kullanim, '5+1')).toContain('5+1');
    expect(odaTipiSecenekleri({ eklenen: [], gizli: [] }, new Map(), '6+2')).toContain('6+2');
  });

  it('eski serbest yazıyı çözer', () => {
    expect(odaTipiMetniCoz('3+1')).toEqual({ odaSayisi: 3, salonSayisi: 1, dubleks: null, kalan: null });
    expect(odaTipiMetniCoz('4 + 1 Dubleks')).toEqual({ odaSayisi: 4, salonSayisi: 1, dubleks: 'cati', kalan: null });
    expect(odaTipiMetniCoz('Bahçe dubleksi 3+1')).toMatchObject({ odaSayisi: 3, dubleks: 'bahce', kalan: null });
    expect(odaTipiMetniCoz('Stüdyo')).toMatchObject({ odaSayisi: 1, salonSayisi: 0 });
    expect(odaTipiMetniCoz('2+1 geniş')).toMatchObject({ odaSayisi: 2, kalan: 'geniş' });
    expect(odaTipiMetniCoz('Penthouse')).toEqual({ odaSayisi: null, salonSayisi: null, dubleks: null, kalan: 'Penthouse' });
    expect(odaTipiMetniCoz(null).odaSayisi).toBeNull();
  });
});
