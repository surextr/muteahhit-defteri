import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sayiOku, sayiYaz, tamSayiOku } from '../hesap/sayi';
import { veriKatmaniniAc } from '../veri';
import type { Depo } from '../veri/depo';
import { yeniId } from '../veri/kimlik';
import { KayitServisi, type Oturum } from './kayitServisi';
import { ilkKurulum } from './kurulum';
import {
  BOS_BLOK,
  binaPlaniHazirla,
  projeleriListele,
  projeOlustur,
  projeYapisiGetir,
  type BlokGirdisi,
  type ProjeGirdisi,
} from './proje';

const blok = (ek: Partial<BlokGirdisi> = {}): BlokGirdisi => ({ ...BOS_BLOK, ...ek });

describe('bina planı', () => {
  it('"5 kat, her katta 4 daire": zeminden yukarı sıralı numaralar', () => {
    const { plan, hatalar } = binaPlaniHazirla([blok({ zeminBolumSayisi: 0, normalKatSayisi: 5, katBasinaDaire: 4 })]);
    expect(hatalar).toEqual([]);
    const katlar = plan!.bloklar[0]!.katlar;
    expect(katlar.map((k) => k.ad)).toEqual(['Zemin', '1. Kat', '2. Kat', '3. Kat', '4. Kat', '5. Kat']);
    expect(katlar[1]!.bolumler.map((b) => b.no)).toEqual(['1', '2', '3', '4']);
    expect(katlar[5]!.bolumler.map((b) => b.no)).toEqual(['17', '18', '19', '20']);
    expect(plan!.daireSayisi).toBe(20);
  });

  it('bodrum, zemin dükkanları ve çatı dubleksi', () => {
    const { plan } = binaPlaniHazirla([
      blok({
        bodrumKatSayisi: 2,
        bodrumKatBolumSayisi: 1,
        zeminBolumSayisi: 3,
        zeminBolumTipi: 'dukkan',
        normalKatSayisi: 2,
        katBasinaDaire: 2,
        catiDubleksSayisi: 2,
      }),
    ]);
    const katlar = plan!.bloklar[0]!.katlar;
    expect(katlar.map((k) => [k.ad, k.tip, k.sira])).toEqual([
      ['2. Bodrum', 'bodrum', -2],
      ['1. Bodrum', 'bodrum', -1],
      ['Zemin', 'zemin', 0],
      ['1. Kat', 'normal', 1],
      ['2. Kat', 'normal', 2],
      ['Çatı Katı', 'cati_dubleksi', 3],
    ]);
    expect(katlar.flatMap((k) => k.bolumler.map((b) => b.no))).toEqual(
      ['D1', 'D2', 'D3', 'D4', 'D5', '1', '2', '3', '4', '5', '6'],
    );
    expect(plan).toMatchObject({ daireSayisi: 6, dukkanSayisi: 5 });
  });

  it('her blok kendi içinde 1\'den numaralanır', () => {
    const { plan } = binaPlaniHazirla([blok({ ad: 'A' }), blok({ ad: 'B' })]);
    expect(plan!.bloklar.map((b) => b.katlar[0]!.bolumler[0]!.no)).toEqual(['1', '1']);
  });

  it.each([
    [[], 'En az bir blok'],
    [[blok({ ad: ' ' })], 'blok adı boş'],
    [[blok({ ad: 'A' }), blok({ ad: 'a' })], 'farklı olmalı'],
    [[blok({ normalKatSayisi: 41 })], 'normal kat sayısı 0 ile 40'],
    [[blok({ katBasinaDaire: 2.5 })], 'kat başına daire 0 ile 20'],
    [[blok({ normalKatSayisi: 3, katBasinaDaire: 0 })], 'kat başına daire sayısı girin'],
    [[blok({ zeminBolumSayisi: 0, normalKatSayisi: 0 })], 'en az bir bağımsız bölüm'],
  ])('hatalı girdi açıkça bildirilir: %#', (girdi, mesaj) => {
    const { plan, hatalar } = binaPlaniHazirla(girdi as BlokGirdisi[]);
    expect(plan).toBeNull();
    expect(hatalar.join(' ')).toContain(mesaj);
  });
});

