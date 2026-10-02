import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { veriKatmaniniAc } from '../veri';
import type { Depo } from '../veri/depo';
import { yeniId } from '../veri/kimlik';
import type { Cari, Hesap } from '../veri/tipler';
import { cariOlustur, carileriListele } from './cari';
import { giderDetayiGetir, giderIptal, giderOlustur, type GiderGirdisi } from './gider';
import { hesapOlustur, hesaplariListele } from './hesap';
import { KayitServisi, type Oturum } from './kayitServisi';
import { ilkKurulum } from './kurulum';
import {
  acikGiderler,
  acikOdemeler,
  avansEslestir,
  cariEkstresiGetir,
  odemeDetayiGetir,
  odemeYap,
  tahsilatKaydet,
  type OdemeGirdisi,
  type TahsilatGirdisi,
} from './odeme';

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
  tedarikci = await cariOlustur(depo, servis, { ad: 'Beton AŞ', roller: ['tedarikci'], telefon: null, vergiNo: null, adres: null, not: '' });
  banka = await hesapOlustur(depo, servis, { ad: 'Banka', tur: 'banka', paraBirimi: 'TRY', banka: null, iban: null }, { tutar: TL(1_000_000), tarih: '2026-10-01' });
});
afterEach(() => depo.kapat());

/** KDV'siz basit gider: borç = tutar. */
const gider = (tutar: number, ek: Partial<GiderGirdisi> = {}) =>
  giderOlustur(depo, servis, {
    tarih: '2026-10-01',
    projeId: null,
    cariId: tedarikci.id,
    faturaNo: null,
    vadeTarihi: null,
    aciklama: '',
    satirlar: [{ kalemId: null, aciklama: '', miktar: null, birim: null, tutar: TL(tutar), kdvDahil: false, kdvOrani: 0, tevkifat: null }],
    ...ek,
  });
const odeme = (tutar: number, dagitim: OdemeGirdisi['dagitim'], ek: Partial<OdemeGirdisi> = {}) =>
  odemeYap(depo, servis, { tarih: '2026-10-05', cariId: tedarikci.id, hesapId: banka.id, tutar: TL(tutar), aciklama: '', dagitim, ...ek });
const kalan = async (id: string) => (await giderDetayiGetir(depo, oturum.firmaId, id, BUGUN))!.kalan;
const cariBakiye = async (id = tedarikci.id) => (await carileriListele(depo, oturum.firmaId)).find((c) => c.cari.id === id)!.bakiye;
const bankaBakiye = async () => (await hesaplariListele(depo, oturum.firmaId)).find((h) => h.hesap.id === banka.id)!.bakiye;

