import { describe, expect, it } from 'vitest';
import type { AyarDegeri, Gider, GiderSatiri, Kalem } from '../veri/tipler';
import { gecerliAyarDegeri } from './ayar';
import { butceKarsilastir, kalemGerceklesen } from './butce';

const Z = '2026-10-01T09:00:00.000Z';
const ortak = (id: string) => ({
  id,
  firmaId: 'f',
  olusturan: 'u',
  olusturmaZamani: Z,
  guncelleyen: 'u',
  guncellemeZamani: Z,
  surum: 1,
  iptal: null,
});

describe('tarihli ayar değerleri', () => {
  const ayar = (id: string, baslangic: string, deger: number): AyarDegeri => ({
    ...ortak(id),
    anahtar: 'asgariUcret',
    deger,
    gecerlilikBaslangici: baslangic,
    kaynak: 'test',
  });
  const ayarlar = [ayar('a1', '2026-01-01', 100), ayar('a2', '2026-07-01', 130)];

  it('kaydın tarihindeki değeri verir; yeni değer eski kaydı etkilemez', () => {
    expect(gecerliAyarDegeri(ayarlar, 'asgariUcret', '2026-03-15')?.deger).toBe(100);
    expect(gecerliAyarDegeri(ayarlar, 'asgariUcret', '2026-07-01')?.deger).toBe(130);
    expect(gecerliAyarDegeri(ayarlar, 'asgariUcret', '2025-12-31')).toBeUndefined();
  });

  it('iptal edilen değer kullanılmaz', () => {
    const iptalli = [...ayarlar, { ...ayar('a3', '2026-08-01', 999), iptal: { zaman: Z, kullaniciId: 'u', gerekce: 'x' } }];
    expect(gecerliAyarDegeri(iptalli, 'asgariUcret', '2026-09-01')?.deger).toBe(130);
  });
});

describe('kalem bütçesi', () => {
  const gider = (id: string, iptal = false): Gider => ({
    ...ortak(id),
    iptal: iptal ? { zaman: Z, kullaniciId: 'u', gerekce: 'x' } : null,
    tarih: '2026-10-01',
    projeId: 'p',
    cariId: null,
    faturaNo: null,
    vadeTarihi: null,
    aciklama: '',
    kdvHaricToplam: 0,
    kdvToplam: 0,
    toplam: 0,
    tevkifatToplam: 0,
    paraBirimi: 'TRY',
    kur: null,
  });
  const satir = (id: string, giderId: string, kalemId: string, kdvHaric: number): GiderSatiri => ({
    ...ortak(id),
    giderId,
    kalemId,
    aciklama: '',
    miktar: null,
    birim: null,
    birimFiyat: null,
    kdvHaricTutar: kdvHaric,
    kdvOrani: 20,
    kdvTutari: kdvHaric / 5,
    tevkifat: null,
    tevkifatTutari: 0,
    toplam: (kdvHaric * 6) / 5,
  });
  const kalem = (id: string, butce: number | null, sira: number): Kalem => ({
    ...ortak(id),
    projeId: 'p',
    ustKalemId: null,
    ad: id,
    birim: null,
    butceMiktari: null,
    butceTutari: butce,
    sira,
  });

  const giderler = [gider('g1'), gider('g2', true)];
  const satirlar = [satir('s1', 'g1', 'beton', 1000), satir('s2', 'g1', 'beton', 500), satir('s3', 'g2', 'beton', 9999)];

  it('iptal edilen gider sayılmaz; KDV ayarına göre toplar', () => {
    expect(kalemGerceklesen(satirlar, giderler, false).get('beton')).toBe(1500);
    expect(kalemGerceklesen(satirlar, giderler, true).get('beton')).toBe(1800);
  });

  it('bütçe ile karşılaştırır; eksi kalan bütçe aşımıdır', () => {
    const sonuc = butceKarsilastir([kalem('demir', null, 2), kalem('beton', 1000, 1)], kalemGerceklesen(satirlar, giderler, false));
    expect(sonuc.map((s) => [s.kalem.id, s.gerceklesen, s.kalan])).toEqual([
      ['beton', 1500, -500],
      ['demir', 0, null],
    ]);
  });
});
