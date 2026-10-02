import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { veriKatmaniniAc } from '../veri';
import type { Depo } from '../veri/depo';
import { yeniId } from '../veri/kimlik';
import type { Cari, Hesap } from '../veri/tipler';
import { cariOlustur, carileriListele } from './cari';
import {
  cekAl,
  cekCiro,
  cekDetayiGetir,
  cekGeriDondu,
  cekIptal,
  cekleriListele,
  cekOde,
  cekPanosu,
  cekSonIslemiGeriAl,
  cekTahsil,
  cekTahsileVer,
  cekVer,
  type CekGirdisi,
} from './cek';
import { giderDetayiGetir, giderOlustur } from './gider';
import { hesapOlustur, hesaplariListele } from './hesap';
import { KayitServisi, type Oturum } from './kayitServisi';
import { ilkKurulum } from './kurulum';
import { acikOdemeler, avansEslestir } from './odeme';

const TL = (n: number) => Math.round(n * 100);
const BUGUN = '2026-10-10';

let depo: Depo;
let oturum: Oturum;
let servis: KayitServisi;
let musteri: Cari;
let tedarikci: Cari;
let banka: Hesap;

const cari = (ad: string, rol: Cari['roller'][number]) =>
  cariOlustur(depo, servis, { ad, roller: [rol], telefon: null, vergiNo: null, adres: null, not: '' });

beforeEach(async () => {
  depo = await veriKatmaniniAc(`test-${yeniId()}`);
  oturum = await ilkKurulum(depo, { firmaAdi: 'Firma', kullaniciAdi: 'Yönetici' });
  servis = new KayitServisi(depo, oturum);
  musteri = await cari('Ali Bey', 'musteri');
  tedarikci = await cari('Beton AŞ', 'tedarikci');
  banka = await hesapOlustur(depo, servis, { ad: 'Banka', tur: 'banka', paraBirimi: 'TRY', banka: null, iban: null }, { tutar: TL(100_000), tarih: '2026-10-01' });
});
afterEach(() => depo.kapat());

const girdi = (cariId: string, tutar: number, ek: Partial<CekGirdisi> = {}): CekGirdisi => ({
  tur: 'cek',
  cariId,
  tarih: '2026-10-02',
  vadeTarihi: '2026-11-15',
  tutar: TL(tutar),
  banka: 'Ziraat',
  sube: 'Kadıköy',
  seriNo: 'A-1001',
  kesideci: null,
  projeId: null,
  aciklama: '',
  ...ek,
});
const bakiye = async (id: string) => (await carileriListele(depo, oturum.firmaId)).find((c) => c.cari.id === id)!.bakiye;
const bankaBakiye = async () => (await hesaplariListele(depo, oturum.firmaId)).find((h) => h.hesap.id === banka.id)!.bakiye;
/** KDV'siz basit fatura. */
const fatura = (tutar: number) =>
  giderOlustur(depo, servis, {
    tarih: '2026-10-01',
    projeId: null,
    cariId: tedarikci.id,
    faturaNo: null,
    vadeTarihi: null,
    aciklama: '',
    satirlar: [{ kalemId: null, aciklama: '', miktar: null, birim: null, tutar: TL(tutar), kdvDahil: false, kdvOrani: 0, tevkifat: null }],
  });
const kalan = async (id: string) => (await giderDetayiGetir(depo, oturum.firmaId, id, BUGUN))!.kalan;

