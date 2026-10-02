import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { veriKatmaniniAc } from '../veri';
import type { Depo } from '../veri/depo';
import { yeniId } from '../veri/kimlik';
import type { Cari, Hesap, Kalem, Proje } from '../veri/tipler';
import { cariOlustur, carileriListele } from './cari';
import {
  MukerrerFaturaUyarisi,
  giderDetayiGetir,
  giderGuncelle,
  giderIptal,
  giderOlustur,
  giderleriListele,
  type GiderGirdisi,
  type SatirFormGirdisi,
} from './gider';
import { hesapOlustur, hesaplariListele } from './hesap';
import { kalemEkle, projeButcesiGetir } from './kalem';
import { KayitServisi, type Oturum } from './kayitServisi';
import { ilkKurulum } from './kurulum';
import { BOS_BLOK, projeOlustur } from './proje';

const TL = (n: number) => Math.round(n * 100);
const BUGUN = '2026-10-02';

let depo: Depo;
let oturum: Oturum;
let servis: KayitServisi;
let proje: Proje;
let tedarikci: Cari;
let kasa: Hesap;
let kart: Hesap;
let beton: Kalem;
let kaba: Kalem;

beforeEach(async () => {
  depo = await veriKatmaniniAc(`test-${yeniId()}`);
  oturum = await ilkKurulum(depo, { firmaAdi: 'Firma', kullaniciAdi: 'Yönetici' });
  servis = new KayitServisi(depo, oturum);
  proje = await projeOlustur(
    depo,
    servis,
    {
      ad: 'Gül',
      il: null,
      ilce: null,
      mahalle: null,
      adres: '',
      ada: '',
      parsel: '',
      arsaTipi: 'kat_karsiligi',
      baslangicTarihi: null,
      alanlar: { arsa: null, net: null, brut: null, toplamInsaat: null, satilabilir: null },
    },
    [BOS_BLOK],
  );
  tedarikci = await cariOlustur(depo, servis, { ad: 'Beton AŞ', roller: ['tedarikci'], telefon: null, vergiNo: null, adres: null, not: '' });
  kasa = await hesapOlustur(depo, servis, { ad: 'Kasa', tur: 'kasa', paraBirimi: 'TRY', banka: null, iban: null }, { tutar: TL(500_000), tarih: '2026-10-01' });
  kart = await hesapOlustur(depo, servis, { ad: 'Kart', tur: 'kredi_karti', paraBirimi: 'TRY', banka: null, iban: null });
  kaba = await kalemEkle(depo, servis, proje.id, null, { ad: 'Kaba', birim: null, butceMiktari: null, butceTutari: null });
  beton = await kalemEkle(depo, servis, proje.id, kaba.id, { ad: 'Beton', birim: 'm³', butceMiktari: null, butceTutari: TL(200_000) });
});
afterEach(() => depo.kapat());

const satir = (ek: Partial<SatirFormGirdisi> = {}): SatirFormGirdisi => ({
  kalemId: beton.id,
  aciklama: '',
  miktar: null,
  birim: null,
  tutar: TL(100_000),
  kdvDahil: false,
  kdvOrani: 20,
  tevkifat: null,
  ...ek,
});
const girdi = (ek: Partial<GiderGirdisi> = {}): GiderGirdisi => ({
  tarih: '2026-10-01',
  projeId: proje.id,
  cariId: tedarikci.id,
  faturaNo: null,
  vadeTarihi: null,
  aciklama: '',
  satirlar: [satir()],
  ...ek,
});
const cariBakiye = async () => (await carileriListele(depo, oturum.firmaId)).find((c) => c.cari.id === tedarikci.id)!.bakiye;
const hesapBakiye = async (h: Hesap) => (await hesaplariListele(depo, oturum.firmaId)).find((o) => o.hesap.id === h.id)!.bakiye;
const detay = async (id: string) => (await giderDetayiGetir(depo, oturum.firmaId, id, BUGUN))!;

