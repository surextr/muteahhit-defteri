import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { veriKatmaniniAc } from '../veri';
import type { Depo } from '../veri/depo';
import { yeniId } from '../veri/kimlik';
import type { Proje } from '../veri/tipler';
import {
  HAZIR_KALEMLER,
  hazirKalemleriEkle,
  kalemEkle,
  kalemGuncelle,
  kalemIptal,
  kalemTasi,
  projeButcesiGetir,
  sonKullanilanKalemler,
  type KalemGirdisi,
} from './kalem';
import { KayitServisi, type Oturum } from './kayitServisi';
import { ilkKurulum } from './kurulum';
import { BOS_BLOK, projeOlustur } from './proje';

let depo: Depo;
let oturum: Oturum;
let servis: KayitServisi;
let proje: Proje;

const TL = (n: number) => n * 100;

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
      parseller: [],
      planlananBitis: null,
      gerceklesenBitis: null,
      arsaTipi: 'kat_karsiligi',
      baslangicTarihi: null,
      alanlar: { net: null, brut: null, toplamInsaat: null, satilabilir: null },
    },
    [BOS_BLOK],
  );
});
afterEach(() => depo.kapat());

const girdi = (ad: string, butce: number | null = null, ek: Partial<KalemGirdisi> = {}): KalemGirdisi => ({
  ad,
  birim: null,
  butceMiktari: null,
  butceTutari: butce === null ? null : TL(butce),
  ...ek,
});
const butce = () => projeButcesiGetir(depo, oturum.firmaId, proje.id, true);

/** Kaleme bağlı tek satırlık gider (8. adımın servisi gelene kadar doğrudan yazılır). */
async function giderYaz(kalemId: string, kdvHaric: number) {
  const g = await servis.ekle('gider', {
    tarih: '2026-10-01',
    projeId: proje.id,
    cariId: null,
    faturaNo: null,
    vadeTarihi: null,
    aciklama: '',
    kdvHaricToplam: TL(kdvHaric),
    kdvToplam: TL(kdvHaric / 5),
    toplam: TL(kdvHaric * 1.2),
    tevkifatToplam: 0,
    paraBirimi: 'TRY',
    kur: null,
    tur: 'alis',
    iadeEdilenGiderId: null,
  });
  await servis.ekle('giderSatiri', {
    giderId: g.id,
    kalemId,
    aciklama: '',
    miktar: null,
    birim: null,
    birimFiyat: null,
    kdvHaricTutar: TL(kdvHaric),
    kdvOrani: 20,
    kdvTutari: TL(kdvHaric / 5),
    tevkifat: null,
    tevkifatTutari: 0,
    toplam: TL(kdvHaric * 1.2),
  });
  return g;
}

