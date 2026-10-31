import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { teklifKarsilastir } from '../hesap/malzeme';
import { veriKatmaniniAc } from '../veri';
import type { Depo } from '../veri/depo';
import { yeniId } from '../veri/kimlik';
import type { Cari, Proje } from '../veri/tipler';
import { cariOlustur } from './cari';
import { KayitServisi, type Oturum } from './kayitServisi';
import { ilkKurulum } from './kurulum';
import {
  baglanabilirFaturalar,
  faturaBagla,
  faturaOnerisi,
  firmaSatinAlmaDurumlari,
  projeStogu,
  satinAlmaGetir,
  siparisGeriAl,
  siparisVer,
  stokHareketiEkle,
  talepIptal,
  talepKaydet,
  talepOlustur,
  talepOzetiGetir,
  teklifKaydet,
  teklifSec,
  teslimAl,
} from './malzeme';
import { giderOlustur } from './gider';
import { odemeYap } from './odeme';
import { hesapOlustur } from './hesap';
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
    expect((await talepOzetiGetir(depo, oturum.firmaId, t.id))!.durum).toBe('onay');
    await expect(teslimAl(depo, servis, t.id, { tarih: '2026-11-04', irsaliyeNo: '', miktarlar: new Map([['s1', 1]]), not: '' })).rejects.toThrow('onaylayın');
    await siparisVer(depo, servis, t.id, '2026-11-03');
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

describe('satın alma zinciri', () => {
  it('nakliyeli teklif → onay → kısmi teslim → fatura (fiyat farkı) → ödeme: uyarılar ve fatura önerisi', async () => {
    const t = await talepOlustur(depo, servis, proje.id, {
      tarih: '2026-11-02',
      gerekenTarih: '2026-11-10',
      aciklama: '',
      satirlar: [
        { id: 's1', ad: 'Çimento', miktar: 100, birim: 'torba', not: '' },
        { id: 's2', ad: 'Kum', miktar: 10, birim: 'm³', not: '' },
      ],
    });
    const t1 = await teklifKaydet(depo, servis, t.id, {
      cariId: a.id, tarih: '2026-11-02', fiyatlar: { s1: TL(250), s2: TL(900) }, kdvOrani: 20, teslimGun: 2, not: '', nakliye: TL(1_000), vadeGun: 30, odemeKosulu: '30 gün havale',
    });
    // Nakliye karşılaştırmaya girer.
    expect(teklifKarsilastir(t1).toplamlar[0]!.tutar).toBe(TL(25_000 + 9_000 + 1_000));
    await teklifSec(depo, servis, t.id, t1.teklifler[0]!.id);
    const onayli = await siparisVer(depo, servis, t.id, '2026-11-03');
    expect(onayli.siparis!.tutar).toBe(TL(35_000 * 1.2));
    // Onaylı siparişin fiyatı değişmez; geri alınca değişir.
    await expect(teklifKaydet(depo, servis, t.id, { ...onayli.teklifler[0]!, nakliye: 0 })).rejects.toThrow('geri alın');
    await siparisGeriAl(depo, servis, t.id);
    await siparisVer(depo, servis, t.id, '2026-11-03');

    // 60 torba geldi; 80 torba daha pahalı faturalandı (260 TL), hepsi ödendi.
    await teslimAl(depo, servis, t.id, { tarih: '2026-11-05', irsaliyeNo: 'İ-1', miktarlar: new Map([['s1', 60]]), not: '' });
    let o = (await satinAlmaGetir(depo, oturum.firmaId, t.id))!;
    const oneri = faturaOnerisi(o, '2026-11-06')!;
    expect(oneri).toMatchObject({ cariId: a.id, vadeTarihi: '2026-12-06', kdvOrani: 20, nakliye: TL(1_000), satirlar: [{ ad: 'Çimento', birim: 'torba', miktar: 60, birimFiyat: TL(250) }] });

    const banka = await hesapOlustur(depo, servis, { ad: 'Banka', tur: 'banka', paraBirimi: 'TRY', banka: null, iban: null }, { tutar: TL(100_000), tarih: '2026-11-01' });
    const satir = (aciklama: string, birim: string | null, miktar: number | null, tutar: number) => ({ kalemId: null, aciklama, miktar, birim, tutar, kdvDahil: false, kdvOrani: 20, tevkifat: null });
    const f = await giderOlustur(
      depo, servis,
      { tarih: '2026-11-06', projeId: proje.id, cariId: a.id, faturaNo: 'A-1', vadeTarihi: null, aciklama: '', satirlar: [satir('Çimento', 'torba', 80, TL(80 * 260)), satir('Nakliye', null, null, TL(1_000))] },
      null,
      { talepId: t.id },
    );
    await odemeYap(depo, servis, { tarih: '2026-11-07', cariId: a.id, hesapId: banka.id, tutar: f.toplam, aciklama: '', dagitim: [{ giderId: f.id, tutar: f.toplam }] });

    o = (await satinAlmaGetir(depo, oturum.firmaId, t.id))!;
    expect(o.satinAlma.satirlar[0]).toMatchObject({ teslim: 60, faturaMiktari: 80, faturaTutari: TL(20_800), fiyatFarki: TL(800) });
    expect(o.satinAlma.digerFatura).toBe(TL(1_000));
    expect(o.satinAlma.uyarilar.map((u) => u.kod)).toEqual(['odenen_fazla', 'fatura_fazla', 'fiyat_farki']);
    // Teslim edilen 60 torba + nakliye, KDV dahil.
    expect(o.satinAlma.teslimDegeri).toBe(TL((15_000 + 1_000) * 1.2));
    expect(o.satinAlma.odenen).toBe(f.toplam);
    // Kalan 20 torba gelince fatura fazlası ve ödeme fazlası kapanır; kum hiç gelmedi, faturalanmadı.
    await teslimAl(depo, servis, t.id, { tarih: '2026-11-08', irsaliyeNo: '', miktarlar: new Map([['s1', 40]]), not: '' });
    o = (await satinAlmaGetir(depo, oturum.firmaId, t.id))!;
    expect(o.satinAlma.uyarilar.map((u) => u.kod)).toEqual(['fiyat_farki', 'faturasiz_teslim']);
    expect(o.satinAlma.faturalanmamis).toBe(TL((20 * 250 + 9_000) * 1.2));

    // Tedarikçi faturası girildikten sonra değişmez; havuzdan girilmiş faturayı bağlama.
    await expect(teklifSec(depo, servis, t.id, null)).rejects.toThrow('değiştirilemez');
    const ikinci = await giderOlustur(depo, servis, { tarih: '2026-11-09', projeId: proje.id, cariId: a.id, faturaNo: 'A-2', vadeTarihi: null, aciklama: '', satirlar: [satir('Çimento', 'torba', 20, TL(5_000))] });
    expect((await baglanabilirFaturalar(depo, oturum.firmaId, t.id)).map((g) => g.id)).toEqual([ikinci.id]);
    await faturaBagla(depo, servis, ikinci.id, t.id);
    o = (await satinAlmaGetir(depo, oturum.firmaId, t.id))!;
    expect(o.satinAlma.satirlar[0]!.faturaMiktari).toBe(100);

    const firma = await firmaSatinAlmaDurumlari(depo, oturum.firmaId, null);
    expect(firma.map((x) => [x.talep.id, x.odemeTarihi, x.sonTeslim])).toEqual([[t.id, '2026-12-10', '2026-11-08']]);
  });
});