describe('alınan çek', () => {
  it('alınınca cari alacağı düşer, para hesaba girmez; tahsil edilince bankaya girer', async () => {
    const cek = await cekAl(depo, servis, girdi(musteri.id, 50_000));
    expect(cek).toMatchObject({ yon: 'alinan', durum: 'portfoyde', tutar: TL(50_000) });
    expect(await bakiye(musteri.id)).toBe(TL(50_000)); // tahsilat: müşteriye borç (henüz satış yok)
    expect(await bankaBakiye()).toBe(TL(100_000));
    await cekTahsil(depo, servis, cek.id, { tarih: '2026-11-15', hesapId: banka.id });
    expect(await bankaBakiye()).toBe(TL(150_000));
    const d = (await cekDetayiGetir(depo, oturum.firmaId, cek.id, BUGUN))!;
    expect(d.cek.durum).toBe('tahsil_edildi');
    expect(d.hareketler.map((x) => [x.durum, x.hesapAdi])).toEqual([
      ['portfoyde', null],
      ['tahsil_edildi', 'Banka'],
    ]);
    await expect(cekTahsil(depo, servis, cek.id, { tarih: '2026-11-16', hesapId: banka.id })).rejects.toThrow('tahsil edilemez');
  });

  it('ciro tedarikçiye ödemedir, faturasını kapatır; karşılıksız çıkarsa borç geri gelir, fatura yeniden açılır', async () => {
    const f = await fatura(50_000);
    const cek = await cekAl(depo, servis, girdi(musteri.id, 50_000));
    await cekCiro(depo, servis, cek.id, { tarih: '2026-10-05', cariId: tedarikci.id, dagitim: [{ giderId: f.id, tutar: TL(50_000) }] });
    expect(await kalan(f.id)).toBe(0);
    expect(await bakiye(tedarikci.id)).toBe(0);

    await cekGeriDondu(depo, servis, cek.id, { tarih: '2026-11-16', durum: 'karsiliksiz' });
    expect(await bakiye(tedarikci.id)).toBe(TL(50_000));
    expect(await kalan(f.id)).toBe(TL(50_000));
    expect(await bakiye(musteri.id)).toBe(0); // müşterinin tahsilatı geri alındı
    // Ciro ödemesi avans görünmez, faturaya bağlanamaz.
    expect(await acikOdemeler(depo, oturum.firmaId, tedarikci.id)).toEqual([]);
    const ciro = (await depo.listele('odeme', { cekSenetId: cek.id })).find((o) => o.yontem === 'ciro')!;
    await expect(avansEslestir(depo, servis, ciro.id, [{ giderId: f.id, tutar: 1 }])).rejects.toThrow('çeki geri döndü');
  });

  it('çeki veren cariye ciro edilemez', async () => {
    const cek = await cekAl(depo, servis, girdi(musteri.id, 1_000));
    await expect(cekCiro(depo, servis, cek.id, { tarih: '2026-10-05', cariId: musteri.id, dagitim: [] })).rejects.toThrow('İade edildi');
  });
});

describe('verilen çek', () => {
  it('verilince borç düşer ama para çıkmaz; ödenince bankadan çıkar', async () => {
    const f = await fatura(30_000);
    const cek = await cekVer(depo, servis, girdi(tedarikci.id, 30_000), [{ giderId: f.id, tutar: TL(30_000) }]);
    expect(cek.durum).toBe('verildi');
    expect(await kalan(f.id)).toBe(0);
    expect(await bankaBakiye()).toBe(TL(100_000));
    await cekOde(depo, servis, cek.id, { tarih: '2026-11-15', hesapId: banka.id });
    expect(await bankaBakiye()).toBe(TL(70_000));
    expect(await bakiye(tedarikci.id)).toBe(0);
  });

  it('karşılıksız dönerse borç ve fatura geri gelir; geri alınınca ödeme avans olur, yeniden bağlanır', async () => {
    const f = await fatura(30_000);
    const cek = await cekVer(depo, servis, girdi(tedarikci.id, 30_000), [{ giderId: f.id, tutar: TL(30_000) }]);
    await cekGeriDondu(depo, servis, cek.id, { tarih: '2026-11-16', durum: 'karsiliksiz' });
    expect(await bakiye(tedarikci.id)).toBe(TL(30_000));
    expect(await kalan(f.id)).toBe(TL(30_000));

    await cekSonIslemiGeriAl(depo, servis, cek.id, 'Yanlış girildi');
    expect((await cekDetayiGetir(depo, oturum.firmaId, cek.id, BUGUN))!.cek.durum).toBe('verildi');
    expect(await bakiye(tedarikci.id)).toBe(0);
    const [avans] = await acikOdemeler(depo, oturum.firmaId, tedarikci.id);
    expect(avans!.acik).toBe(TL(30_000));
    await avansEslestir(depo, servis, avans!.odeme.id, [{ giderId: f.id, tutar: TL(30_000) }]);
    expect(await kalan(f.id)).toBe(0);
  });

  it('kredi kartından ödenmez; tarih son işlemden önce olamaz', async () => {
    const kart = await hesapOlustur(depo, servis, { ad: 'Kart', tur: 'kredi_karti', paraBirimi: 'TRY', banka: null, iban: null });
    const cek = await cekVer(depo, servis, girdi(tedarikci.id, 1_000));
    await expect(cekOde(depo, servis, cek.id, { tarih: '2026-11-15', hesapId: kart.id })).rejects.toThrow('kasa ya da banka');
    await expect(cekOde(depo, servis, cek.id, { tarih: '2026-10-01', hesapId: banka.id })).rejects.toThrow('son işlemden');
  });
});

