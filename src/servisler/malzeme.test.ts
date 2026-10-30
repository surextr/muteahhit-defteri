import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { teklifKarsilastir } from '../hesap/malzeme';
import { veriKatmaniniAc } from '../veri';
import type { Depo } from '../veri/depo';
import { yeniId } from '../veri/kimlik';
import type { Cari, Proje } from '../veri/tipler';
import { cariOlustur } from './cari';
import { KayitServisi, type Oturum } from './kayitServisi';
import { ilkKurulum } from './kurulum';
import { projeStogu, stokHareketiEkle, talepIptal, talepKaydet, talepOlustur, talepOzetiGetir, teklifKaydet, teklifSec, teslimAl } from './malzeme';
import { BOS_BLOK, projeOlustur } from './proje';

const TL = (n: number) => Math.round(n * 100);
let depo: Depo;
let oturum: Oturum;
let servis: KayitServisi;
let proje: Proje;
let a: Cari;
let b: Cari;

beforeEach(async () => {
  depo = await veriKatmaniniAc(`test-${yeniId()}`);
  oturum = await ilkKurulum(depo, { firmaAdi: 'Sürex İnşaat', kullaniciAdi: 'Yönetici' });
  servis = new KayitServisi(depo, oturum);
  proje = await projeOlustur(
    depo,
    servis,
    { ad: 'Güneş', il: null, ilce: null, mahalle: null, adres: '', parseller: [], arsaTipi: 'satin_alma', baslangicTarihi: null, planlananBitis: null, gerceklesenBitis: null, alanlar: { net: null, brut: null, toplamInsaat: null, satilabilir: null } },
    [{ ...BOS_BLOK }],
  );
  a = await cariOlustur(depo, servis, { ad: 'Korkuteli Yapı', roller: ['tedarikci'], telefon: null, vergiNo: null, adres: null, not: '' });
  b = await cariOlustur(depo, servis, { ad: 'Yıldız Hırdavat', roller: ['tedarikci'], telefon: null, vergiNo: null, adres: null, not: '' });
});
afterEach(() => depo.kapat());

describe('malzeme talebi ve stok', () => {
  it('talep → teklifler (karşılaştırma) → seçim → kısmi/tam teslim → stok → kullanım', async () => {
    const t = await talepOlustur(depo, servis, proje.id, {
      tarih: '2026-11-02',
      gerekenTarih: '2026-11-05',
      aciklama: '',
      satirlar: [
        { id: 's1', ad: 'Çimento', miktar: 100, birim: 'torba', not: '' },
        { id: 's2', ad: 'Kum', miktar: 10, birim: 'm³', not: '' },
      ],
    });
    expect((await talepOzetiGetir(depo, oturum.firmaId, t.id))!.durum).toBe('acik');
    await teklifKaydet(depo, servis, t.id, { cariId: a.id, tarih: '2026-11-02', fiyatlar: { s1: TL(250), s2: TL(900) }, kdvOrani: 20, teslimGun: 1, not: '' });
    const t2 = await teklifKaydet(depo, servis, t.id, { cariId: b.id, tarih: '2026-11-02', fiyatlar: { s1: TL(240), s2: null }, kdvOrani: 20, teslimGun: 2, not: '' });
    const k = teklifKarsilastir(t2);
    expect(k.toplamlar.map((x) => [x.tutar, x.eksik])).toEqual([
      [TL(25_000 + 9_000), 0],
      [TL(24_000), 1],
    ]);
    expect(k.enUcuz.get('s1')).toBe(t2.teklifler[1]!.id);
    expect(k.enIyi).toBe(t2.teklifler[0]!.id);
    expect((await talepOzetiGetir(depo, oturum.firmaId, t.id))!.durum).toBe('teklif');
    await teklifSec(depo, servis, t.id, t2.teklifler[0]!.id);
    expect((await talepOzetiGetir(depo, oturum.firmaId, t.id))!.durum).toBe('siparis');

    await teslimAl(depo, servis, t.id, { tarih: '2026-11-04', irsaliyeNo: 'İ-1', miktarlar: new Map([['s1', 60]]), not: '' });
    expect((await talepOzetiGetir(depo, oturum.firmaId, t.id))!.durum).toBe('kismen');
    await expect(teklifSec(depo, servis, t.id, t2.teklifler[1]!.id)).rejects.toThrow('değiştirilemez');
    await expect(talepKaydet(depo, servis, t.id, { tarih: '2026-11-02', gerekenTarih: null, aciklama: '', satirlar: [t2.satirlar[1]!] })).rejects.toThrow('çıkarılamaz');
    await expect(talepIptal(depo, servis, t.id)).rejects.toThrow('iptal edilemez');
    await teslimAl(depo, servis, t.id, { tarih: '2026-11-05', irsaliyeNo: '', miktarlar: new Map([['s1', 40], ['s2', 10]]), not: '' });
    expect((await talepOzetiGetir(depo, oturum.firmaId, t.id))!.durum).toBe('teslim');

    await stokHareketiEkle(depo, servis, proje.id, { tarih: '2026-11-06', tur: 'cikis', ad: 'çimento', birim: 'Torba', miktar: 30, not: '3. kat' });
    await expect(stokHareketiEkle(depo, servis, proje.id, { tarih: '2026-11-06', tur: 'cikis', ad: 'Kum', birim: 'm³', miktar: 11, not: '' })).rejects.toThrow('Stokta 10');
    const stok = await projeStogu(depo, oturum.firmaId, proje.id);
    expect(stok.map((x) => [x.ad, x.giris, x.cikis, x.kalan])).toEqual([
      ['Çimento', 100, 30, 70],
      ['Kum', 10, 0, 10],
    ]);
    const hareket = (await depo.listele('malzemeHareketi', { firmaId: oturum.firmaId })).find((h) => h.irsaliyeNo === 'İ-1')!;
    expect(hareket.cariId).toBe(a.id);
  });
});