describe('sayı okuma', () => {
  it.each([
    ['120,5', 120.5],
    ['1.250', 1250],
    ['1.250,75', 1250.75],
    ['85', 85],
  ])('%s → %d', (m, s) => expect(sayiOku(m)).toBe(s));

  it('yazılan sayı aynen geri okunur', () => {
    for (const s of [1850.5, 120, 0.75, 12345.67]) expect(sayiOku(sayiYaz(s))).toBe(s);
    expect(sayiYaz(1850.5)).toBe('1.850,5');
  });

  it('geçersiz ve ondalıklı tam sayı', () => {
    expect(sayiOku('')).toBeNull();
    expect(sayiOku('12a')).toBeNull();
    expect(tamSayiOku('4,5')).toBeNull();
    expect(tamSayiOku('4')).toBe(4);
  });
});

describe('proje oluşturma', () => {
  let depo: Depo;
  let oturum: Oturum;
  let servis: KayitServisi;
  beforeEach(async () => {
    depo = await veriKatmaniniAc(`test-${yeniId()}`);
    oturum = await ilkKurulum(depo, { firmaAdi: 'Firma', kullaniciAdi: 'Yönetici' });
    servis = new KayitServisi(depo, oturum);
  });
  afterEach(() => depo.kapat());

  const proje = (ek: Partial<ProjeGirdisi> = {}): ProjeGirdisi => ({
    ad: 'Gül Apartmanı',
    adres: 'Merkez',
    ada: '101',
    parsel: '5',
    arsaTipi: 'kat_karsiligi',
    baslangicTarihi: '2026-10-01',
    alanlar: { net: null, brut: null, toplamInsaat: 1800, satilabilir: 1500 },
    ...ek,
  });

  it('proje, takip başlıkları, blok, kat ve daireleri oluşturur; yapı geri okunur', async () => {
    const p = await projeOlustur(depo, servis, proje(), [blok({ zeminBolumSayisi: 2, normalKatSayisi: 5, katBasinaDaire: 4 })]);
    const yapi = await projeYapisiGetir(depo, oturum.firmaId, p.id);

    expect(yapi!.proje).toMatchObject({ ad: 'Gül Apartmanı', durum: 'aktif', alanlar: { satilabilir: 1500 } });
    expect(yapi!.takipBasliklari.map((t) => [t.ad, t.durum])).toEqual([
      ['Anlaşma', 'baslamadi'],
      ['Ruhsat', 'baslamadi'],
      ['Kaba inşaat', 'baslamadi'],
      ['İnce inşaat', 'baslamadi'],
      ['İskan', 'baslamadi'],
      ['Satış', 'baslamadi'],
    ]);
    const [a] = yapi!.bloklar;
    expect(a!.katlar.map((k) => k.kat.ad)).toEqual(['5. Kat', '4. Kat', '3. Kat', '2. Kat', '1. Kat', 'Zemin']);
    expect(a!.katlar[0]!.bolumler.map((b) => b.no)).toEqual(['19', '20', '21', '22']);
    expect(a!.katlar[0]!.bolumler[0]).toMatchObject({
      tip: 'daire',
      sahiplik: 'muteahhit',
      satisDurumu: 'satisa_kapali',
      teslimDurumu: 'teslim_edilmedi',
    });

    expect(await projeleriListele(depo, oturum.firmaId)).toEqual([
      expect.objectContaining({ daireSayisi: 22, dukkanSayisi: 0 }),
    ]);
    // Her kayıt işlem geçmişine yazılmıştır.
    expect((await depo.listele('islemGecmisi', { kayitId: p.id }))[0]?.islem).toBe('olustur');
  });

  it('hatalı girdide hiçbir şey yazılmaz', async () => {
    await expect(projeOlustur(depo, servis, proje({ ad: '' }), [blok()])).rejects.toThrow('Proje adı boş');
    await expect(projeOlustur(depo, servis, proje(), [blok({ normalKatSayisi: 99 })])).rejects.toThrow('normal kat');
    expect(await depo.listele('proje')).toEqual([]);
    expect(await depo.listele('bagimsizBolum')).toEqual([]);
  });

  it('başka firmanın projesi okunmaz', async () => {
    const p = await projeOlustur(depo, servis, proje(), [blok()]);
    expect(await projeYapisiGetir(depo, 'baska-firma', p.id)).toBeNull();
  });
});
