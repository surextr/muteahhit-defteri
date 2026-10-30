import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BankaHareketi } from '../hesap/bankaHareketi';
import { veriKatmaniniAc } from '../veri';
import type { Depo } from '../veri/depo';
import { yeniId } from '../veri/kimlik';
import type { Cari, Hesap } from '../veri/tipler';
import { bankaAktarimiHazirla, bankaHareketiKaydet } from './bankaAktar';
import { cariOlustur } from './cari';
import { giderOlustur } from './gider';
import { hesapOlustur } from './hesap';
import { KayitServisi, type Oturum } from './kayitServisi';
import { ilkKurulum } from './kurulum';
import { cariBakiyesiGetir, hesapBakiyesiGetir } from './sorgular';

const TL = (n: number) => Math.round(n * 100);
let depo: Depo;
let oturum: Oturum;
let servis: KayitServisi;
let banka: Hesap;
let kasa: Hesap;
let beton: Cari;
let ayse: Cari;

beforeEach(async () => {
  depo = await veriKatmaniniAc(`test-${yeniId()}`);
  oturum = await ilkKurulum(depo, { firmaAdi: 'Sürex İnşaat', kullaniciAdi: 'Yönetici' });
  servis = new KayitServisi(depo, oturum);
  banka = await hesapOlustur(depo, servis, { ad: 'Ziraat', tur: 'banka', paraBirimi: 'TRY', banka: null, iban: null }, { tutar: TL(100_000), tarih: '2026-09-01' });
  kasa = await hesapOlustur(depo, servis, { ad: 'Kasa', tur: 'kasa', paraBirimi: 'TRY', banka: null, iban: null });
  beton = await cariOlustur(depo, servis, { ad: 'Akdeniz Hazır Beton A.Ş.', roller: ['tedarikci'], telefon: null, vergiNo: null, adres: null, not: '' });
  ayse = await cariOlustur(depo, servis, { ad: 'Ayşe Kaya', roller: ['musteri'], telefon: null, vergiNo: null, adres: null, not: '' });
});
afterEach(() => depo.kapat());

const h = (satirNo: number, tarih: string, aciklama: string, tutar: number): BankaHareketi => ({ satirNo, tarih, aciklama, tutar: TL(tutar), bakiye: null });

describe('banka hareketlerini alma', () => {
  it('öneri, kaydetme (ödeme borca dağıtılır, tahsilat, masraf, transfer); ikinci yüklemede kayıtlı görünür', async () => {
    const fatura = await giderOlustur(depo, servis, {
      tarih: '2026-09-20',
      projeId: null,
      cariId: beton.id,
      faturaNo: '1',
      vadeTarihi: null,
      aciklama: '',
      satirlar: [{ kalemId: null, aciklama: '', miktar: null, birim: null, tutar: TL(30_000), kdvDahil: false, kdvOrani: 0, tevkifat: null }],
    });
    const dosya = [
      h(4, '2026-10-01', 'EFT AKDENIZ HAZIR BETON FATURA', -25_000),
      h(5, '2026-10-02', 'GELEN HAVALE AYSE KAYA KAPORA', 50_000),
      h(6, '2026-10-03', 'HESAP İŞLETİM ÜCRETİ', -35.5),
      h(7, '2026-10-04', 'VİRMAN KASAYA', -1_000),
      h(8, '2026-10-05', 'BİLİNMEYEN', 10),
    ];
    const a = await bankaAktarimiHazirla(depo, oturum.firmaId, banka.id, dosya, '2026-10-10');
    expect(a.satirlar.map((x) => [x.tur, x.cariId])).toEqual([
      ['odeme', beton.id],
      ['tahsilat', ayse.id],
      ['masraf', null],
      ['transfer', null],
      ['atla', null],
    ]);
    await bankaHareketiKaydet(depo, servis, banka.id, dosya[0]!, { tur: 'odeme', cariId: beton.id }, '2026-10-10');
    await bankaHareketiKaydet(depo, servis, banka.id, dosya[1]!, { tur: 'tahsilat', cariId: ayse.id }, '2026-10-10');
    await bankaHareketiKaydet(depo, servis, banka.id, dosya[2]!, { tur: 'masraf' }, '2026-10-10');
    await bankaHareketiKaydet(depo, servis, banka.id, dosya[3]!, { tur: 'transfer', karsiHesapId: kasa.id }, '2026-10-10');
    expect(await hesapBakiyesiGetir(depo, oturum.firmaId, banka.id)).toBe(TL(100_000 - 25_000 + 50_000 - 35.5 - 1_000));
    expect(await hesapBakiyesiGetir(depo, oturum.firmaId, kasa.id)).toBe(TL(1_000));
    expect(await cariBakiyesiGetir(depo, oturum.firmaId, beton.id)).toBe(TL(5_000));
    const es = (await depo.listele('eslestirme', { firmaId: oturum.firmaId, hedefId: fatura.id })).filter((e) => !e.iptal);
    expect(es.reduce((t, e) => t + e.tutar, 0)).toBe(TL(25_000));

    const b = await bankaAktarimiHazirla(depo, oturum.firmaId, banka.id, dosya, '2026-10-10');
    expect(b.satirlar.map((x) => !!x.kayitli)).toEqual([true, true, true, true, false]);
    await expect(bankaHareketiKaydet(depo, servis, banka.id, dosya[1]!, { tur: 'odeme', cariId: beton.id }, '2026-10-10')).rejects.toThrow('Giriş');
  });
});
