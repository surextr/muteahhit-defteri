import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { veriKatmaniniAc } from '../veri';
import type { Depo } from '../veri/depo';
import { yeniId } from '../veri/kimlik';
import type { Cari, Hesap } from '../veri/tipler';
import { cariOlustur, carileriListele } from './cari';
import { giderDetayiGetir, giderGuncelle, giderIptal, giderleriListele, giderOlustur, iadeOlustur, type GiderGirdisi } from './gider';
import { hesapOlustur, hesaplariListele } from './hesap';
import { kalemEkle, projeButcesiGetir } from './kalem';
import { KayitServisi, type Oturum } from './kayitServisi';
import { ilkKurulum } from './kurulum';
import { vergiDairesiGetir } from './cari';
import { acikGiderler, acikIadeler, cariEkstresiGetir, iadeMahsup, odemeYap, tahsilatKaydet } from './odeme';
import { tevkifatBeyanlari } from './tevkifat';
import { BOS_BLOK, projeOlustur } from './proje';

const TL = (n: number) => Math.round(n * 100);
const BUGUN = '2026-10-10';

let depo: Depo;
let oturum: Oturum;
let servis: KayitServisi;
let tedarikci: Cari;
let banka: Hesap;

beforeEach(async () => {
  depo = await veriKatmaniniAc(`test-${yeniId()}`);
  oturum = await ilkKurulum(depo, { firmaAdi: 'Firma', kullaniciAdi: 'Yönetici' });
  servis = new KayitServisi(depo, oturum);
  tedarikci = await cariOlustur(depo, servis, { ad: 'Demir AŞ', roller: ['tedarikci'], telefon: null, vergiNo: null, adres: null, not: '' });
  banka = await hesapOlustur(depo, servis, { ad: 'Banka', tur: 'banka', paraBirimi: 'TRY', banka: null, iban: null }, { tutar: TL(100_000), tarih: '2026-10-01' });
});
afterEach(() => depo.kapat());

/** KDV %20 hariç tutarla tek satır. */
const girdi = (tutar: number, ek: Partial<GiderGirdisi> = {}, kalemId: string | null = null): GiderGirdisi => ({
  tarih: '2026-10-01',
  projeId: null,
  cariId: tedarikci.id,
  faturaNo: null,
  vadeTarihi: null,
  aciklama: '',
  satirlar: [{ kalemId, aciklama: '', miktar: null, birim: null, tutar: TL(tutar), kdvDahil: false, kdvOrani: 20, tevkifat: null }],
  ...ek,
});
const bakiye = async () => (await carileriListele(depo, oturum.firmaId)).find((c) => c.cari.id === tedarikci.id)!.bakiye;
const bankaBakiye = async () => (await hesaplariListele(depo, oturum.firmaId)).find((h) => h.hesap.id === banka.id)!.bakiye;
const detay = async (id: string) => (await giderDetayiGetir(depo, oturum.firmaId, id, BUGUN))!;

