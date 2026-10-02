import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { veriKatmaniniAc } from '../veri';
import type { Depo } from '../veri/depo';
import { yeniId } from '../veri/kimlik';
import { blokOzellikleriniDegistir, blokOzellikleriniKopyala, farkliAlanlar, topluOzellikVer } from './bina';
import { KayitServisi, type Oturum } from './kayitServisi';
import { ilkKurulum } from './kurulum';
import { BOS_BLOK, projeOlustur, projeYapisiGetir, type BlokGirdisi } from './proje';

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