describe('geri alma, iptal ve liste', () => {
  it('ciro geri alınınca ciro ödemesi iptal olur, çek portföye döner', async () => {
    const cek = await cekAl(depo, servis, girdi(musteri.id, 5_000));
    await cekCiro(depo, servis, cek.id, { tarih: '2026-10-05', cariId: tedarikci.id, dagitim: [] });
    expect(await bakiye(tedarikci.id)).toBe(-TL(5_000));
    await cekSonIslemiGeriAl(depo, servis, cek.id);
    expect(await bakiye(tedarikci.id)).toBe(0);
    expect((await cekDetayiGetir(depo, oturum.firmaId, cek.id, BUGUN))!.cek.durum).toBe('portfoyde');
    await expect(cekSonIslemiGeriAl(depo, servis, cek.id)).rejects.toThrow('Geri alınacak işlem yok');
  });

  it('işlem görmemiş çek iptal edilir, tahsilatı da iptal olur; işlem görmüş çek iptal edilmez', async () => {
    const c1 = await cekAl(depo, servis, girdi(musteri.id, 5_000));
    await cekIptal(depo, servis, c1.id);
    expect(await bakiye(musteri.id)).toBe(0);
    const c2 = await cekAl(depo, servis, girdi(musteri.id, 5_000));
    await cekTahsil(depo, servis, c2.id, { tarih: '2026-11-15', hesapId: banka.id });
    await expect(cekIptal(depo, servis, c2.id)).rejects.toThrow('önce son işlemi geri alın');
  });

  it('liste: açıklar en yakın vade önce, vadeye kalan gün; kapalılar sonda', async () => {
    const yakin = await cekVer(depo, servis, girdi(tedarikci.id, 1_000, { vadeTarihi: '2026-10-12' }));
    const uzak = await cekAl(depo, servis, girdi(musteri.id, 1_000, { vadeTarihi: '2026-12-01' }));
    const gecmis = await cekAl(depo, servis, girdi(musteri.id, 1_000, { tarih: '2026-09-01', vadeTarihi: '2026-10-05' }));
    const kapali = await cekAl(depo, servis, girdi(musteri.id, 1_000, { vadeTarihi: '2026-10-03' }));
    await cekTahsil(depo, servis, kapali.id, { tarih: '2026-10-03', hesapId: banka.id });
    const liste = await cekleriListele(depo, oturum.firmaId, BUGUN);
    expect(liste.map((x) => [x.cek.id, x.vadeyeGun])).toEqual([
      [gecmis.id, -5],
      [yakin.id, 2],
      [uzak.id, 52],
      [kapali.id, null],
    ]);
  });
});

