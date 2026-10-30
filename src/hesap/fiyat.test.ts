import { describe, expect, it } from 'vitest';
import { adBenzer, arastirmaYanitiniDenetle, birimAnahtari, birimCarpani, fiyatDurumu, fiyatEskiMi, sonAlis, sonSozlesme, type AlisSatiri } from './fiyat';

const satir = (s: Partial<AlisSatiri>): AlisSatiri => ({
  tarih: '2026-09-01',
  aciklama: 'Hazır beton C30',
  birim: 'm3',
  birimFiyat: 320000,
  miktar: 10,
  kdvHaricTutar: 3200000,
  cariAdi: 'Akdeniz Beton',
  ...s,
});

describe('fiyat kataloğu hesapları', () => {
  it('fiyat eskiliği 90 günden sonra', () => {
    expect(fiyatEskiMi('2026-08-01', '2026-10-30')).toBe(false);
    expect(fiyatEskiMi('2026-07-31', '2026-10-30')).toBe(true);
    expect(fiyatEskiMi(null, '2026-10-30')).toBe(false);
    expect(fiyatDurumu({ fiyat: null, fiyatTarihi: null }, '2026-10-30')).toBe('yok');
    expect(fiyatDurumu({ fiyat: 100, fiyatTarihi: '2026-01-01' }, '2026-10-30')).toBe('eski');
    expect(fiyatDurumu({ fiyat: 100, fiyatTarihi: '2026-10-01' }, '2026-10-30')).toBe('guncel');
  });

  it('birimleri birleştirir, kg↔ton çevirir', () => {
    expect(birimAnahtari('M3')).toBe('m³');
    expect(birimAnahtari('m³')).toBe('m³');
    expect(birimAnahtari('Ad.')).toBe('adet');
    expect(birimAnahtari('mt')).toBe('metre');
    expect(birimCarpani('kg', 'ton')).toBe(1000);
    expect(birimCarpani('ton', 'kg')).toBe(0.001);
    expect(birimCarpani('m²', 'm³')).toBeNull();
  });

  it('ad benzerliği Türkçe harfsiz yazımla da', () => {
    expect(adBenzer('Hazır beton C30/37', 'C30 BETON 25 m3')).toBe(true);
    expect(adBenzer('Hazır beton C30/37', 'C25 beton')).toBe(false);
    expect(adBenzer('Nervürlü demir Ø12', 'nervurlu demir 12 mm')).toBe(true);
    expect(adBenzer('Yatay delikli tuğla 13,5 cm', 'Tugla yatay delikli 13,5')).toBe(true);
  });

  it('son alış: en yeni uyan satır, birim çevrilir, birim fiyat yoksa tutar/miktar', () => {
    const k = { ad: 'Hazır beton C30/37', birim: 'm³' };
    expect(sonAlis(k, [satir({}), satir({ tarih: '2026-10-01', birimFiyat: 340000 }), satir({ tarih: '2026-10-20', aciklama: 'C25 beton', birimFiyat: 1 })])).toEqual({
      kaynak: 'sonAlis',
      tarih: '2026-10-01',
      fiyat: 340000,
      aciklama: 'Hazır beton C30 · Akdeniz Beton',
    });
    const demir = sonAlis({ ad: 'Nervürlü demir Ø12', birim: 'ton' }, [satir({ aciklama: 'Demir Ø12', birim: 'kg', birimFiyat: null, miktar: 1000, kdvHaricTutar: 2500000, cariAdi: null })]);
    expect(demir?.fiyat).toBe(2500000);
    expect(sonAlis(k, [satir({ birim: 'adet' })])).toBeNull();
  });

  it('son sözleşme: aynı usta tipi, kalem adı ve birim', () => {
    const k = { ad: 'Sıvacı · Kaba sıva', birim: 'm²', ustaTipiKodu: 'sivaci' };
    const liste = [
      { tarih: '2026-03-01', ustaTipiKodu: 'sivaci', ad: 'Kaba sıva', birim: 'm2', birimFiyat: 15000, cariAdi: 'Ali' },
      { tarih: '2026-06-01', ustaTipiKodu: 'sivaci', ad: 'kaba siva', birim: 'm²', birimFiyat: 18000, cariAdi: 'Veli' },
      { tarih: '2026-09-01', ustaTipiKodu: 'boyaci', ad: 'Kaba sıva', birim: 'm²', birimFiyat: 1, cariAdi: 'X' },
    ];
    expect(sonSozlesme(k, liste)).toEqual({ kaynak: 'sonSozlesme', tarih: '2026-06-01', fiyat: 18000, aciklama: 'Veli sözleşmesi' });
  });

  it('araştırma yanıtını denetler', () => {
    const r = arastirmaYanitiniDenetle(
      {
        sonuclar: [
          { id: 'a', en_dusuk: 3500, en_yuksek: 3000, onerilen: 9999, birim_notu: 'KDV hariç, Antalya', kaynaklar: [{ baslik: 'X', url: 'https://x.com/a', fiyat: 3200 }, { baslik: 'kötü', url: 'javascript:alert(1)' }] },
          { id: 'bilinmeyen', en_dusuk: 1 },
          { id: 'b', en_dusuk: 'çok', onerilen: -5 },
        ],
      },
      ['a', 'b'],
      '2026-10-30',
    );
    expect(r.get('a')).toEqual({ tarih: '2026-10-30', enDusuk: 300000, enYuksek: 350000, onerilen: 350000, not: 'KDV hariç, Antalya', kaynaklar: [{ baslik: 'X', url: 'https://x.com/a', fiyat: 320000 }] });
    expect(r.get('b')).toEqual({ tarih: '2026-10-30', enDusuk: null, enYuksek: null, onerilen: null, not: '', kaynaklar: [] });
    expect(r.has('bilinmeyen')).toBe(false);
    expect(arastirmaYanitiniDenetle(null, ['a'], '2026-10-30').size).toBe(0);
  });
});
