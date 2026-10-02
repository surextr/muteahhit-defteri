import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { veriKatmaniniAc } from '../veri';
import type { Depo } from '../veri/depo';
import { yeniId } from '../veri/kimlik';
import { blokEkle, blokOzellikleriniDegistir, blokOzellikleriniKopyala, farkliAlanlar, katEkle, topluOzellikVer } from './bina';
import { KayitServisi, type Oturum } from './kayitServisi';
import { ilkKurulum } from './kurulum';
import { blokGirdisiCikar, BOS_BLOK, projeOlustur, projeYapisiGetir, type BlokGirdisi } from './proje';

let depo: Depo;
let oturum: Oturum;
let servis: KayitServisi;

beforeEach(async () => {
  depo = await veriKatmaniniAc(`test-${yeniId()}`);
  oturum = await ilkKurulum(depo, { firmaAdi: 'Firma', kullaniciAdi: 'Yönetici' });
  servis = new KayitServisi(depo, oturum);
});
afterEach(() => depo.kapat());

const blok = (ad: string, ek: Partial<BlokGirdisi> = {}): BlokGirdisi => ({
  ...BOS_BLOK,
  ad,
  zeminBolumSayisi: 0,
  normalKatSayisi: 3,
  katBasinaDaire: 3,
  ...ek,
});

async function kur(bloklar: BlokGirdisi[] = [blok('A')]) {
  const p = await projeOlustur(
    depo,
    servis,
    {
      ad: 'P',
      il: null,
      ilce: null,
      mahalle: null,
      adres: '',
      parseller: [],
      arsaTipi: 'kat_karsiligi',
      baslangicTarihi: null,
      planlananBitis: null,
      gerceklesenBitis: null,
      alanlar: { net: null, brut: null, toplamInsaat: null, satilabilir: null },
    },
    bloklar,
  );
  return (await projeYapisiGetir(depo, oturum.firmaId, p.id))!;
}

const bolumler = (yapi: Awaited<ReturnType<typeof kur>>, blokSira = 0) =>
  yapi.bloklar[blokSira]!.katlar.flatMap((k) => k.bolumler);

describe('toplu özellik', () => {
  it('hattaki bütün dairelere uygulanır; yalnız verilen alanlar değişir', async () => {
    const yapi = await kur();
    const hat1 = bolumler(yapi).filter((b) => b.hat === 1);
    expect(hat1.map((b) => b.no).sort()).toEqual(['1', '4', '7']);
    const sayi = await topluOzellikVer(
      depo,
      servis,
      hat1.map((b) => b.id),
      { odaTipi: '3+1', brutM2: 120, cephe: 'Kuzeybatı' },
    );
    expect(sayi).toBe(3);
    const sonra = bolumler((await projeYapisiGetir(depo, oturum.firmaId, yapi.proje.id))!);
    for (const b of sonra.filter((x) => x.hat === 1)) expect(b).toMatchObject({ odaTipi: '3+1', brutM2: 120, cephe: 'Kuzeybatı', balkon: false });
    expect(sonra.filter((x) => x.hat === 2).every((b) => b.odaTipi === null)).toBe(true);
  });

  it('tek daire sonradan düzeltilir; tekrar uygulamada aynı olanlar sayılmaz', async () => {
    const yapi = await kur();
    const hat1 = bolumler(yapi).filter((b) => b.hat === 1);
    await topluOzellikVer(depo, servis, hat1.map((b) => b.id), { odaTipi: '3+1' });
    await topluOzellikVer(depo, servis, [hat1[0]!.id], { odaTipi: '4+1' });
    expect(await topluOzellikVer(depo, servis, hat1.map((b) => b.id), { odaTipi: '3+1' })).toBe(1);
  });

  it('hatalı değer ve net > brüt reddedilir; hiçbir şey yazılmaz', async () => {
    const yapi = await kur();
    const ids = bolumler(yapi).map((b) => b.id);
    await expect(topluOzellikVer(depo, servis, ids, { brutM2: -1 })).rejects.toThrow('sıfırdan büyük');
    await topluOzellikVer(depo, servis, [ids[0]!], { brutM2: 100 });
    await expect(topluOzellikVer(depo, servis, ids, { netM2: 110 })).rejects.toThrow('Net m²');
    await expect(topluOzellikVer(depo, servis, ids, {})).rejects.toThrow('en az bir özellik');
    expect((await depo.listele('bagimsizBolum')).filter((b) => b.netM2 !== null)).toEqual([]);
  });

  it('farklı alanlar önizleme için bulunur', () => {
    const b = { odaTipi: '2+1', brutM2: 100, netM2: null, cephe: null, balkon: true, otopark: false, depo: false, ozellikler: [] };
    expect(farkliAlanlar(b, { odaTipi: '3+1', balkon: true })).toEqual(['odaTipi']);
  });
});

describe('bloktan kopyalama ve blok özellikleri', () => {
  it('kat sırası ve hatla eşleşir; fazla bölümler eşleşmez', async () => {
    const yapi = await kur([blok('A'), blok('B', { normalKatSayisi: 4 })]);
    const a = bolumler(yapi, 0);
    await topluOzellikVer(depo, servis, a.filter((b) => b.hat === 2).map((b) => b.id), { odaTipi: '2+1', netM2: 85 });
    const sonuc = await blokOzellikleriniKopyala(depo, servis, yapi.bloklar[0]!.blok.id, yapi.bloklar[1]!.blok.id);
    expect(sonuc).toEqual({ kopyalanan: 3, eslesmeyen: 3 });
    const b = bolumler((await projeYapisiGetir(depo, oturum.firmaId, yapi.proje.id))!, 1);
    expect(b.filter((x) => x.odaTipi === '2+1').map((x) => x.hat)).toEqual([2, 2, 2]);
  });

  it('blok özellikleri değişir; asansör sayısı denetlenir', async () => {
    const yapi = await kur();
    const id = yapi.bloklar[0]!.blok.id;
    const b = await blokOzellikleriniDegistir(servis, id, { asansorSayisi: 2, kapaliOtopark: true, siginak: false, jenerator: true });
    expect(b).toMatchObject({ asansorSayisi: 2, kapaliOtopark: true, jenerator: true });
    await expect(blokOzellikleriniDegistir(servis, id, { asansorSayisi: -1, kapaliOtopark: true, siginak: false, jenerator: true })).rejects.toThrow('Asansör');
  });
});