describe('tahsile verme, keşideci, vade özeti ve karşılık uyarısı', () => {
  it('bankaya tahsile verilen çekte para girmez; tahsilde ya da karşılıksız döner', async () => {
    const kasa = await hesapOlustur(depo, servis, { ad: 'Kasa', tur: 'kasa', paraBirimi: 'TRY', banka: null, iban: null });
    const cek = await cekAl(depo, servis, girdi(musteri.id, 8_000));
    await expect(cekTahsileVer(depo, servis, cek.id, { tarih: '2026-10-05', hesapId: kasa.id })).rejects.toThrow('Banka hesabı');
    await cekTahsileVer(depo, servis, cek.id, { tarih: '2026-10-05', hesapId: banka.id });
    let d = (await cekDetayiGetir(depo, oturum.firmaId, cek.id, BUGUN))!;
    expect(d).toMatchObject({ cek: { durum: 'tahsilde' }, hesap: { id: banka.id, ad: 'Banka' } });
    expect(await bankaBakiye()).toBe(TL(100_000));
    // Tahsildeki çek ciro edilemez.
    await expect(cekCiro(depo, servis, cek.id, { tarih: '2026-10-06', cariId: tedarikci.id, dagitim: [] })).rejects.toThrow('ciro edilemez');
    await cekTahsil(depo, servis, cek.id, { tarih: '2026-11-15', hesapId: banka.id });
    expect(await bankaBakiye()).toBe(TL(108_000));

    const c2 = await cekAl(depo, servis, girdi(musteri.id, 1_000));
    await cekTahsileVer(depo, servis, c2.id, { tarih: '2026-10-05', hesapId: banka.id });
    await cekGeriDondu(depo, servis, c2.id, { tarih: '2026-11-16', durum: 'karsiliksiz' });
    d = (await cekDetayiGetir(depo, oturum.firmaId, c2.id, BUGUN))!;
    expect(d.cek.durum).toBe('karsiliksiz');
  });

  it('keşideci, şube saklanır; boşsa alınanda çeki veren cari, verilende firma görünür', async () => {
    const ciroyla = await cekAl(depo, servis, girdi(musteri.id, 1_000, { kesideci: 'Yılmaz Yapı Ltd.' }));
    const kendi = await cekAl(depo, servis, girdi(musteri.id, 1_000));
    const verilen = await cekVer(depo, servis, girdi(tedarikci.id, 1_000, { hesapId: banka.id }));
    expect(ciroyla).toMatchObject({ kesideci: 'Yılmaz Yapı Ltd.', sube: 'Kadıköy', hesapId: null });
    const ad = async (id: string) => (await cekDetayiGetir(depo, oturum.firmaId, id, BUGUN))!.kesideci;
    expect([await ad(ciroyla.id), await ad(kendi.id), await ad(verilen.id)]).toEqual(['Yılmaz Yapı Ltd.', 'Ali Bey', 'Firma']);
    expect((await cekDetayiGetir(depo, oturum.firmaId, verilen.id, BUGUN))!.hesap).toEqual({ id: banka.id, ad: 'Banka' });
  });

  it('pano: bu ay ödenecek/tahsil edilecek, geçmiş vadeler ayrı; vadesi yakın çeke banka yetmiyorsa uyarı', async () => {
    await cekVer(depo, servis, girdi(tedarikci.id, 60_000, { vadeTarihi: '2026-10-14', hesapId: banka.id }));
    await cekVer(depo, servis, girdi(tedarikci.id, 50_000, { vadeTarihi: '2026-10-16', hesapId: banka.id }));
    await cekVer(depo, servis, girdi(tedarikci.id, 5_000, { vadeTarihi: '2026-11-20' }));
    await cekAl(depo, servis, girdi(musteri.id, 7_000, { vadeTarihi: '2026-10-30' }));
    await cekAl(depo, servis, girdi(musteri.id, 3_000, { tarih: '2026-09-01', vadeTarihi: '2026-10-01' }));
    const p = await cekPanosu(depo, oturum.firmaId, BUGUN);
    expect(p.vade.gecikmis).toMatchObject({ tahsilEdilecek: TL(3_000), tahsilAdet: 1, odenecek: 0 });
    expect(p.vade.aylar.map((a) => [a.ay, a.odenecek, a.odenecekAdet, a.tahsilEdilecek])).toEqual([
      ['2026-10', TL(110_000), 2, TL(7_000)],
      ['2026-11', TL(5_000), 1, 0],
      ['2026-12', 0, 0, 0],
    ]);
    // 10.10'da 7 gün içi: 14.10 ve 16.10 → 110.000; banka 100.000 → 10.000 eksik.
    expect(p.uyarilar).toEqual([expect.objectContaining({ hesapAdi: 'Banka', gereken: TL(110_000), bakiye: TL(100_000), eksik: TL(10_000) })]);
  });
});
