import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dogrudanOdeyebilir, esikUstu, onayAkisiHatalari, VARSAYILAN_ONAY_AKISI } from '../hesap/onay';
import { veriKatmaniniAc } from '../veri';
import type { Depo } from '../veri/depo';
import { yeniId } from '../veri/kimlik';
import { ata, atamalar, atamaKaldir } from './atama';
import { cariOlustur } from './cari';
import { giderOlustur } from './gider';
import { hesapOlustur } from './hesap';
import { KayitServisi, type Oturum } from './kayitServisi';
import { kullaniciEkle } from './kullanici';
import { ilkKurulum } from './kurulum';
import {
  bekleyenOnaylar,
  odemeTalimatiGeriCek,
  odemeTalimatiKontrolEt,
  odemeTalimatiOnayla,
  odemeTalimatiReddet,
  odemeYapVeyaOnayaGonder,
  onayAkisiKaydet,
} from './onay';
import { hesapBakiyesiGetir } from './sorgular';
import { yapilacaklariGetir } from './yapilacaklar';

const TL = (n: number) => Math.round(n * 100);

describe('onay akışı (saf)', () => {
  it('eşik, rol, ayar denetimi', () => {
    const a = { ...VARSAYILAN_ONAY_AKISI, acik: true, esik: TL(10_000) };
    expect([esikUstu(a, 'odeme', TL(9_999)), esikUstu(a, 'odeme', TL(10_000)), esikUstu(null, 'odeme', TL(1e6))]).toEqual([false, true, false]);
    expect([dogrudanOdeyebilir(a, 'santiye', TL(20_000)), dogrudanOdeyebilir(a, 'yonetici', TL(20_000)), dogrudanOdeyebilir(a, 'muhasebe', TL(500))]).toEqual([false, true, true]);
    expect(onayAkisiHatalari({ ...a, kontrol: true }, false)).toEqual(['Kontrol adımı için firmada muhasebe rolünde bir kullanıcı olmalı.']);
    expect(onayAkisiHatalari({ ...a, odeme: false, hakedis: false }, true)).toHaveLength(1);
  });
});

