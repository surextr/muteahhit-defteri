import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { kalemGerceklesen } from '../hesap/butce';
import { veriKatmaniniAc } from '../veri';
import type { Depo } from '../veri/depo';
import { yeniId } from '../veri/kimlik';
import { firmaAyariDegistir, firmaBilgileriniDegistir, firmaLogosunuDegistir } from './firma';
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
    expect(await depo.listele('cari', { firmaId: oturum.firmaId })).toEqual([
      expect.objectContaining({ ad: 'Vergi dairesi', roller: ['vergi_dairesi'] }),
    ]);
    expect(await depo.listele('islemGecmisi', { firmaId: oturum.firmaId })).toHaveLength(4);
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
    tevkifatToplam: 0,
    paraBirimi: 'TRY',
    kur: null,
    tur: 'alis',
    iadeEdilenGiderId: null,
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
    tevkifat: null,
    tevkifatTutari: 0,
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
    await s.ekle('eslestirme', { kaynakTur: 'odeme', odemeId: o.id, hedefTur: 'gider', hedefId: gider.id, tutar });
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

describe('firma ayarı', () => {
  it('KDV gösterim ayarı değişir ve geçmişe yazılır', async () => {
    const depo = await veriKatmaniniAc(`test-${yeniId()}`);
    const oturum = await ilkKurulum(depo, { firmaAdi: 'Firma', kullaniciAdi: 'Yönetici' });
    const servis = new KayitServisi(depo, oturum);
    const firma = (await depo.getir('firma', oturum.firmaId))!;
    const guncel = await firmaAyariDegistir(servis, firma, { kdvMaliyeteDahil: false });
    expect(guncel.ayarlar).toEqual({ kdvMaliyeteDahil: false, anaParaBirimi: 'TRY' });
    const gecmis = await depo.listele('islemGecmisi', { kayitId: firma.id });
    expect(gecmis.find((g) => g.islem === 'guncelle')).toMatchObject({
      eski: { ayarlar: { kdvMaliyeteDahil: true } },
      yeni: { ayarlar: { kdvMaliyeteDahil: false } },
    });
    depo.kapat();
  });
});

describe('firma bilgileri ve logo', () => {
  it('bilgiler düzenlenir (telefon biçimlenir), logo eklenir/kaldırılır; geçmişe yazılır', async () => {
    const depo = await veriKatmaniniAc(`test-${yeniId()}`);
    const oturum = await ilkKurulum(depo, { firmaAdi: 'Firma', kullaniciAdi: 'Yönetici' });
    const servis = new KayitServisi(depo, oturum);
    let firma = (await depo.getir('firma', oturum.firmaId))!;
    expect(firma).toMatchObject({ logo: null, bilgiler: { telefon: '', vergiNo: '' } });

    const bilgiler = { ...firma.bilgiler, telefon: '05321112233', vergiNo: '123 456 7890', eposta: 'INFO@Firma.com', vergiDairesi: ' Muratpaşa ' };
    firma = await firmaBilgileriniDegistir(servis, firma, { ad: ' Yeni  Ad İnşaat ', bilgiler });
    expect(firma).toMatchObject({
      ad: 'Yeni Ad İnşaat',
      bilgiler: { telefon: '0 532 111 22 33', vergiNo: '1234567890', eposta: 'info@firma.com', vergiDairesi: 'Muratpaşa' },
    });
    await expect(firmaBilgileriniDegistir(servis, firma, { ad: '', bilgiler })).rejects.toThrow('Firma adı');
    await expect(firmaBilgileriniDegistir(servis, firma, { ad: 'X', bilgiler: { ...bilgiler, vergiNo: '12' } })).rejects.toThrow('Vergi no');

    firma = await firmaLogosunuDegistir(servis, firma, 'data:image/png;base64,AAAA');
    expect(firma.logo).toBe('data:image/png;base64,AAAA');
    await expect(firmaLogosunuDegistir(servis, firma, 'data:text/html;base64,AA')).rejects.toThrow('PNG');
    firma = await firmaLogosunuDegistir(servis, firma, null);
    expect(firma.logo).toBeNull();
    const gecmis = await depo.listele('islemGecmisi', { kayitId: firma.id });
    expect(gecmis.filter((g) => g.islem === 'guncelle')).toHaveLength(3);
    depo.kapat();
  });
});
