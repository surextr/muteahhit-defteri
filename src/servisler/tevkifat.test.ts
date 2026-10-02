import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { veriKatmaniniAc } from '../veri';
import type { Depo } from '../veri/depo';
import { yeniId } from '../veri/kimlik';
import type { Cari, Hesap } from '../veri/tipler';
import { cariGuncelle, cariIptal, cariOlustur, carileriListele, vergiDairesiGetir, vergiDairesiHazirla } from './cari';
import { giderDetayiGetir, giderGuncelle, giderIptal, giderOlustur, type GiderGirdisi } from './gider';
import { hesapOlustur } from './hesap';
import { KayitServisi, type Oturum } from './kayitServisi';
import { ilkKurulum } from './kurulum';
import { acikGiderler, acikOdemeler, cariEkstresiGetir, odemeDetayiGetir, odemeYap } from './odeme';
import { tevkifatBeyanlari } from './tevkifat';

const TL = (n: number) => Math.round(n * 100);
const BUGUN = '2026-11-10';

let depo: Depo;
let oturum: Oturum;
let servis: KayitServisi;
let tedarikci: Cari;
let vd: Cari;
let banka: Hesap;

beforeEach(async () => {
  depo = await veriKatmaniniAc(`test-${yeniId()}`);
  oturum = await ilkKurulum(depo, { firmaAdi: 'Firma', kullaniciAdi: 'Yönetici' });
  servis = new KayitServisi(depo, oturum);
  tedarikci = await cariOlustur(depo, servis, { ad: 'Taşeron AŞ', roller: ['usta'], telefon: null, vergiNo: null, adres: null, not: '' });
  vd = (await vergiDairesiGetir(depo, oturum.firmaId))!;
  banka = await hesapOlustur(depo, servis, { ad: 'Banka', tur: 'banka', paraBirimi: 'TRY', banka: null, iban: null }, { tutar: TL(1_000_000), tarih: '2026-09-01' });
});
afterEach(() => depo.kapat());

/** 100.000 + %20 KDV, 4/10 tevkifat → tevkifat 8.000, cariye 112.000. */
const girdi = (ek: Partial<GiderGirdisi> = {}, matrah = 100_000): GiderGirdisi => ({
  tarih: '2026-09-15',
  projeId: null,
  cariId: tedarikci.id,
  faturaNo: 'F1',
  vadeTarihi: null,
  aciklama: '',
  satirlar: [{ kalemId: null, aciklama: '', miktar: null, birim: null, tutar: TL(matrah), kdvDahil: false, kdvOrani: 20, tevkifat: { pay: 4, payda: 10 } }],
  ...ek,
});
const bakiye = async (id: string) => (await carileriListele(depo, oturum.firmaId)).find((c) => c.cari.id === id)!.bakiye;
const vdyeOde = (tutar: number, giderId: string | null) =>
  odemeYap(depo, servis, {
    tarih: '2026-10-20',
    cariId: vd.id,
    hesapId: banka.id,
    tutar: TL(tutar),
    aciklama: 'KDV 2',
    dagitim: giderId ? [{ hedefTur: 'tevkifat', giderId, tutar: TL(tutar) }] : [],
  });

describe('vergi dairesi kartı', () => {
  it('kurulumda hazır gelir; iptal edilemez, düzenlenince rolünü korur', async () => {
    expect(vd).toMatchObject({ ad: 'Vergi dairesi', roller: ['vergi_dairesi'] });
    await expect(cariIptal(depo, servis, vd.id)).rejects.toThrow('iptal edilemez');
    const g = await cariGuncelle(depo, servis, vd.id, { ad: 'Kadıköy VD', roller: [], telefon: null, vergiNo: null, adres: null, not: '' });
    expect(g.roller).toEqual(['vergi_dairesi']);
    // Kullanıcı kartı başka bir cariye bu rolü veremez.
    const t = await cariGuncelle(depo, servis, tedarikci.id, { ad: 'Taşeron AŞ', roller: ['usta', 'vergi_dairesi'], telefon: null, vergiNo: null, adres: null, not: '' });
    expect(t.roller).toEqual(['usta']);
  });

  it('hazırlama ikinci kez kart açmaz; kartı olmayan firmada aynı adlı cariyi vergi dairesi yapar', async () => {
    expect((await vergiDairesiHazirla(depo, servis)).id).toBe(vd.id);
    await servis.iptal('cari', vd.id); // eski sürümde kurulmuş firma gibi
    const elle = await cariOlustur(depo, servis, { ad: 'vergi  dairesi', roller: ['tedarikci'], telefon: null, vergiNo: null, adres: null, not: '' });
    const hazir = await vergiDairesiHazirla(depo, servis);
    expect(hazir).toMatchObject({ id: elle.id, roller: ['vergi_dairesi', 'tedarikci'] });
    expect((await depo.listele('cari', { firmaId: oturum.firmaId })).filter((c) => !c.iptal && c.roller.includes('vergi_dairesi'))).toHaveLength(1);
  });
});

