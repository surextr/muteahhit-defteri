import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { kalemGerceklesen } from '../hesap/butce';
import { veriKatmaniniAc } from '../veri';
import type { Depo } from '../veri/depo';
import { yeniId } from '../veri/kimlik';
import { KayitServisi } from './kayitServisi';
import { ilkKurulum, oturumuYukle } from './kurulum';
import { cariBakiyesiGetir, giderKalanBorcuGetir, hesapBakiyesiGetir } from './sorgular';

let depo: Depo;
beforeEach(async () => {
  depo = await veriKatmaniniAc(`test-${yeniId()}`);
});
afterEach(() => depo.kapat());

describe('ilk kurulum', () => {
  it('firma, yönetici kullanıcı ve üyelik oluşturur; oturum sonra yüklenir', async () => {
    expect(await oturumuYukle(depo)).toBeNull();
    const oturum = await ilkKurulum(depo, { firmaAdi: ' Yılmaz İnşaat ', kullaniciAdi: 'Süleyman' });

    expect(await depo.getir('firma', oturum.firmaId)).toMatchObject({
      ad: 'Yılmaz İnşaat',
      ayarlar: { kdvMaliyeteDahil: true },
    });
    expect(await depo.listele('uyelik', { firmaId: oturum.firmaId })).toEqual([
      expect.objectContaining({ kullaniciId: oturum.kullaniciId, rol: 'yonetici' }),
    ]);
    expect(await oturumuYukle(depo)).toEqual(oturum);
    expect(await depo.listele('islemGecmisi', { firmaId: oturum.firmaId })).toHaveLength(3);
  });

  it('ikinci kez ve boş adla yapılamaz', async () => {
    await expect(ilkKurulum(depo, { firmaAdi: '  ', kullaniciAdi: 'A' })).rejects.toThrow('Firma adı');
    await ilkKurulum(depo, { firmaAdi: 'A', kullaniciAdi: 'B' });
    await expect(ilkKurulum(depo, { firmaAdi: 'A', kullaniciAdi: 'B' })).rejects.toThrow('zaten');
  });
});

it('uçtan uca: 100.000 alış, iki ödeme; maliyet bir kez, borç ve kasa doğru', async () => {
  const oturum = await ilkKurulum(depo, { firmaAdi: 'Firma', kullaniciAdi: 'Yönetici' });
  const s = new KayitServisi(depo, oturum);
  const f = oturum.firmaId;

  const kasa = await s.ekle('hesap', { ad: 'Kasa', tur: 'kasa', paraBirimi: 'TRY', banka: null, iban: null });
  await s.ekle('acilisBakiyesi', { hedefTur: 'hesap', hedefId: kasa.id, tarih: '2026-10-01', tutar: 20_000_000 });
  const tedarikci = await s.ekle('cari', {
    ad: 'Beton A.Ş.',
    roller: ['tedarikci'],
    telefon: null,
    vergiNo: null,
    adres: null,
    not: '',
  });
  const gider = await s.ekle('gider', {
    tarih: '2026-10-01',
    projeId: null,
    cariId: tedarikci.id,
    faturaNo: 'A-1',
    vadeTarihi: null,
    aciklama: 'Beton',
    kdvHaricToplam: 10_000_000,
    kdvToplam: 0,
    toplam: 10_000_000,
    doviz: null,
  });
  const satir = await s.ekle('giderSatiri', {
    giderId: gider.id,
    kalemId: 'beton',
    aciklama: 'C30',
    miktar: 50,
    birim: 'm³',
    birimFiyat: 200_000,
    kdvHaricTutar: 10_000_000,
    kdvOrani: 0,
    kdvTutari: 0,
    toplam: 10_000_000,
  });

  async function ode(tutar: number) {
    const o = await s.ekle('odeme', {
      tarih: '2026-10-01',
      yon: 'odeme',
      amac: 'cari',
      yontem: 'nakit',
      cariId: tedarikci.id,
      hesapId: kasa.id,
      cekSenetId: null,
      projeId: null,
      tutar,
      doviz: null,
      aciklama: '',
    });
    await s.ekle('eslestirme', { odemeId: o.id, hedefTur: 'gider', hedefId: gider.id, tutar });
  }

  await ode(3_000_000);
  expect(await giderKalanBorcuGetir(depo, f, gider.id)).toBe(7_000_000);
  expect(await cariBakiyesiGetir(depo, f, tedarikci.id)).toBe(7_000_000);

  await ode(7_000_000);
  expect(await giderKalanBorcuGetir(depo, f, gider.id)).toBe(0);
  expect(await cariBakiyesiGetir(depo, f, tedarikci.id)).toBe(0);
  expect(await hesapBakiyesiGetir(depo, f, kasa.id)).toBe(10_000_000);

  const giderler = await depo.listele('gider', { firmaId: f });
  expect(kalemGerceklesen([satir], giderler, true).get('beton')).toBe(10_000_000);
});