describe('iade faturası', () => {
  it('bağsız iade eksi giderdir: tutarlar eksi saklanır, cari borcu düşer, alacak açık kalır', async () => {
    await giderOlustur(depo, servis, girdi(10_000)); // 12.000 borç
    const iade = await iadeOlustur(depo, servis, girdi(1_000, { faturaNo: 'IA-1' }));
    expect(iade).toMatchObject({ tur: 'iade', iadeEdilenGiderId: null, kdvHaricToplam: -TL(1_000), kdvToplam: -TL(200), toplam: -TL(1_200) });
    expect(await depo.listele('giderSatiri', { giderId: iade.id })).toEqual([expect.objectContaining({ kdvHaricTutar: -TL(1_000), toplam: -TL(1_200) })]);
    expect(await bakiye()).toBe(TL(10_800));
    expect((await detay(iade.id)).iadeAcik).toBe(TL(1_200));
    expect(await acikIadeler(depo, oturum.firmaId, tedarikci.id)).toEqual([expect.objectContaining({ acik: TL(1_200) })]);
    expect((await cariEkstresiGetir(depo, oturum.firmaId, tedarikci.id)).map((x) => [x.tur, x.tutar])).toEqual([
      ['gider', TL(12_000)],
      ['iade', -TL(1_200)],
    ]);
    // Açık gider listesine iade girmez; alış hâlâ tam borçlu (mahsup edilmedi).
    expect((await acikGiderler(depo, oturum.firmaId, tedarikci.id, BUGUN)).map((x) => x.kalan)).toEqual([TL(12_000)]);
  });

  it('bağlı iade asıl faturanın kalan borcundan düşer; artanı alacak kalır', async () => {
    const alis = await giderOlustur(depo, servis, girdi(10_000));
    await odemeYap(depo, servis, { tarih: '2026-10-02', cariId: tedarikci.id, hesapId: banka.id, tutar: TL(11_000), aciklama: '', dagitim: [{ giderId: alis.id, tutar: TL(11_000) }] });
    const iade = await iadeOlustur(depo, servis, girdi(2_000, { iadeEdilenGiderId: alis.id }));
    // Kalan 1.000 mahsup edildi, 1.400 alacak.
    expect((await detay(alis.id)).kalan).toBe(0);
    expect((await detay(alis.id)).mahsuplar).toEqual([expect.objectContaining({ gider: expect.objectContaining({ id: iade.id }) })]);
    const d = await detay(iade.id);
    expect(d).toMatchObject({ iadeAcik: TL(1_400), iadeEdilen: expect.objectContaining({ id: alis.id }) });
    expect(await bakiye()).toBe(-TL(1_400));
  });

  it('artan alacak sonraki faturaya mahsup edilir', async () => {
    const iade = await iadeOlustur(depo, servis, girdi(1_000));
    const yeni = await giderOlustur(depo, servis, girdi(5_000));
    await iadeMahsup(depo, servis, iade.id, [{ giderId: yeni.id, tutar: TL(1_200) }]);
    expect((await detay(yeni.id)).kalan).toBe(TL(4_800));
    expect((await detay(iade.id)).iadeAcik).toBe(0);
    await expect(iadeMahsup(depo, servis, iade.id, [{ giderId: yeni.id, tutar: 1 }])).rejects.toThrow('açık alacağı yok');
    expect(await bakiye()).toBe(TL(4_800));
  });

  it('tedarikçi parayı geri verirse tahsilat iade alacağını kapatır', async () => {
    const iade = await iadeOlustur(depo, servis, girdi(1_000));
    await tahsilatKaydet(depo, servis, { tarih: '2026-10-05', amac: 'cari', cariId: tedarikci.id, hesapId: banka.id, tutar: TL(1_200), projeId: null, aciklama: '', iadeId: iade.id });
    expect((await detay(iade.id)).iadeAcik).toBe(0);
    expect((await detay(iade.id)).odemeler).toHaveLength(1);
    expect(await bakiye()).toBe(0);
    expect(await bankaBakiye()).toBe(TL(101_200));
  });

  it('iade girilirken para hemen geri alınabilir; carisiz iadede zorunlu', async () => {
    await expect(iadeOlustur(depo, servis, girdi(1_000, { cariId: null }))).rejects.toThrow('hemen geri alınmış');
    const iade = await iadeOlustur(depo, servis, girdi(1_000, { cariId: null }), { hesapId: banka.id, tutar: TL(1_200) });
    expect((await detay(iade.id)).iadeAcik).toBe(0);
    expect(await bankaBakiye()).toBe(TL(101_200));
    // İptalde geri alınan para da iptal olur.
    await giderIptal(depo, servis, iade.id);
    expect(await bankaBakiye()).toBe(TL(100_000));
  });

  it('iade fazla olamaz, başka carinin faturasına bağlanamaz', async () => {
    const alis = await giderOlustur(depo, servis, girdi(1_000));
    await iadeOlustur(depo, servis, girdi(600, { iadeEdilenGiderId: alis.id }));
    await expect(iadeOlustur(depo, servis, girdi(500, { iadeEdilenGiderId: alis.id }))).rejects.toThrow('en çok 480');
    const baska = await cariOlustur(depo, servis, { ad: 'Başka', roller: ['tedarikci'], telefon: null, vergiNo: null, adres: null, not: '' });
    await expect(iadeOlustur(depo, servis, girdi(100, { cariId: baska.id, iadeEdilenGiderId: alis.id }))).rejects.toThrow('başka bir carinin');
    // Asıl fatura iadelerin altına düşürülemez.
    await expect(giderGuncelle(depo, servis, alis.id, girdi(500))).rejects.toThrow('iade girilmiş');
  });

  it('iade düzenlenir; kullanılan alacağın altına inemez', async () => {
    const iade = await iadeOlustur(depo, servis, girdi(1_000));
    const yeni = await giderOlustur(depo, servis, girdi(5_000));
    await iadeMahsup(depo, servis, iade.id, [{ giderId: yeni.id, tutar: TL(1_000) }]);
    await expect(giderGuncelle(depo, servis, iade.id, girdi(500))).rejects.toThrow('mahsup edilen');
    const g = await giderGuncelle(depo, servis, iade.id, girdi(2_000));
    expect(g).toMatchObject({ tur: 'iade', toplam: -TL(2_400) });
    expect((await detay(iade.id)).iadeAcik).toBe(TL(1_400));
  });

  it('iade iptal edilince mahsupları kalkar; asıl fatura iptal edilince iade alacağı açılır', async () => {
    const alis = await giderOlustur(depo, servis, girdi(1_000));
    const iade = await iadeOlustur(depo, servis, girdi(500, { iadeEdilenGiderId: alis.id }));
    expect((await detay(alis.id)).kalan).toBe(TL(600));
    await giderIptal(depo, servis, alis.id);
    expect((await detay(iade.id)).iadeAcik).toBe(TL(600));

    const alis2 = await giderOlustur(depo, servis, girdi(1_000));
    await iadeMahsup(depo, servis, iade.id, [{ giderId: alis2.id, tutar: TL(600) }]);
    await giderIptal(depo, servis, iade.id);
    expect((await detay(alis2.id)).kalan).toBe(TL(1_200));
  });

  it('iade edilen kalemin gerçekleşeni düşer', async () => {
    const proje = await projeOlustur(
      depo,
      servis,
      { ad: 'P', adres: '', ada: '', parsel: '', arsaTipi: 'satin_alma', baslangicTarihi: null, alanlar: { net: null, brut: null, toplamInsaat: null, satilabilir: null } },
      [BOS_BLOK],
    );
    const kalem = await kalemEkle(depo, servis, proje.id, null, { ad: 'Deneme demiri', birim: null, butceMiktari: null, butceTutari: null });
    await giderOlustur(depo, servis, girdi(10_000, { projeId: proje.id }, kalem.id));
    await iadeOlustur(depo, servis, girdi(1_000, { projeId: proje.id }, kalem.id));
    const butce = await projeButcesiGetir(depo, oturum.firmaId, proje.id, true);
    expect(butce.dugumler.find((d) => d.kalem.id === kalem.id)?.gerceklesen).toBe(TL(10_800));
    const liste = await giderleriListele(depo, oturum.firmaId, { projeId: proje.id, yalnizcaOdenmemis: true }, BUGUN);
    expect(liste.map((x) => x.gider.tur).sort()).toEqual(['alis', 'iade']);
  });
});