describe('tevkifatın vergi dairesine borcu', () => {
  it('tevkifatlı gider vergi dairesine borç yazar; ödemesi tevkifatı kapatır, tedarikçinin borcu değişmez', async () => {
    const g = await giderOlustur(depo, servis, girdi());
    expect(await bakiye(tedarikci.id)).toBe(TL(112_000));
    expect(await bakiye(vd.id)).toBe(TL(8_000));

    const acik = await acikGiderler(depo, oturum.firmaId, vd.id, BUGUN);
    expect(acik).toEqual([
      expect.objectContaining({ hedefTur: 'tevkifat', kalan: TL(8_000), vade: '2026-10-28', saticiAdi: 'Taşeron AŞ', vadesiGecti: true }),
    ]);

    const o = await vdyeOde(8_000, g.id);
    expect(await bakiye(vd.id)).toBe(0);
    expect(await bakiye(tedarikci.id)).toBe(TL(112_000));
    const detay = (await giderDetayiGetir(depo, oturum.firmaId, g.id, BUGUN))!;
    expect(detay).toMatchObject({ kalan: TL(112_000), tevkifatKalan: 0, odemeler: [] });
    expect((await odemeDetayiGetir(depo, oturum.firmaId, o.id))!.eslesmeler).toEqual([
      expect.objectContaining({ saticiAdi: 'Taşeron AŞ', eslestirme: expect.objectContaining({ hedefTur: 'tevkifat' }) }),
    ]);
    expect(await acikGiderler(depo, oturum.firmaId, vd.id, BUGUN)).toEqual([]);
    expect((await cariEkstresiGetir(depo, oturum.firmaId, vd.id)).map((x) => [x.tur, x.tutar])).toEqual([
      ['tevkifat', TL(8_000)],
      ['odeme', -TL(8_000)],
    ]);
    const [eylul] = await tevkifatBeyanlari(depo, oturum.firmaId);
    expect(eylul).toMatchObject({ donem: '2026-09', toplam: TL(8_000), odenen: TL(8_000), kalan: 0, saticiAdlari: { [g.id]: 'Taşeron AŞ' } });
  });

  it('tevkifat yalnızca vergi dairesine ödemeyle kapanır; fazlası yazılamaz', async () => {
    const g = await giderOlustur(depo, servis, girdi());
    await expect(
      odemeYap(depo, servis, {
        tarih: '2026-10-20',
        cariId: tedarikci.id,
        hesapId: banka.id,
        tutar: TL(1_000),
        aciklama: '',
        dagitim: [{ hedefTur: 'tevkifat', giderId: g.id, tutar: TL(1_000) }],
      }),
    ).rejects.toThrow('yalnızca vergi dairesine');
    await expect(vdyeOde(9_000, g.id)).rejects.toThrow('tevkifatı için kalan borç');
  });

  it('gider iptalinde tevkifat borcu kalkar, vergi dairesine ödeme avans kalır', async () => {
    const g = await giderOlustur(depo, servis, girdi());
    const o = await vdyeOde(8_000, g.id);
    await giderIptal(depo, servis, g.id, undefined, true);
    expect((await depo.getir('odeme', o.id))!.iptal).toBeNull();
    expect(await bakiye(vd.id)).toBe(-TL(8_000));
    expect(await acikOdemeler(depo, oturum.firmaId, vd.id)).toEqual([expect.objectContaining({ acik: TL(8_000) })]);
  });

  it('tevkifat ödenenin altına düşürülemez', async () => {
    const g = await giderOlustur(depo, servis, girdi());
    await vdyeOde(8_000, g.id);
    await expect(giderGuncelle(depo, servis, g.id, girdi({}, 50_000))).rejects.toThrow('vergi dairesine yapılan ödeme');
    await giderGuncelle(depo, servis, g.id, girdi({}, 150_000));
    expect(await bakiye(vd.id)).toBe(TL(4_000));
  });

  it('vergi dairesi kartı yoksa tevkifatlı gider açar', async () => {
    await servis.iptal('cari', vd.id);
    await giderOlustur(depo, servis, girdi());
    const yeni = (await vergiDairesiGetir(depo, oturum.firmaId))!;
    expect(yeni.id).not.toBe(vd.id);
    expect(await bakiye(yeni.id)).toBe(TL(8_000));
  });
});
