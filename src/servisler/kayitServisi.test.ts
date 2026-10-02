import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { veriKatmaniniAc } from '../veri';
import type { Depo } from '../veri/depo';
import { yeniId } from '../veri/kimlik';
import { IsKuraliHatasi, KayitServisi, type YeniKayit } from './kayitServisi';
import { giderKalanBorcuGetir } from './sorgular';

let depo: Depo;
let saat: Date;

beforeEach(async () => {
  depo = await veriKatmaniniAc(`test-${yeniId()}`);
  saat = new Date('2026-10-01T09:00:00');
});
afterEach(() => depo.kapat());

const servis = (kullaniciId = 'u1', firmaId = 'f1') =>
  new KayitServisi(depo, { firmaId, kullaniciId, cihazId: 'c1' }, () => saat);

const yeniCari = (ad = 'Ahmet Usta'): YeniKayit<'cari'> => ({
  ad,
  roller: ['usta'],
  telefon: null,
  vergiNo: null,
  adres: null,
  not: '',
});

const gecmis = (kayitId: string) => depo.listele('islemGecmisi', { kayitId });

describe('ekle', () => {
  it('ortak alanları doldurur ve işlem geçmişine yazar', async () => {
    const cari = await servis().ekle('cari', yeniCari());
    expect(cari).toMatchObject({ firmaId: 'f1', olusturan: 'u1', surum: 1, iptal: null });
    expect(await depo.getir('cari', cari.id)).toEqual(cari);

    const [g] = await gecmis(cari.id);
    expect(g).toMatchObject({ islem: 'olustur', kayitTur: 'cari', kullaniciId: 'u1', cihazId: 'c1', eski: null });
    expect(g?.yeni).toMatchObject({ ad: 'Ahmet Usta' });
  });

  it('onaylı tablolarda onay boş başlar', async () => {
    const satis = await servis().ekle('satis', {
      projeId: 'p',
      bolumId: 'b',
      cariId: 'c',
      tarih: '2026-10-01',
      fiyat: 1,
      kapora: 0,
      indirim: 0,
      takas: [],
      durum: 'rezerve',
      doviz: null,
    });
    expect(satis.onay).toBeNull();
  });

  it('ortak alanlar dışarıdan verilemez', async () => {
    const hileli = { ...yeniCari(), surum: 99 } as YeniKayit<'cari'>;
    await expect(servis().ekle('cari', hileli)).rejects.toThrow('Ortak alanlar');
  });
});

describe('guncelle ve gerekçe kuralı', () => {
  it('aynı gün, kaydı giren kişi gerekçesiz düzeltebilir; yalnızca değişen alan geçmişe yazılır', async () => {
    const s = servis();
    const cari = await s.ekle('cari', yeniCari());
    const guncel = await s.guncelle('cari', cari.id, { ad: 'Ahmet Yılmaz', telefon: null });

    expect(guncel.surum).toBe(2);
    const son = (await gecmis(cari.id)).find((g) => g.islem === 'guncelle');
    expect(son).toMatchObject({ eski: { ad: 'Ahmet Usta' }, yeni: { ad: 'Ahmet Yılmaz' }, gerekce: null });
  });

  it('değişiklik yoksa sürüm artmaz, geçmiş yazılmaz', async () => {
    const s = servis();
    const cari = await s.ekle('cari', yeniCari());
    await s.guncelle('cari', cari.id, { ad: 'Ahmet Usta' });
    expect((await depo.getir('cari', cari.id))?.surum).toBe(1);
    expect(await gecmis(cari.id)).toHaveLength(1);
  });

  it('ertesi gün gerekçe zorunlu; gerekçe geçmişe yazılır', async () => {
    const s = servis();
    const cari = await s.ekle('cari', yeniCari());
    saat = new Date('2026-10-02T09:00:00');

    await expect(s.guncelle('cari', cari.id, { ad: 'Yeni' })).rejects.toThrow(IsKuraliHatasi);
    await expect(s.guncelle('cari', cari.id, { ad: 'Yeni' }, '   ')).rejects.toThrow(IsKuraliHatasi);
    await s.guncelle('cari', cari.id, { ad: 'Yeni' }, 'Unvan değişti');

    const son = (await gecmis(cari.id)).find((g) => g.islem === 'guncelle');
    expect(son?.gerekce).toBe('Unvan değişti');
  });

  it('başkasının kaydında gerekçe zorunlu', async () => {
    const cari = await servis('u1').ekle('cari', yeniCari());
    await expect(servis('u2').guncelle('cari', cari.id, { ad: 'X' })).rejects.toThrow(IsKuraliHatasi);
    await servis('u2').guncelle('cari', cari.id, { ad: 'X' }, 'Muhasebe düzeltmesi');
  });

  it('onaylı kayıtta aynı gün de gerekçe zorunlu', async () => {
    const s = servis();
    const ks = await s.ekle('katKarsiligiSozlesme', {
      projeId: 'p',
      muteahhitOrani: 60,
      arsaSahibiOrani: 40,
      teslimTarihi: null,
      gecikmeCezasi: '',
      kiraYardimi: '',
    });
    await s.onayla('katKarsiligiSozlesme', ks.id);
    await expect(s.guncelle('katKarsiligiSozlesme', ks.id, { muteahhitOrani: 55 })).rejects.toThrow(IsKuraliHatasi);
    await expect(s.onayla('katKarsiligiSozlesme', ks.id)).rejects.toThrow('zaten onaylı');
  });

  it('başka firmanın kaydı görünmez', async () => {
    const cari = await servis('u1', 'f1').ekle('cari', yeniCari());
    await expect(servis('u1', 'f2').guncelle('cari', cari.id, { ad: 'X' })).rejects.toThrow('bulunamadı');
  });
});