describe('tevkifatlı iade', () => {
  const tevkifatli = (tutar: number, pay: number, ek: Partial<GiderGirdisi> = {}): GiderGirdisi => {
    const g = girdi(tutar, ek);
    g.satirlar[0]!.tevkifat = { pay, payda: 10 };
    return g;
  };
  const vdBakiye = async () => {
    const vd = (await vergiDairesiGetir(depo, oturum.firmaId))!;
    return (await carileriListele(depo, oturum.firmaId)).find((c) => c.cari.id === vd.id)!.bakiye;
  };

  it('bağlı iadede oran asıl faturadan gelir; cariden tevkifat sonrası, vergi dairesinden tevkifat kadar düşer', async () => {
    // 10.000 + 2.000 KDV, 4/10 → tevkifat 800, cariye 11.200.
    const alis = await giderOlustur(depo, servis, tevkifatli(10_000, 4));
    // Kullanıcı oran seçmese de asıl faturanınki uygulanır: 1.000 + 200 KDV, tevkifat 80, cariden 1.120.
    const iade = await iadeOlustur(depo, servis, girdi(1_000, { iadeEdilenGiderId: alis.id }));
    expect(iade).toMatchObject({ toplam: -TL(1_200), tevkifatToplam: -TL(80) });
    expect(await depo.listele('giderSatiri', { giderId: iade.id })).toEqual([
      expect.objectContaining({ tevkifat: { pay: 4, payda: 10 }, tevkifatTutari: -TL(80) }),
    ]);
    expect(await bakiye()).toBe(TL(10_080));
    expect(await vdBakiye()).toBe(TL(720));
    const d = await detay(alis.id);
    expect(d).toMatchObject({ kalan: TL(10_080), tevkifatKalan: TL(720) });
    expect((await detay(iade.id)).iadeAcik).toBe(0);
    // Ödeme ekranında vergi dairesine kalan 720.
    const vd = (await vergiDairesiGetir(depo, oturum.firmaId))!;
    expect((await acikGiderler(depo, oturum.firmaId, vd.id, BUGUN)).map((x) => x.kalan)).toEqual([TL(720)]);
    const [ekim] = await tevkifatBeyanlari(depo, oturum.firmaId);
    expect(ekim).toMatchObject({ toplam: TL(720), kalan: TL(720), odenen: 0 });
    expect(ekim!.oranlar).toEqual([expect.objectContaining({ matrah: TL(9_000), kdv: TL(1_800), tevkifatTutari: TL(720) })]);
  });

  it('asıl faturanın tevkifatı ödenmişse iadenin tevkifatı vergi dairesinden alacak kalır', async () => {
    const alis = await giderOlustur(depo, servis, tevkifatli(10_000, 4));
    const vd = (await vergiDairesiGetir(depo, oturum.firmaId))!;
    await odemeYap(depo, servis, { tarih: '2026-10-05', cariId: vd.id, hesapId: banka.id, tutar: TL(800), aciklama: '', dagitim: [{ hedefTur: 'tevkifat', giderId: alis.id, tutar: TL(800) }] });
    const iade = await iadeOlustur(depo, servis, girdi(1_000, { iadeEdilenGiderId: alis.id, tarih: '2026-11-03' }));
    expect(await vdBakiye()).toBe(-TL(80));
    expect((await detay(iade.id)).tevkifatKalan).toBe(-TL(80));
    const [kasim] = await tevkifatBeyanlari(depo, oturum.firmaId);
    expect(kasim).toMatchObject({ donem: '2026-11', toplam: -TL(80), kalan: -TL(80) });
  });

  it('bağsız iadede oranı kullanıcı seçer; tevkifatsız da olabilir', async () => {
    await iadeOlustur(depo, servis, tevkifatli(1_000, 9));
    expect(await vdBakiye()).toBe(-TL(180));
    expect(await bakiye()).toBe(-TL(1_020));
    await iadeOlustur(depo, servis, girdi(1_000));
    expect(await vdBakiye()).toBe(-TL(180));
    expect(await bakiye()).toBe(-TL(2_220));
  });

  it('çok oranlı faturanın iadesinde satır oranı faturadakilerden biri olmalı', async () => {
    const alis = await giderOlustur(depo, servis, {
      ...girdi(0),
      satirlar: [
        { kalemId: null, aciklama: '', miktar: null, birim: null, tutar: TL(1_000), kdvDahil: false, kdvOrani: 20, tevkifat: { pay: 4, payda: 10 } },
        { kalemId: null, aciklama: '', miktar: null, birim: null, tutar: TL(1_000), kdvDahil: false, kdvOrani: 20, tevkifat: { pay: 9, payda: 10 } },
      ],
    });
    await expect(iadeOlustur(depo, servis, tevkifatli(100, 5, { iadeEdilenGiderId: alis.id }))).rejects.toThrow('tevkifat oranlarından birini');
    const iade = await iadeOlustur(depo, servis, tevkifatli(100, 9, { iadeEdilenGiderId: alis.id }));
    expect(iade.tevkifatToplam).toBe(-TL(18));
  });

  it('iade iptal edilince vergi dairesi borcu geri gelir', async () => {
    const alis = await giderOlustur(depo, servis, tevkifatli(10_000, 4));
    const iade = await iadeOlustur(depo, servis, girdi(1_000, { iadeEdilenGiderId: alis.id }));
    await giderIptal(depo, servis, iade.id);
    expect(await vdBakiye()).toBe(TL(800));
    expect((await detay(alis.id)).tevkifatKalan).toBe(TL(800));
  });
});