describe('kalem', () => {
  it('ana ve alt kalem eklenir; bütçe alt kalemlerden toplanır', async () => {
    const kaba = await kalemEkle(depo, servis, proje.id, null, girdi('Kaba inşaat'));
    await kalemEkle(depo, servis, proje.id, kaba.id, girdi(' Beton ', 1_000_000, { birim: 'm³', butceMiktari: 400 }));
    await kalemEkle(depo, servis, proje.id, kaba.id, girdi('Demir', 600_000));
    const ozet = await butce();
    expect(ozet.dugumler[0]).toMatchObject({ butce: TL(1_600_000), gerceklesen: 0 });
    expect(ozet.dugumler[0]!.altlar.map((a) => [a.kalem.ad, a.kalem.sira, a.kalem.birim])).toEqual([
      ['Beton', 1, 'm³'],
      ['Demir', 2, null],
    ]);
  });

  it('gerçekleşen gider satırlarından gelir; KDV ayarına uyar', async () => {
    const kaba = await kalemEkle(depo, servis, proje.id, null, girdi('Kaba'));
    const beton = await kalemEkle(depo, servis, proje.id, kaba.id, girdi('Beton', 1_000));
    await giderYaz(beton.id, 1_000);
    expect((await butce()).dugumler[0]!.altlar[0]).toMatchObject({ gerceklesen: TL(1_200), kalan: -TL(200) });
    expect((await projeButcesiGetir(depo, oturum.firmaId, proje.id, false)).gerceklesen).toBe(TL(1_000));
  });

  it.each([
    [girdi(''), 'boş olamaz'],
    [girdi('X', -5), 'sıfır ya da daha büyük'],
    [girdi('X', null, { butceMiktari: 10 }), 'birimini'],
    [girdi('X', null, { butceMiktari: 0, birim: 'm²' }), 'sıfırdan büyük'],
  ])('hatalı girdi reddedilir: %#', async (g, mesaj) => {
    await expect(kalemEkle(depo, servis, proje.id, null, g)).rejects.toThrow(mesaj);
  });

  it('aynı seviyede aynı ad olmaz; farklı ana kalem altında olabilir', async () => {
    const a = await kalemEkle(depo, servis, proje.id, null, girdi('İnce'));
    const b = await kalemEkle(depo, servis, proje.id, null, girdi('Dış cephe'));
    await kalemEkle(depo, servis, proje.id, a.id, girdi('İskele'));
    await expect(kalemEkle(depo, servis, proje.id, a.id, girdi('iskele'))).rejects.toThrow('zaten var');
    await kalemEkle(depo, servis, proje.id, b.id, girdi('İskele'));
    await expect(kalemEkle(depo, servis, proje.id, null, girdi('ince'))).rejects.toThrow('zaten var');
  });

  it('iki seviyeden derine ve bütçeli/giderli kalemin altına eklenmez', async () => {
    const ana = await kalemEkle(depo, servis, proje.id, null, girdi('Ana'));
    const alt = await kalemEkle(depo, servis, proje.id, ana.id, girdi('Alt'));
    await expect(kalemEkle(depo, servis, proje.id, alt.id, girdi('Torun'))).rejects.toThrow('iki seviyelidir');

    const butceli = await kalemEkle(depo, servis, proje.id, null, girdi('Asansör', 500_000));
    await expect(kalemEkle(depo, servis, proje.id, butceli.id, girdi('Montaj'))).rejects.toThrow('kendi bütçesi var');

    const giderli = await kalemEkle(depo, servis, proje.id, null, girdi('Çevre'));
    await giderYaz(giderli.id, 10);
    await expect(kalemEkle(depo, servis, proje.id, giderli.id, girdi('Peyzaj'))).rejects.toThrow('doğrudan gider');
  });

  it('alt kalemi olan kaleme bütçe girilmez; değişiklik geçmişe yazılır', async () => {
    const ana = await kalemEkle(depo, servis, proje.id, null, girdi('Ana'));
    const alt = await kalemEkle(depo, servis, proje.id, ana.id, girdi('Alt', 100));
    await expect(kalemGuncelle(depo, servis, ana.id, girdi('Ana', 50))).rejects.toThrow('alt kalemlerden toplanır');
    await kalemGuncelle(depo, servis, alt.id, girdi('Alt', 150));
    const gecmis = await depo.listele('islemGecmisi', { kayitId: alt.id });
    expect(gecmis.find((g) => g.islem === 'guncelle')).toMatchObject({ eski: { butceTutari: TL(100) }, yeni: { butceTutari: TL(150) } });

    const yarin = new KayitServisi(depo, oturum, () => new Date(Date.now() + 86_400_000));
    await expect(kalemGuncelle(depo, yarin, alt.id, girdi('Alt', 200))).rejects.toThrow('gerekçe');
    await kalemGuncelle(depo, yarin, alt.id, girdi('Alt', 200), 'Beton fiyatı arttı');
  });

  it('alt kalemi ya da gideri olan kalem kaldırılamaz', async () => {
    const ana = await kalemEkle(depo, servis, proje.id, null, girdi('Ana'));
    const alt = await kalemEkle(depo, servis, proje.id, ana.id, girdi('Alt'));
    await expect(kalemIptal(depo, servis, ana.id)).rejects.toThrow('alt kalemleri');
    const g = await giderYaz(alt.id, 10);
    await expect(kalemIptal(depo, servis, alt.id)).rejects.toThrow('gider yazılmış');

    await servis.iptal('gider', g.id);
    await kalemIptal(depo, servis, alt.id);
    await kalemIptal(depo, servis, ana.id);
    expect((await butce()).dugumler).toEqual([]);
  });

  it('sıra komşuyla değişir; uçta değişmez', async () => {
    const a = await kalemEkle(depo, servis, proje.id, null, girdi('A'));
    await kalemEkle(depo, servis, proje.id, null, girdi('B'));
    await kalemEkle(depo, servis, proje.id, null, girdi('C'));
    await kalemTasi(depo, servis, a.id, 1);
    await kalemTasi(depo, servis, a.id, 1);
    await kalemTasi(depo, servis, a.id, 1);
    expect((await butce()).dugumler.map((d) => d.kalem.ad)).toEqual(['B', 'C', 'A']);
  });
});