describe('iptal', () => {
  it('kayıt silinmez, iptal bilgisi yazılır; sonra değiştirilemez', async () => {
    const s = servis();
    const cari = await s.ekle('cari', yeniCari());
    await s.iptal('cari', cari.id, 'Mükerrer kayıt');

    const kayit = await depo.getir('cari', cari.id);
    expect(kayit?.iptal).toMatchObject({ kullaniciId: 'u1', gerekce: 'Mükerrer kayıt' });
    expect(kayit?.surum).toBe(2);
    await expect(s.guncelle('cari', cari.id, { ad: 'X' })).rejects.toThrow('İptal edilmiş');
    await expect(s.iptal('cari', cari.id, 'tekrar')).rejects.toThrow('zaten iptal');
  });

  it('ödeme iptal edilince eşleştirmesi de iptal olur ve borç geri açılır', async () => {
    const s = servis();
    const gider = await s.ekle('gider', {
      tarih: '2026-10-01',
      projeId: null,
      cariId: null,
      faturaNo: null,
      vadeTarihi: null,
      aciklama: '',
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
      kalemId: null,
      aciklama: '',
      miktar: null,
      birim: null,
      birimFiyat: null,
      kdvHaricTutar: 10_000_000,
      kdvOrani: 0,
      kdvTutari: 0,
      tevkifat: null,
      tevkifatTutari: 0,
      toplam: 10_000_000,
    });
    const odeme = await s.ekle('odeme', {
      tarih: '2026-10-01',
      yon: 'odeme',
      amac: 'cari',
      yontem: 'nakit',
      cariId: null,
      hesapId: null,
      cekSenetId: null,
      projeId: null,
      tutar: 3_000_000,
      doviz: null,
      aciklama: '',
    });
    const esl = await s.ekle('eslestirme', { kaynakTur: 'odeme', odemeId: odeme.id, hedefTur: 'gider', hedefId: gider.id, tutar: 3_000_000 });
    expect(await giderKalanBorcuGetir(depo, 'f1', gider.id)).toBe(7_000_000);

    await s.iptal('odeme', odeme.id, 'Yanlış tutar');
    expect((await depo.getir('eslestirme', esl.id))?.iptal?.gerekce).toContain('Yanlış tutar');
    expect(await giderKalanBorcuGetir(depo, 'f1', gider.id)).toBe(10_000_000);

    // Gider iptali satırlarını da iptal eder.
    await s.iptal('gider', gider.id);
    expect((await depo.getir('giderSatiri', satir.id))?.iptal).not.toBeNull();
  });
});

it('işlem yarıda kalırsa hiçbir şey yazılmaz', async () => {
  const s = servis();
  let cariId = '';
  await expect(
    depo.islem(async () => {
      cariId = (await s.ekle('cari', yeniCari())).id;
      throw new Error('ikinci adım başarısız');
    }),
  ).rejects.toThrow('ikinci adım');

  expect(await depo.getir('cari', cariId)).toBeUndefined();
  expect(await gecmis(cariId)).toHaveLength(0);
});
