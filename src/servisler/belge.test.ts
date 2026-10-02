import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { veriKatmaniniAc, yedekArsiviniAc } from '../veri';
import type { Depo } from '../veri/depo';
import { yeniId } from '../veri/kimlik';
import type { Cari } from '../veri/tipler';
import { belgeDetayiGetir, belgeDosyasiGetir, belgeEkle, belgeGuncelle, belgeIptal, belgeleriListele, tumBelgeler, type BelgeGirdisi } from './belge';
import { cariOlustur } from './cari';
import { giderIptal, giderOlustur } from './gider';
import { KayitServisi, type Oturum } from './kayitServisi';
import { ilkKurulum } from './kurulum';
import { elleYedekAl, geriYukle, yedegiCoz, yedekOzeti } from './yedek';

let depo: Depo;
let oturum: Oturum;
let servis: KayitServisi;
let tedarikci: Cari;

beforeEach(async () => {
  depo = await veriKatmaniniAc(`test-${yeniId()}`);
  oturum = await ilkKurulum(depo, { firmaAdi: 'Firma', kullaniciAdi: 'Yönetici' });
  servis = new KayitServisi(depo, oturum);
  tedarikci = await cariOlustur(depo, servis, { ad: 'Beton AŞ', roller: ['tedarikci'], telefon: null, vergiNo: null, adres: null, not: '' });
});
afterEach(() => depo.kapat());

const jpeg = (bayt = 4) => new Blob([new Uint8Array(bayt).fill(0xff)], { type: 'image/jpeg' });
const gider = () =>
  giderOlustur(depo, servis, {
    tarih: '2026-10-01',
    projeId: null,
    cariId: tedarikci.id,
    faturaNo: 'F-12',
    vadeTarihi: null,
    aciklama: '',
    satirlar: [{ kalemId: null, aciklama: '', miktar: null, birim: null, tutar: 100_000, kdvDahil: false, kdvOrani: 0, tevkifat: null }],
  });
const girdi = (bagliId: string, ek: Partial<BelgeGirdisi> = {}): BelgeGirdisi => ({
  bagliTur: 'gider',
  bagliId,
  tur: 'fatura',
  tarih: '2026-10-01',
  ad: 'fatura.jpg',
  dosya: jpeg(),
  ...ek,
});

describe('belgeler', () => {
  it('gidere fatura fotoğrafı eklenir; künye listelenir, dosya ayrı okunur', async () => {
    const g = await gider();
    const b = await belgeEkle(depo, servis, girdi(g.id));
    expect(b).toMatchObject({ bagliTur: 'gider', bagliId: g.id, mime: 'image/jpeg', boyut: 4, ad: 'fatura.jpg' });
    expect(await belgeleriListele(depo, oturum.firmaId, 'gider', g.id)).toEqual([b]);
    const dosya = await belgeDosyasiGetir(depo, oturum.firmaId, b.id);
    expect(dosya?.size).toBe(4);
    expect(await belgeDetayiGetir(depo, oturum.firmaId, b.id)).toMatchObject({ bagliAdi: 'Gider 01.10.2026 · F-12 · Beton AŞ', yol: `giderler/${g.id}` });
    // İşlem geçmişine künye yazılır.
    expect((await depo.listele('islemGecmisi', { kayitId: b.id })).map((x) => x.islem)).toEqual(['olustur']);
  });

  it('yalnızca resim ve PDF; boş, çok büyük ya da olmayan kayda bağlı belge reddedilir', async () => {
    const g = await gider();
    await expect(belgeEkle(depo, servis, girdi(g.id, { dosya: new Blob(['<svg/>'], { type: 'image/svg+xml' }) }))).rejects.toThrow('PDF');
    await expect(belgeEkle(depo, servis, girdi(g.id, { dosya: new Blob([], { type: 'application/pdf' }) }))).rejects.toThrow('boş');
    await expect(belgeEkle(depo, servis, girdi('yok'))).rejects.toThrow('bulunamadı');
    await expect(belgeEkle(depo, servis, girdi(g.id, { bagliTur: 'transfer' as never }))).rejects.toThrow('bağlanamaz');
    const pdf = await belgeEkle(depo, servis, girdi(g.id, { dosya: new Blob(['%PDF-1.4'], { type: 'application/pdf' }), ad: '' }));
    expect(pdf.ad).toBe('Fatura');
  });

  it('ad/tür düzenlenir, iptal edilen listeden çıkar; gider iptal edilince belgesi de iptal olur', async () => {
    const g = await gider();
    const b1 = await belgeEkle(depo, servis, girdi(g.id));
    const b2 = await belgeEkle(depo, servis, girdi(g.id, { tur: 'fis' }));
    expect(await belgeGuncelle(servis, b1.id, { ad: 'Fatura ön yüz', tur: 'fatura' })).toMatchObject({ ad: 'Fatura ön yüz' });
    await belgeIptal(servis, b2.id);
    expect((await belgeleriListele(depo, oturum.firmaId, 'gider', g.id)).map((b) => b.id)).toEqual([b1.id]);
    await giderIptal(depo, servis, g.id);
    expect((await depo.getir('belge', b1.id))?.iptal).not.toBeNull();
    expect(await tumBelgeler(depo, oturum.firmaId)).toEqual([]);
  });

  it('yedekte dosyasıyla taşınır ve geri yüklenir', async () => {
    const g = await gider();
    const b = await belgeEkle(depo, servis, girdi(g.id, { dosya: jpeg(10) }));
    const { metin } = await elleYedekAl(depo);
    const yedek = yedegiCoz(metin, depo.semaSurumu);
    const ad = `test-${yeniId()}`;
    const hedef = await veriKatmaniniAc(ad);
    const arsiv = await yedekArsiviniAc(ad);
    await geriYukle(hedef, arsiv, yedek);
    expect((await belgeDosyasiGetir(hedef, oturum.firmaId, b.id))?.size).toBe(10);
    hedef.kapat();
    arsiv.kapat();
  });

  it('"sadece veri" yedeğinde dosya yoktur; geri yüklenince cihazdaki dosyalar korunur', async () => {
    const g = await gider();
    const b = await belgeEkle(depo, servis, girdi(g.id, { dosya: jpeg(10) }));
    const tam = await elleYedekAl(depo);
    const { metin, dosyaAdi } = await elleYedekAl(depo, undefined, { belgeler: false });
    expect(metin.length).toBeLessThan(tam.metin.length);
    expect(dosyaAdi).toMatch(/-sadece-veri\.json$/);
    const yedek = yedegiCoz(metin, depo.semaSurumu);
    expect(yedek.tablolar.belgeDosyasi).toEqual([]);
    expect(yedekOzeti(yedek)).toMatchObject({ belgelerDahil: false, belgeSayisi: 1 });

    // Aynı cihaza geri yükleme: belge dosyası silinmez.
    const arsiv = await yedekArsiviniAc(`test-${yeniId()}`);
    await geriYukle(depo, arsiv, yedek);
    expect((await belgeDosyasiGetir(depo, oturum.firmaId, b.id))?.size).toBe(10);
    arsiv.kapat();
  });
});
