import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { veriKatmaniniAc } from '../veri';
import type { Depo } from '../veri/depo';
import { yeniId } from '../veri/kimlik';
import type { Cari, HavuzTanima } from '../veri/tipler';
import { belgeleriListele } from './belge';
import { cariOlustur } from './cari';
import { giderOlustur } from './gider';
import { bekleyenler, bekleyenSayisi, havuzaEkle, havuzBagla, havuzdanKaldir, havuzOnerisi } from './havuz';
import { KayitServisi, type Oturum } from './kayitServisi';
import { ilkKurulum } from './kurulum';

let depo: Depo;
let oturum: Oturum;
let servis: KayitServisi;
let demirci: Cari;

beforeEach(async () => {
  depo = await veriKatmaniniAc(`test-${yeniId()}`);
  oturum = await ilkKurulum(depo, { firmaAdi: 'Firma', kullaniciAdi: 'Yönetici' });
  servis = new KayitServisi(depo, oturum);
  demirci = await cariOlustur(depo, servis, { ad: 'Demirci', roller: ['tedarikci'], telefon: null, vergiNo: '1234567890', adres: null, not: '' });
});
afterEach(() => depo.kapat());

const dosya = (icerik: string, type = 'image/jpeg') => new Blob([icerik], { type });
const tanima = (ek: Partial<HavuzTanima> = {}): HavuzTanima => ({
  kaynak: 'karekod',
  satici: { vergiNo: '1234567890', ad: null, adres: null, telefon: null, vergiDairesi: null },
  aliciVergiNo: null,
  faturaNo: 'ABC123',
  tarih: '2026-10-20',
  ettn: null,
  iade: false,
  paraBirimi: 'TRY',
  kdvler: [{ oran: 20, matrah: 100_000, kdv: 20_000 }],
  tevkifat: 0,
  odenecek: 120_000,
  satirlar: [],
  ...ek,
});

describe('belge havuzu', () => {
  it('yüklenen dosya belge olarak havuza düşer; aynı dosya ikinci kez eklenmez', async () => {
    const { eklenen, tekrar } = await havuzaEkle(depo, servis, [
      { dosya: dosya('a'), ad: 'fis.jpg', tanima: null },
      { dosya: dosya('<Invoice/>', 'application/xml'), ad: 'f.xml', tanima: tanima({ kaynak: 'xml' }) },
    ]);
    expect(eklenen).toHaveLength(2);
    expect(tekrar).toEqual([]);
    const liste = await bekleyenler(depo, oturum.firmaId);
    expect(liste.map((s) => [s.belge.ad, s.belge.tur, s.belge.bagliTur])).toEqual(
      expect.arrayContaining([
        ['fis.jpg', 'fotograf', 'belgeHavuzu'],
        ['f.xml', 'fatura', 'belgeHavuzu'],
      ]),
    );
    const ikinci = await havuzaEkle(depo, servis, [{ dosya: dosya('a'), ad: 'yine.jpg', tanima: null }]);
    expect(ikinci).toEqual({ eklenen: [], tekrar: ['yine.jpg'] });
    expect(await bekleyenSayisi(depo, oturum.firmaId)).toBe(2);
    await expect(havuzaEkle(depo, servis, [{ dosya: dosya('x', 'text/html'), ad: 'x.html', tanima: null }])).rejects.toThrow('yalnızca');
  });

  it('VKN ile cari, fatura no ile girilmiş gider bulunur; başka firmaya kesilen fatura uyarılır', async () => {
    const [h] = (await havuzaEkle(depo, servis, [{ dosya: dosya('q'), ad: 'q.jpg', tanima: tanima() }])).eklenen;
    let o = await havuzOnerisi(depo, oturum.firmaId, h!);
    expect(o.cari?.id).toBe(demirci.id);
    expect(o.mevcutGiderler).toEqual([]);
    const g = await giderOlustur(depo, servis, {
      tarih: '2026-10-20',
      projeId: null,
      cariId: demirci.id,
      faturaNo: 'abc 123',
      vadeTarihi: null,
      aciklama: '',
      satirlar: [{ kalemId: null, aciklama: '', miktar: null, birim: null, tutar: 100_000, kdvDahil: false, kdvOrani: 20, tevkifat: null }],
    });
    o = await havuzOnerisi(depo, oturum.firmaId, h!);
    expect(o.mevcutGiderler.map((x) => x.id)).toEqual([g.id]);
    const firma = (await depo.getir('firma', oturum.firmaId))!;
    await servis.guncelle('firma', firma.id, { bilgiler: { ...firma.bilgiler, vergiNo: '1112223334' } });
    o = await havuzOnerisi(depo, oturum.firmaId, { ...h!, tanima: tanima({ aliciVergiNo: '9999999999' }) });
    expect(o.aliciUyarisi).toContain('9999999999');
  });

  it('onayda belge kayda bağlanır ve havuzdan çıkar; gereksiz belge iptal olur', async () => {
    const { eklenen } = await havuzaEkle(depo, servis, [
      { dosya: dosya('1'), ad: 'bir.jpg', tanima: null },
      { dosya: dosya('2'), ad: 'iki.jpg', tanima: null },
    ]);
    const [bir, iki] = eklenen;
    await havuzBagla(depo, servis, bir!.id, { tablo: 'cari', id: demirci.id, tur: 'fis', ad: 'Demirci fişi' });
    expect(await belgeleriListele(depo, oturum.firmaId, 'cari', demirci.id)).toEqual([expect.objectContaining({ ad: 'Demirci fişi', tur: 'fis' })]);
    await expect(havuzBagla(depo, servis, bir!.id, { tablo: 'cari', id: demirci.id })).rejects.toThrow('zaten');
    await havuzdanKaldir(servis, iki!.id);
    expect(await bekleyenler(depo, oturum.firmaId)).toEqual([]);
    expect((await depo.getir('belge', iki!.belgeId))?.iptal).not.toBeNull();
    await expect(havuzBagla(depo, servis, iki!.id, { tablo: 'cari', id: demirci.id })).rejects.toThrow('bulunamadı');
  });
});