describe('ödeme ve eşleştirme (plan örneği)', () => {
  it('100.000 alış, 30.000 ödeme → kalan 70.000; sonraki 70.000 borcu kapatır, yeni maliyet oluşmaz', async () => {
    const g = await gider(100_000);
    await odeme(30_000, [{ giderId: g.id, tutar: TL(30_000) }]);
    expect(await kalan(g.id)).toBe(TL(70_000));
    await odeme(70_000, [{ giderId: g.id, tutar: TL(70_000) }]);
    expect(await kalan(g.id)).toBe(0);
    expect(await cariBakiye()).toBe(0);
    expect(await bankaBakiye()).toBe(TL(900_000));
    expect((await depo.listele('gider')).length).toBe(1);
  });

  it('bir ödeme birden çok gideri kapatır; artanı avans kalır', async () => {
    const g1 = await gider(300);
    const g2 = await gider(500);
    const o = await odeme(1_000, [
      { giderId: g1.id, tutar: TL(300) },
      { giderId: g2.id, tutar: TL(500) },
    ]);
    expect([await kalan(g1.id), await kalan(g2.id)]).toEqual([0, 0]);
    expect((await odemeDetayiGetir(depo, oturum.firmaId, o.id))!.acik).toBe(TL(200));
    expect(await cariBakiye()).toBe(-TL(200));
    expect(await acikOdemeler(depo, oturum.firmaId, tedarikci.id)).toEqual([expect.objectContaining({ acik: TL(200) })]);
  });

  it('avans sonradan yeni gidere bağlanır', async () => {
    const o = await odeme(500, []);
    const g = await gider(800);
    await avansEslestir(depo, servis, o.id, [{ giderId: g.id, tutar: TL(500) }]);
    expect(await kalan(g.id)).toBe(TL(300));
    expect(await acikOdemeler(depo, oturum.firmaId, tedarikci.id)).toEqual([]);
    await expect(avansEslestir(depo, servis, o.id, [{ giderId: g.id, tutar: TL(1) }])).rejects.toThrow('açıkta kalan');
  });

  it('kalan borçtan ve ödeme tutarından fazlası dağıtılamaz; hiçbir şey yazılmaz', async () => {
    const g = await gider(100);
    await expect(odeme(200, [{ giderId: g.id, tutar: TL(150) }])).rejects.toThrow('fazlası yazılamaz');
    await expect(odeme(50, [{ giderId: g.id, tutar: TL(80) }])).rejects.toThrow('ödeme tutarından büyük');
    expect(await depo.listele('odeme')).toEqual([]);
    expect(await bankaBakiye()).toBe(TL(1_000_000));
  });

  it('başka carinin gideri bu ödemeye bağlanamaz', async () => {
    const baska = await cariOlustur(depo, servis, { ad: 'Demir', roller: ['tedarikci'], telefon: null, vergiNo: null, adres: null, not: '' });
    const g = await gider(100, { cariId: baska.id });
    await expect(odeme(100, [{ giderId: g.id, tutar: TL(100) }])).rejects.toThrow('bu cariye ait değil');
  });

  it('açık giderler en eski vadeden sıralanır; vadesi geçen işaretlenir', async () => {
    const yeni = await gider(100, { tarih: '2026-10-01', vadeTarihi: '2026-11-01' });
    const eski = await gider(200, { tarih: '2026-10-02', vadeTarihi: '2026-10-05' });
    const liste = await acikGiderler(depo, oturum.firmaId, tedarikci.id, BUGUN);
    expect(liste.map((x) => [x.gider.id, x.kalan, x.vadesiGecti])).toEqual([
      [eski.id, TL(200), true],
      [yeni.id, TL(100), false],
    ]);
  });

  it('ödeme iptali: eşleştirmeler iptal olur, borç ve banka eski haline döner', async () => {
    const g = await gider(100);
    const o = await odeme(100, [{ giderId: g.id, tutar: TL(100) }]);
    await servis.iptal('odeme', o.id);
    expect(await kalan(g.id)).toBe(TL(100));
    expect(await bankaBakiye()).toBe(TL(1_000_000));
  });

  it('gider iptal edilince ödeme avansa döner ve başka gidere bağlanabilir', async () => {
    const g1 = await gider(100);
    const o = await odeme(100, [{ giderId: g1.id, tutar: TL(100) }]);
    await giderIptal(depo, servis, g1.id);
    const g2 = await gider(100);
    await avansEslestir(depo, servis, o.id, [{ giderId: g2.id, tutar: TL(100) }]);
    expect(await kalan(g2.id)).toBe(0);
  });
});

describe('tahsilat', () => {
  const tahsilat = (ek: Partial<TahsilatGirdisi>) =>
    tahsilatKaydet(depo, servis, { tarih: '2026-10-05', amac: 'cari', cariId: null, hesapId: banka.id, tutar: TL(1_000), projeId: null, aciklama: '', ...ek });

  it('ortak sermayesi ortağa borç olarak görünür; ortak rolü gerekir', async () => {
    const ortak = await cariOlustur(depo, servis, { ad: 'Veli', roller: ['ortak'], telefon: null, vergiNo: null, adres: null, not: '' });
    await tahsilat({ amac: 'ortakSermaye', cariId: ortak.id, tutar: TL(250_000) });
    expect(await cariBakiye(ortak.id)).toBe(TL(250_000));
    expect(await bankaBakiye()).toBe(TL(1_250_000));
    await expect(tahsilat({ amac: 'ortakSermaye', cariId: tedarikci.id })).rejects.toThrow('ortak" rolü yok');
  });

  it('kredi kullanımı carisiz olabilir; cariden tahsilatta cari zorunlu', async () => {
    await tahsilat({ amac: 'krediKullanim', tutar: TL(500_000) });
    expect(await bankaBakiye()).toBe(TL(1_500_000));
    await expect(tahsilat({ amac: 'cari' })).rejects.toThrow('kimden geldiğini');
  });

  it('tedarikçiden avans iadesi alacağı kapatır', async () => {
    await odeme(300, []);
    expect(await cariBakiye()).toBe(-TL(300));
    await tahsilat({ cariId: tedarikci.id, tutar: TL(300) });
    expect(await cariBakiye()).toBe(0);
  });
});

describe('cari ekstresi', () => {
  it('gider, ödeme ve açılış yürüyen bakiyeyle', async () => {
    const g = await gider(1_000, { faturaNo: 'F-7' });
    await odeme(400, [{ giderId: g.id, tutar: TL(400) }], { aciklama: 'Havale' });
    const e = await cariEkstresiGetir(depo, oturum.firmaId, tedarikci.id);
    expect(e.map((x) => [x.tur, x.tutar, x.bakiye, x.aciklama])).toEqual([
      ['gider', TL(1_000), TL(1_000), 'Fatura F-7'],
      ['odeme', -TL(400), TL(600), 'Havale'],
    ]);
  });
});