describe('hazır kalemler', () => {
  it('kat karşılığında arsa sahibi giderleri gelir, arsa bedeli gelmez; dolu projeye eklenmez', async () => {
    const sayi = await hazirKalemleriEkle(depo, servis, proje.id);
    const ozet = await butce();
    const beklenen = HAZIR_KALEMLER.filter((k) => !k.yalnizca || k.yalnizca === 'kat_karsiligi');
    expect(ozet.dugumler.map((d) => d.kalem.ad)).toEqual(beklenen.map((k) => k.ad));
    expect(sayi).toBe(beklenen.reduce((t, k) => t + 1 + k.altlar.length, 0));
    expect(ozet.dugumler.map((d) => d.kalem.ad)).not.toContain('Arsa');
    expect(ozet.dugumler.find((d) => d.kalem.ad === 'Arsa ve kat karşılığı giderleri')!.altlar.map((a) => a.kalem.ad)).toContain(
      'Kira yardımı',
    );
    await expect(hazirKalemleriEkle(depo, servis, proje.id)).rejects.toThrow('zaten kalem var');
  });

  it('satın almada arsa kalemi gelir, kat karşılığı giderleri gelmez', async () => {
    await servis.guncelle('proje', proje.id, { arsaTipi: 'satin_alma' });
    await hazirKalemleriEkle(depo, servis, proje.id);
    const adlar = (await butce()).dugumler.map((d) => d.kalem.ad);
    expect(adlar).toContain('Arsa');
    expect(adlar).not.toContain('Arsa ve kat karşılığı giderleri');
  });
});

describe('son kullanılan kalemler', () => {
  it('en son yazılan önce, tekrarsız; iptal gider sayılmaz', async () => {
    const ana = await kalemEkle(depo, servis, proje.id, null, girdi('Kaba'));
    const beton = await kalemEkle(depo, servis, proje.id, ana.id, girdi('Beton'));
    const demir = await kalemEkle(depo, servis, proje.id, ana.id, girdi('Demir'));
    const kalip = await kalemEkle(depo, servis, proje.id, ana.id, girdi('Kalıp'));
    await giderYaz(beton.id, 10);
    await new Promise((r) => setTimeout(r, 5));
    await giderYaz(demir.id, 10);
    await new Promise((r) => setTimeout(r, 5));
    await giderYaz(beton.id, 10);
    await new Promise((r) => setTimeout(r, 5));
    const iptalEdilecek = await giderYaz(kalip.id, 10);
    await servis.iptal('gider', iptalEdilecek.id);
    expect(await sonKullanilanKalemler(depo, oturum.firmaId, proje.id)).toEqual([beton.id, demir.id]);
    expect(await sonKullanilanKalemler(depo, oturum.firmaId, proje.id, 1)).toEqual([beton.id]);
  });
});