describe('sonradan blok ekleme', () => {
  it('"A Blok ile aynı": yapı ve daire özellikleri kopyalanır, sıra ve numaralar yeni blokta baştan', async () => {
    const yapi = await kur([blok('A', { zeminBolumSayisi: 2, asansorSayisi: 2 })]);
    const hat1 = bolumler(yapi).filter((b) => b.hat === 1);
    await topluOzellikVer(depo, servis, hat1.map((b) => b.id), { odaTipi: '3+1', brutM2: 120 });

    const girdi = { ...blokGirdisiCikar(yapi.bloklar[0]!), ad: 'B' };
    expect(girdi).toMatchObject({ normalKatSayisi: 3, katBasinaDaire: 3, zeminBolumSayisi: 2, asansorSayisi: 2 });
    const yeni = await blokEkle(depo, servis, yapi.proje.id, girdi, yapi.bloklar[0]!.blok.id);
    expect(yeni.sira).toBe(2);

    const sonra = (await projeYapisiGetir(depo, oturum.firmaId, yapi.proje.id))!;
    const b = bolumler(sonra, 1);
    expect(b).toHaveLength(bolumler(yapi).length);
    expect(b.filter((x) => x.hat === 1).every((x) => x.odaTipi === '3+1' && x.brutM2 === 120)).toBe(true);
    expect(b.map((x) => x.no)).toContain('1');
  });

  it('aynı ad ve hatalı sayı reddedilir', async () => {
    const yapi = await kur();
    await expect(blokEkle(depo, servis, yapi.proje.id, blok('a'))).rejects.toThrow('zaten var');
    await expect(blokEkle(depo, servis, yapi.proje.id, blok('C', { normalKatSayisi: -1 }))).rejects.toThrow('normal kat sayısı');
  });
});

describe('sonradan kat ekleme', () => {
  it('normal kat çatı katının altına girer; numaralar en büyükten devam eder; alttaki kat kopyalanır', async () => {
    const yapi = await kur([blok('A', { catiDubleksSayisi: 2 })]);
    // 3 kat × 3 daire = 1-9, çatı 10-11
    const ust = yapi.bloklar[0]!.katlar.find((k) => k.kat.ad === '3. Kat')!;
    await topluOzellikVer(depo, servis, [ust.bolumler.find((b) => b.hat === 2)!.id], { odaTipi: '2+1', cephe: 'Güney' });
    const blokId = yapi.bloklar[0]!.blok.id;

    const kat = await katEkle(depo, servis, blokId, { tur: 'normal', bolumSayisi: 3, bolumTipi: 'daire', ozellikleriKopyala: true });
    expect(kat).toMatchObject({ ad: '4. Kat', sira: 4 });
    const sonra = (await projeYapisiGetir(depo, oturum.firmaId, yapi.proje.id))!.bloklar[0]!.katlar;
    expect(sonra.map((k) => k.kat.ad)).toEqual(['Çatı Katı', '4. Kat', '3. Kat', '2. Kat', '1. Kat', 'Zemin']);
    expect(sonra[0]!.kat.sira).toBe(5);
    const yeni = sonra[1]!.bolumler;
    expect(yeni.map((b) => b.no)).toEqual(['12', '13', '14']);
    expect(yeni.find((b) => b.hat === 2)).toMatchObject({ odaTipi: '2+1', cephe: 'Güney', sahiplik: 'muteahhit' });
    expect(yeni.find((b) => b.hat === 1)!.odaTipi).toBeNull();
  });

  it('bodrum en alta, dükkan numarası sürer; çatı katı ikinci kez eklenemez', async () => {
    const yapi = await kur([blok('A', { bodrumKatSayisi: 1, bodrumKatBolumSayisi: 1 })]);
    const blokId = yapi.bloklar[0]!.blok.id;
    const kat = await katEkle(depo, servis, blokId, { tur: 'bodrum', bolumSayisi: 2, bolumTipi: 'dukkan', ozellikleriKopyala: false });
    expect(kat).toMatchObject({ ad: '2. Bodrum', sira: -2, tip: 'bodrum' });
    const sonra = (await projeYapisiGetir(depo, oturum.firmaId, yapi.proje.id))!.bloklar[0]!.katlar;
    expect(sonra.at(-1)!.bolumler.map((b) => b.no)).toEqual(['D2', 'D3']);

    await katEkle(depo, servis, blokId, { tur: 'cati', bolumSayisi: 1, bolumTipi: 'dukkan', ozellikleriKopyala: false });
    await expect(katEkle(depo, servis, blokId, { tur: 'cati', bolumSayisi: 1, bolumTipi: 'daire', ozellikleriKopyala: false })).rejects.toThrow(
      'zaten var',
    );
    await expect(katEkle(depo, servis, blokId, { tur: 'normal', bolumSayisi: 0, bolumTipi: 'daire', ozellikleriKopyala: false })).rejects.toThrow(
      'Bölüm sayısı',
    );
  });
});
