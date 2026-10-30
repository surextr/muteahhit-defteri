import { describe, expect, it } from 'vitest';
import type { TabloAdi } from '../veri/tipler';
import { rolYetkileri, TABLO_YETKILERI, tabloyaYazabilir, YETKILER } from './yetki';

// Yeni tablo eklenip yetkiler.json'a yazılmazsa derleme ya da test hata verir.
const TUM_TABLOLAR: Record<TabloAdi, true> = {
  firma: true,
  kullanici: true,
  uyelik: true,
  islemGecmisi: true,
  ayarDegeri: true,
  proje: true,
  projeOrtagi: true,
  blok: true,
  kat: true,
  bagimsizBolum: true,
  ortakAlan: true,
  takipBasligi: true,
  kalem: true,
  kalemIlerlemesi: true,
  projeFotografi: true,
  fiyatKalemi: true,
  maliyetHesabi: true,
  kredi: true,
  santiyeGunlugu: true,
  malzemeTalebi: true,
  malzemeHareketi: true,
  cari: true,
  acilisBakiyesi: true,
  hesap: true,
  gider: true,
  giderSatiri: true,
  odeme: true,
  eslestirme: true,
  transfer: true,
  cekSenet: true,
  cekHareketi: true,
  belge: true,
  belgeDosyasi: true,
  belgeHavuzu: true,
  ustaTipi: true,
  ustaSozlesmesi: true,
  sozlesmeDegisikligi: true,
  hakedis: true,
  odemePlani: true,
  katKarsiligiSozlesme: true,
  arsaSahibiTahsisi: true,
  sgkKaydi: true,
  teminatIadesi: true,
  satis: true,
  taksit: true,
  arsaSahibiOdemesi: true,
  ilaveImalat: true,
  alacak: true,
};

describe('rol yetkileri', () => {
  it('her tablonun yazma kuralı var; geçen yetkiler tanımlı', () => {
    expect(Object.keys(TABLO_YETKILERI).sort()).toEqual(Object.keys(TUM_TABLOLAR).sort());
    const kodlar = new Set(YETKILER.map((y) => y.kod));
    for (const g of Object.values(TABLO_YETKILERI)) if (Array.isArray(g)) for (const y of g) expect(kodlar.has(y)).toBe(true);
  });

  it('yönetici her şeyi; şantiye varsayılanla gider girer, kasa/proje yazamaz; ayar varsayılanı değiştirir', () => {
    expect(tabloyaYazabilir({}, 'yonetici', 'firma')).toBe(true);
    expect(tabloyaYazabilir({}, 'santiye', 'gider')).toBe(true);
    expect(tabloyaYazabilir({}, 'santiye', 'odeme')).toBe(true);
    expect(tabloyaYazabilir({}, 'santiye', 'transfer')).toBe(false);
    expect(tabloyaYazabilir({}, 'santiye', 'proje')).toBe(false);
    expect(tabloyaYazabilir({}, 'muhasebe', 'uyelik')).toBe(false);
    expect(tabloyaYazabilir({}, 'muhasebe', 'islemGecmisi')).toBe(true);
    const ayar = { rolYetkileri: { santiye: ['proje'] } };
    expect(tabloyaYazabilir(ayar, 'santiye', 'proje')).toBe(true);
    expect(tabloyaYazabilir(ayar, 'santiye', 'gider')).toBe(false);
    expect([...rolYetkileri(ayar, 'muhasebe')]).toContain('kasa');
  });
});