describe('gider girişi', () => {
  it('veresiye alış: maliyet ve cari borcu oluşur; bütçeye gerçekleşen yazılır', async () => {
    const g = await giderOlustur(depo, servis, girdi({ satirlar: [satir({ miktar: 40, birim: 'm³' })] }));
    expect(g).toMatchObject({ kdvHaricToplam: TL(100_000), kdvToplam: TL(20_000), toplam: TL(120_000), tevkifatToplam: 0, paraBirimi: 'TRY' });
    const d = await detay(g.id);
    expect(d.satirlar[0]).toMatchObject({ kalemAdi: 'Kaba › Beton', birimFiyat: TL(2_500), miktar: 40 });
    expect(d).toMatchObject({ borc: TL(120_000), kalan: TL(120_000) });
    expect(await cariBakiye()).toBe(TL(120_000));
    const butce = await projeButcesiGetir(depo, oturum.firmaId, proje.id, true);
    expect(butce.dugumler[0]!.altlar[0]).toMatchObject({ gerceklesen: TL(120_000), kalan: TL(80_000) });
  });

  it('tevkifatlı fatura: tevkifat ayrı görünür, borç tevkifat düşülmüş tutar, maliyet tam tutar', async () => {
    const g = await giderOlustur(depo, servis, girdi({ satirlar: [satir({ tevkifat: { pay: 4, payda: 10 } })] }));
    expect(g).toMatchObject({ toplam: TL(120_000), tevkifatToplam: TL(8_000) });
    expect(await detay(g.id)).toMatchObject({ borc: TL(112_000), kalan: TL(112_000) });
    expect(await cariBakiye()).toBe(TL(112_000));
    expect((await projeButcesiGetir(depo, oturum.firmaId, proje.id, true)).gerceklesen).toBe(TL(120_000));
  });

  it('peşin ödeme: kasadan düşer, gider kapanır, cari bakiyesi sıfır', async () => {
    const g = await giderOlustur(depo, servis, girdi(), { hesapId: kasa.id, tutar: TL(120_000) });
    expect(await hesapBakiye(kasa)).toBe(TL(380_000));
    expect(await detay(g.id)).toMatchObject({ kalan: 0 });
    expect((await detay(g.id)).odemeler[0]).toMatchObject({ hesapAdi: 'Kasa', odeme: { yontem: 'nakit', tutar: TL(120_000) } });
    expect(await cariBakiye()).toBe(0);
  });

  it('kısmi ödeme ve kartla ödeme: kart eksiye düşer, kalan borç kalır', async () => {
    const g = await giderOlustur(depo, servis, girdi(), { hesapId: kart.id, tutar: TL(20_000) });
    expect(await hesapBakiye(kart)).toBe(-TL(20_000));
    expect((await detay(g.id)).odemeler[0]!.odeme.yontem).toBe('kart');
    expect(await detay(g.id)).toMatchObject({ kalan: TL(100_000) });
  });

  it('carisiz gider tamamen peşin olmalı', async () => {
    await expect(giderOlustur(depo, servis, girdi({ cariId: null }))).rejects.toThrow('peşin ödenmiş');
    await expect(giderOlustur(depo, servis, girdi({ cariId: null }), { hesapId: kasa.id, tutar: TL(1) })).rejects.toThrow('peşin');
    await giderOlustur(depo, servis, girdi({ cariId: null }), { hesapId: kasa.id, tutar: TL(120_000) });
  });

  it.each([
    ['tarih yok', () => girdi({ tarih: '' }), 'tarihini'],
    ['satır yok', () => girdi({ satirlar: [] }), 'En az bir satır'],
    ['sıfır tutar', () => girdi({ satirlar: [satir({ tutar: 0 })] }), 'sıfırdan büyük'],
    ['vade önce', () => girdi({ vadeTarihi: '2026-09-01' }), 'Vade'],
    ['KDV\'siz tevkifat', () => girdi({ satirlar: [satir({ kdvOrani: 0, tevkifat: { pay: 4, payda: 10 } })] }), 'tevkifat olmaz'],
    ['ana kalem', () => girdi({ satirlar: [satir({ kalemId: 'x' })] }), 'kalem bu projede yok'],
    ['projesiz kalem', () => girdi({ projeId: null }), 'önce proje'],
  ])('hatalı girdi: %s', async (_ad, g, mesaj) => {
    await expect(giderOlustur(depo, servis, g())).rejects.toThrow(mesaj);
    expect(await depo.listele('gider')).toEqual([]);
  });

  it('ana kaleme gider yazılamaz', async () => {
    await expect(giderOlustur(depo, servis, girdi({ satirlar: [satir({ kalemId: kaba.id })] }))).rejects.toThrow('ana kalem');
  });

  it('ödenen tutar fatura tutarını aşamaz; hata olursa hiçbir şey yazılmaz', async () => {
    await expect(giderOlustur(depo, servis, girdi(), { hesapId: kasa.id, tutar: TL(130_000) })).rejects.toThrow('büyük olamaz');
    expect(await depo.listele('gider')).toEqual([]);
    expect(await depo.listele('odeme')).toEqual([]);
  });

  it('aynı cariden aynı fatura no uyarı verir; onayla girilir', async () => {
    const ilk = await giderOlustur(depo, servis, girdi({ faturaNo: 'ABC-12' }));
    const hata = await giderOlustur(depo, servis, girdi({ faturaNo: 'abc-12' })).catch((e: unknown) => e);
    expect(hata).toBeInstanceOf(MukerrerFaturaUyarisi);
    expect((hata as MukerrerFaturaUyarisi).mevcut.id).toBe(ilk.id);
    await giderOlustur(depo, servis, girdi({ faturaNo: 'abc-12' }), null, { mukerrerOnayli: true });
    // Fatura numarası yoksa uyarı yok.
    await giderOlustur(depo, servis, girdi());
  });
});