describe('onay akışı (kayıtlarla)', () => {
  let depo: Depo;
  let oturum: Oturum;
  let yonetici: KayitServisi;
  let muhasebe: KayitServisi;
  let santiye: KayitServisi;
  beforeEach(async () => {
    depo = await veriKatmaniniAc(`test-${yeniId()}`);
    oturum = await ilkKurulum(depo, { firmaAdi: 'Firma', kullaniciAdi: 'Ali Yılmaz' });
    yonetici = new KayitServisi(depo, oturum);
    const m = await kullaniciEkle(depo, yonetici, { ad: 'Ayşe Kaya', eposta: null }, 'muhasebe');
    const s = await kullaniciEkle(depo, yonetici, { ad: 'Mehmet Usta', eposta: null }, 'santiye');
    muhasebe = new KayitServisi(depo, { ...oturum, kullaniciId: m.kullanici.id });
    santiye = new KayitServisi(depo, { ...oturum, kullaniciId: s.kullanici.id });
  });
  afterEach(() => depo.kapat());

  it('eşik altı doğrudan; eşik üstü talimat → kontrol → onay (ödeme o anda) ya da red / geri çekme', async () => {
    await onayAkisiKaydet(depo, yonetici, { acik: true, esik: TL(10_000), kontrol: true, odeme: true, hakedis: true });
    const cari = await cariOlustur(depo, yonetici, { ad: 'Şahin Demir', roller: ['tedarikci'], telefon: null, vergiNo: null, adres: null, not: '' });
    const banka = await hesapOlustur(depo, yonetici, { ad: 'Banka', tur: 'banka', paraBirimi: 'TRY', banka: null, iban: null }, { tutar: TL(100_000), tarih: '2026-10-01' });
    const satir = [{ kalemId: null, aciklama: 'demir', miktar: null, birim: null, tutar: TL(30_000), kdvDahil: true, kdvOrani: 20, tevkifat: null }];
    const f = await giderOlustur(depo, yonetici, { tarih: '2026-10-01', projeId: null, cariId: cari.id, faturaNo: 'F1', vadeTarihi: null, aciklama: '', satirlar: satir });
    const g = (tutar: number) => ({ tarih: '2026-10-10', cariId: cari.id, hesapId: banka.id, tutar, aciklama: 'demir', dagitim: [{ giderId: f.id, tutar }] });

    // Eşik altı: ödeme yetkisi olan doğrudan öder; olmayan (şantiye) her tutarda talimat hazırlar.
    expect('odeme' in (await odemeYapVeyaOnayaGonder(depo, muhasebe, g(TL(5_000))))).toBe(true);
    const kucuk = await odemeYapVeyaOnayaGonder(depo, santiye, g(TL(1_000)));
    expect('talimat' in kucuk).toBe(true);
    await odemeTalimatiGeriCek(depo, santiye, (kucuk as { talimat: { id: string } }).talimat.id);
    expect(await hesapBakiyesiGetir(depo, oturum.firmaId, banka.id)).toBe(TL(95_000));

    // Eşik üstü: talimat, para çıkmaz.
    const r = await odemeYapVeyaOnayaGonder(depo, santiye, g(TL(20_000)));
    expect('talimat' in r).toBe(true);
    const talimat = (r as { talimat: { id: string } }).talimat;
    expect(await hesapBakiyesiGetir(depo, oturum.firmaId, banka.id)).toBe(TL(95_000));

    // Kontrol adımı: yönetici kontrolsüz onaylayamaz; hazırlayan kendi talimatını kontrol edemez; şantiye onaylayamaz.
    await expect(odemeTalimatiOnayla(depo, yonetici, talimat.id)).rejects.toThrow('kontrol');
    await expect(odemeTalimatiKontrolEt(depo, santiye, talimat.id)).rejects.toThrow('muhasebe');
    await odemeTalimatiKontrolEt(depo, muhasebe, talimat.id, 'fatura uygun');
    await expect(odemeTalimatiOnayla(depo, muhasebe, talimat.id)).rejects.toThrow('yönetici');

    // Yapılacaklar: yöneticide onay maddesi, muhasebede kontrol maddesi kalmadı.
    const firma = (await depo.getir('firma', oturum.firmaId))!;
    const hepsi = () => true;
    const kodlar = async (kullaniciId: string, rol: 'yonetici' | 'muhasebe' | 'santiye') =>
      (await yapilacaklariGetir(depo, firma, '2026-10-10', null, hepsi, {}, { kullaniciId, rol })).map((x) => x.kod);
    expect(await kodlar(oturum.kullaniciId, 'yonetici')).toContain('onay_bekleyen');
    expect(await kodlar(muhasebe.oturum.kullaniciId, 'muhasebe')).not.toContain('kontrol_bekleyen');

    const odeme = await odemeTalimatiOnayla(depo, yonetici, talimat.id, 'tamam');
    expect(odeme.tutar).toBe(TL(20_000));
    expect(await hesapBakiyesiGetir(depo, oturum.firmaId, banka.id)).toBe(TL(75_000));
    expect((await depo.getir('odemeOnayi', talimat.id))!).toMatchObject({ durum: 'onaylandi', odemeId: odeme.id });
    await expect(odemeTalimatiOnayla(depo, yonetici, talimat.id)).rejects.toThrow('sonuçlandı');

    // Red (gerekçe şart) ve geri çekme (yalnız hazırlayan).
    const t2 = ((await odemeYapVeyaOnayaGonder(depo, santiye, { ...g(TL(15_000)), dagitim: [] })) as { talimat: { id: string } }).talimat;
    await expect(odemeTalimatiReddet(depo, yonetici, t2.id, ' ')).rejects.toThrow('gerekçe');
    await odemeTalimatiReddet(depo, yonetici, t2.id, 'Önce irsaliye gelsin');
    expect(await kodlar(santiye.oturum.kullaniciId, 'santiye')).toContain('talimat_reddedildi');
    const t3 = ((await odemeYapVeyaOnayaGonder(depo, santiye, { ...g(TL(12_000)), dagitim: [] })) as { talimat: { id: string } }).talimat;
    await expect(odemeTalimatiGeriCek(depo, muhasebe, t3.id)).rejects.toThrow('hazırlayan');
    await odemeTalimatiGeriCek(depo, santiye, t3.id);
    expect((await bekleyenOnaylar(depo, oturum.firmaId, null, null)).talimatlar).toHaveLength(0);

    // Carili peşin gider eşik üstünde yönetici dışında olmaz.
    await expect(
      giderOlustur(depo, muhasebe, { tarih: '2026-10-11', projeId: null, cariId: cari.id, faturaNo: 'F2', vadeTarihi: null, aciklama: '', satirlar: satir }, { hesapId: banka.id, tutar: TL(30_000) }),
    ).rejects.toThrow('onay ister');
  });

  it('kontrol adımı muhasebe olmadan açılamaz; atama', async () => {
    const tek = await veriKatmaniniAc(`test-${yeniId()}`);
    const o = await ilkKurulum(tek, { firmaAdi: 'F', kullaniciAdi: 'Y' });
    const sv = new KayitServisi(tek, o);
    await kullaniciEkle(tek, sv, { ad: 'Şantiyeci', eposta: null }, 'santiye');
    await expect(onayAkisiKaydet(tek, sv, { acik: true, esik: 0, kontrol: true, odeme: true, hakedis: false })).rejects.toThrow('muhasebe');
    tek.kapat();

    const a = await ata(depo, yonetici, { anahtar: 'kalemsiz_gider:x', kullaniciId: muhasebe.oturum.kullaniciId, not: 'kalemi seç', sonTarih: '2026-11-05' });
    await ata(depo, yonetici, { anahtar: 'kalemsiz_gider:x', kullaniciId: santiye.oturum.kullaniciId, not: 'sen bak', sonTarih: null });
    let m = await atamalar(depo, oturum.firmaId);
    expect(m.get('kalemsiz_gider:x')).toMatchObject({ id: a.id, kullaniciId: santiye.oturum.kullaniciId, not: 'sen bak' });
    await atamaKaldir(depo, santiye, a.id);
    m = await atamalar(depo, oturum.firmaId);
    expect(m.size).toBe(0);
  });
});
