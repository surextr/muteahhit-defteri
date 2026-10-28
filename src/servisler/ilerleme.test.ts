import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { veriKatmaniniAc } from '../veri';
import type { Depo } from '../veri/depo';
import { yeniId } from '../veri/kimlik';
import type { Cari, Kalem } from '../veri/tipler';
import { cariOlustur } from './cari';
import { giderOlustur } from './gider';
import { ilerlemeIptal, ilerlemeKaydet, projeIlerlemeOzetleri, projeIlerlemesiGetir } from './ilerleme';
import { kalemEkle } from './kalem';
import { KayitServisi, type Oturum } from './kayitServisi';
import { ilkKurulum } from './kurulum';
import { BOS_BLOK, projeOlustur } from './proje';

const TL = (n: number) => Math.round(n * 100);

let depo: Depo;
let oturum: Oturum;
let servis: KayitServisi;
let projeId: string;
let kaba: Kalem;
let beton: Kalem;
let tedarikci: Cari;

beforeEach(async () => {
  depo = await veriKatmaniniAc(`test-${yeniId()}`);
  oturum = await ilkKurulum(depo, { firmaAdi: 'Sürex İnşaat', kullaniciAdi: 'Yönetici' });
  servis = new KayitServisi(depo, oturum);
  const p = await projeOlustur(
    depo,
    servis,
    {
      ad: 'Güneş Apt.',
      il: null,
      ilce: null,
      mahalle: null,
      adres: '',
      parseller: [],
      arsaTipi: 'satin_alma',
      baslangicTarihi: null,
      planlananBitis: null,
      gerceklesenBitis: null,
      alanlar: { net: null, brut: null, toplamInsaat: null, satilabilir: null },
    },
    [{ ...BOS_BLOK, zeminBolumSayisi: 0, normalKatSayisi: 1, katBasinaDaire: 1 }],
  );
  projeId = p.id;
  kaba = await kalemEkle(depo, servis, projeId, null, { ad: 'Kaba yapı', birim: null, butceMiktari: null, butceTutari: null });
  beton = await kalemEkle(depo, servis, projeId, kaba.id, { ad: 'Hazır beton', birim: null, butceMiktari: null, butceTutari: TL(1_000_000) });
  tedarikci = await cariOlustur(depo, servis, { ad: 'Beton AŞ', roller: ['tedarikci'], telefon: null, vergiNo: null, adres: null, not: '' });
});
afterEach(() => depo.kapat());

const girdi = (yuzde: number, tarih: string, kalemId = kaba.id) => ({ projeId, kalemId, tarih, yuzde, kaynak: 'elle' as const, hakedisId: null, not: '' });

describe('ilerleme takibi', () => {
  it('yeni giriş eskisini değiştirmez; iptal bir öncekini geri getirir; alt kalemde tutulmaz', async () => {
    await ilerlemeKaydet(depo, servis, girdi(20, '2026-10-01'));
    const ikinci = await ilerlemeKaydet(depo, servis, girdi(35, '2026-10-15'));
    let d = await projeIlerlemesiGetir(depo, oturum.firmaId, projeId, true);
    expect(d.kayitlar).toHaveLength(2);
    expect(d.ilerleme.kalemler.find((k) => k.kalem.id === kaba.id)).toMatchObject({ yuzde: 35, tarih: '2026-10-15' });
    await ilerlemeIptal(servis, ikinci.id, 'Yanlış girildi');
    d = await projeIlerlemesiGetir(depo, oturum.firmaId, projeId, true);
    expect(d.ilerleme.kalemler.find((k) => k.kalem.id === kaba.id)!.yuzde).toBe(20);
    await expect(ilerlemeKaydet(depo, servis, girdi(10, '2026-10-01', beton.id))).rejects.toThrow('ana kalemde');
    await expect(ilerlemeKaydet(depo, servis, girdi(120, '2026-10-01'))).rejects.toThrow('0 ile 100');
  });

  it('projeler listesi özeti: harcama ilerlemenin önüne geçince uyarı', async () => {
    await giderOlustur(depo, servis, {
      tarih: '2026-10-01',
      projeId,
      cariId: tedarikci.id,
      faturaNo: 'F-1',
      vadeTarihi: null,
      aciklama: '',
      satirlar: [{ kalemId: beton.id, aciklama: '', miktar: null, birim: null, tutar: TL(400_000), kdvDahil: true, kdvOrani: 20, tevkifat: null }],
    });
    let o = (await projeIlerlemeOzetleri(depo, oturum.firmaId, true)).get(projeId)!;
    expect(o).toMatchObject({ ilerleme: null, harcamaYuzdesi: 40, uyari: false });
    await ilerlemeKaydet(depo, servis, girdi(25, '2026-10-02'));
    o = (await projeIlerlemeOzetleri(depo, oturum.firmaId, true)).get(projeId)!;
    expect(o).toMatchObject({ ilerleme: 25, harcamaYuzdesi: 40, uyari: true, uyariKalemSayisi: 1 });
    await ilerlemeKaydet(depo, servis, girdi(35, '2026-10-03'));
    o = (await projeIlerlemeOzetleri(depo, oturum.firmaId, true)).get(projeId)!;
    expect(o.uyari).toBe(false);
  });
});