describe('gider düzenleme ve iptal', () => {
  it('satır güncellenir, eklenir, çıkarılır; geçmiş yazılır', async () => {
    const g = await giderOlustur(depo, servis, girdi({ satirlar: [satir(), satir({ tutar: TL(10_000) })] }));
    const [s1] = (await detay(g.id)).satirlar;
    const guncel = await giderGuncelle(
      depo,
      servis,
      g.id,
      girdi({ satirlar: [satir({ id: s1!.id, tutar: TL(90_000) }), satir({ kalemId: null, tutar: TL(5_000), kdvOrani: 10 })] }),
    );
    expect(guncel).toMatchObject({ kdvHaricToplam: TL(95_000), kdvToplam: TL(18_500), toplam: TL(113_500) });
    const satirlar = (await detay(g.id)).satirlar;
    expect(satirlar.map((s) => [s.id === s1!.id, s.kdvHaricTutar])).toEqual([
      [true, TL(90_000)],
      [false, TL(5_000)],
    ]);
    expect((await depo.listele('giderSatiri', { giderId: g.id })).filter((s) => s.iptal).length).toBe(1);
    expect((await depo.listele('islemGecmisi', { kayitId: g.id })).some((x) => x.islem === 'guncelle')).toBe(true);
  });

  it('ödenmiş tutarın altına inilmez; ödemeli giderin carisi değişmez', async () => {
    const g = await giderOlustur(depo, servis, girdi(), { hesapId: kasa.id, tutar: TL(100_000) });
    await expect(giderGuncelle(depo, servis, g.id, girdi({ satirlar: [satir({ tutar: TL(50_000) })] }))).rejects.toThrow('ödeme yeni tutardan fazla');
    const baska = await cariOlustur(depo, servis, { ad: 'Diğer', roller: ['tedarikci'], telefon: null, vergiNo: null, adres: null, not: '' });
    await expect(giderGuncelle(depo, servis, g.id, girdi({ cariId: baska.id }))).rejects.toThrow('carisi değiştirilemez');
  });

  it('iptal: maliyet ve borç kalkar; ödeme avans kalır ya da istenirse iptal olur', async () => {
    const g1 = await giderOlustur(depo, servis, girdi(), { hesapId: kasa.id, tutar: TL(20_000) });
    await giderIptal(depo, servis, g1.id);
    expect((await projeButcesiGetir(depo, oturum.firmaId, proje.id, true)).gerceklesen).toBe(0);
    // Ödeme duruyor: cariye 20.000 avans verilmiş (alacağımız).
    expect(await cariBakiye()).toBe(-TL(20_000));
    expect(await hesapBakiye(kasa)).toBe(TL(480_000));

    const g2 = await giderOlustur(depo, servis, girdi(), { hesapId: kasa.id, tutar: TL(20_000) });
    await giderIptal(depo, servis, g2.id, undefined, true);
    expect(await hesapBakiye(kasa)).toBe(TL(480_000));
    expect(await cariBakiye()).toBe(-TL(20_000));
  });

  it('carisiz giderin iptali ödemesini de iptal eder', async () => {
    const g = await giderOlustur(depo, servis, girdi({ cariId: null }), { hesapId: kasa.id, tutar: TL(120_000) });
    await giderIptal(depo, servis, g.id);
    expect(await hesapBakiye(kasa)).toBe(TL(500_000));
  });

  it('listede ödenmemiş ve vadesi geçmiş süzülür', async () => {
    await giderOlustur(depo, servis, girdi({ vadeTarihi: '2026-10-01' }));
    await giderOlustur(depo, servis, girdi({ cariId: null }), { hesapId: kasa.id, tutar: TL(120_000) });
    const hepsi = await giderleriListele(depo, oturum.firmaId, { projeId: proje.id }, BUGUN);
    expect(hepsi).toHaveLength(2);
    const odenmemis = await giderleriListele(depo, oturum.firmaId, { yalnizcaOdenmemis: true }, BUGUN);
    expect(odenmemis.map((o) => [o.cariAdi, o.kalan, o.vadesiGecti])).toEqual([['Beton AŞ', TL(120_000), true]]);
  });
});
