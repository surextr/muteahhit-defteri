import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { yzSozlesmeCevir } from '../hesap/yzOkuma';
import { veriKatmaniniAc } from '../veri';
import type { Depo } from '../veri/depo';
import { yeniId } from '../veri/kimlik';
import type { Firma } from '../veri/tipler';
import { arsaSahibiDurumu } from './arsaSahibi';
import { belgeleriListele } from './belge';
import { cariOlustur, carileriListele } from './cari';
import { havuzaEkle, takipBasliginiTamamla } from './havuz';
import { KayitServisi, type Oturum } from './kayitServisi';
import { ilkKurulum } from './kurulum';
import { BOS_BLOK, projeOlustur } from './proje';
import { satisaAcikBolumler } from './satis';
import { cariEslestir, hisseleriTamamla, katKarsiligiKur, okunanCariyiAc, satisKur, tipEslestir, ustaSozlesmesiKur } from './sozlesmeKur';
import { hazirUstaTipleriniEkle, ustaTipleriListele } from './ustaTipi';

let depo: Depo;
let oturum: Oturum;
let servis: KayitServisi;
let firma: Firma;

beforeEach(async () => {
  depo = await veriKatmaniniAc(`test-${yeniId()}`);
  oturum = await ilkKurulum(depo, { firmaAdi: 'Sürex İnşaat', kullaniciAdi: 'Yönetici' });
  servis = new KayitServisi(depo, oturum);
  firma = (await depo.getir('firma', oturum.firmaId))!;
});
afterEach(() => depo.kapat());

const proje = (arsaTipi: 'kat_karsiligi' | 'satin_alma') =>
  projeOlustur(
    depo,
    servis,
    {
      ad: 'Güneş Apt.',
      il: null,
      ilce: null,
      mahalle: null,
      adres: '',
      parseller: [],
      arsaTipi,
      baslangicTarihi: null,
      planlananBitis: null,
      gerceklesenBitis: null,
      alanlar: { net: null, brut: null, toplamInsaat: null, satilabilir: null },
    },
    [{ ...BOS_BLOK, zeminBolumSayisi: 0, normalKatSayisi: 2, katBasinaDaire: 2 }],
  );
const havuzBelgesi = async () => (await havuzaEkle(depo, servis, [{ dosya: new Blob([yeniId()], { type: 'application/pdf' }), ad: 'sozlesme.pdf', tanima: null }])).eklenen[0]!;

describe('eski sözleşmeyi kurma', () => {
  it('usta sözleşmesi: tip eşleşmesi, kalemler, şartlar, ödeme planı; belge bağlanır', async () => {
    const p = await proje('satin_alma');
    await hazirUstaTipleriniEkle(depo, servis);
    const tipler = await ustaTipleriListele(depo, oturum.firmaId);
    const okuma = yzSozlesmeCevir({
      tur: 'usta',
      tarih: '2025-03-01',
      karsi_taraf: { ad: 'Mehmet Kaya', tc_vkn: '12345678901', telefon: '05321112233' },
      usta: {
        isler: ['Sıva işleri'],
        kalemler: [
          { is: 'Sıva', ad: 'İç sıva', birim: 'm²', miktar: 1200, birim_fiyat: 85.5 },
          { is: 'Sıva', ad: 'Dış sıva', birim: null, miktar: null, birim_fiyat: null },
        ],
        baslama: '2025-03-10',
        teminat_orani: 5,
        ozel_sartlar: ['İskele müteahhide aittir.', '2. Su ve elektrik müteahhitten.'],
        odeme_plani: [{ vade: '2025-04-01', tutar: 50000, aciklama: 'Avans' }, { vade: null, tutar: 10000 }],
      },
    });
    const tipIdleri = tipEslestir(tipler, okuma.usta!.isler);
    expect(tipIdleri.map((id) => tipler.find((t) => t.id === id)!.ad.toLocaleLowerCase('tr'))).toEqual([expect.stringContaining('sıva')]);
    expect(cariEslestir(await carileriListele(depo, oturum.firmaId), okuma.karsiTaraf)).toBeNull();
    const cari = await okunanCariyiAc(depo, servis, okuma.karsiTaraf, 'usta');
    expect(cari).toMatchObject({ ad: 'Mehmet Kaya', vergiNo: '12345678901' });
    expect(cariEslestir(await carileriListele(depo, oturum.firmaId), { ad: 'mehmet kaya', no: null })?.id).toBe(cari.id);

    const h = await havuzBelgesi();
    const { sozlesme, uyarilar } = await ustaSozlesmesiKur(depo, servis, firma, { havuzId: h.id, projeId: p.id, cariId: cari.id, ustaTipiIdleri: tipIdleri, okuma });
    expect(sozlesme).toMatchObject({ sozlesmeTarihi: '2025-03-01', baslamaTarihi: '2025-03-10', teminatOrani: 5, onay: null });
    expect(sozlesme.kalemler.map((k) => [k.ad, k.birim, k.miktar, k.birimFiyat])).toEqual([
      ['İç sıva', 'm²', 1200, 8550],
      ['Dış sıva', '…', null, 0],
    ]);
    expect(sozlesme.ozelSartlar).toBe('1. İskele müteahhide aittir.\n2. Su ve elektrik müteahhitten.');
    expect(sozlesme.not).toContain('program dışında');
    expect(uyarilar.join(' ')).toContain('birim fiyatı okunamadı');
    expect(uyarilar.join(' ')).toContain('ödeme planı');
    expect((await depo.listele('odemePlani', { sozlesmeId: sozlesme.id })).map((o) => o.tutar)).toEqual([5000000]);
    expect(await belgeleriListele(depo, oturum.firmaId, 'ustaSozlesmesi', sozlesme.id)).toHaveLength(1);
  });

  it('kat karşılığı: arsa sahipleri, oran, teslim ve ceza; ikinci kez kurulmaz', async () => {
    const p = await proje('kat_karsiligi');
    const okuma = yzSozlesmeCevir({
      tur: 'kat_karsiligi',
      tarih: '2024-06-01',
      kat_karsiligi: {
        arsa_sahipleri: [{ ad: 'Ayşe' }, { ad: 'Fatma' }],
        arsa_sahibi_orani: 45,
        teslim_suresi_ay: 30,
        gecikme_cezasi: { tutar: 15000, birim: 'daire_aylik' },
        nakit_odemeler: [{ vade: '2024-07-01', tutar: 100000 }],
      },
    });
    expect(hisseleriTamamla([null, null, null])).toEqual([33.33, 33.33, 33.34]);
    const sahipler = [];
    const hisseler = hisseleriTamamla(okuma.katKarsiligi!.arsaSahipleri.map((a) => a.hisse));
    for (const [i, a] of okuma.katKarsiligi!.arsaSahipleri.entries()) {
      const c = await okunanCariyiAc(depo, servis, { ad: a.ad, no: a.no, telefon: null, adres: null, yetkili: null }, 'arsa_sahibi');
      sahipler.push({ cariId: c.id, hisse: hisseler[i]! });
    }
    const h = await havuzBelgesi();
    const { sozlesme, uyarilar } = await katKarsiligiKur(depo, servis, { havuzId: h.id, projeId: p.id, oran: 45, sahipler, okuma });
    expect(sozlesme).toMatchObject({ arsaSahibiOrani: 45, sozlesmeTarihi: '2024-06-01', teslimSuresiAy: 30, gecikmeCezasi: { tutar: 1500000, birim: 'daire_ay' } });
    expect((await arsaSahibiDurumu(depo, oturum.firmaId, p.id))?.sahipler.map((s) => [s.cari.ad, s.hisse])).toEqual([
      ['Ayşe', 50],
      ['Fatma', 50],
    ]);
    expect(uyarilar.join(' ')).toContain('nakit ödemeler');
    const h2 = await havuzBelgesi();
    await expect(katKarsiligiKur(depo, servis, { havuzId: h2.id, projeId: p.id, oran: 45, sahipler, okuma })).rejects.toThrow('zaten var');
  });

  it('satış: rezerve, fiyat, plan, teslim; vadesiz plan satırı alınmaz', async () => {
    const p = await proje('satin_alma');
    const bolum = (await satisaAcikBolumler(depo, oturum.firmaId, p.id))[0]!;
    const musteri = await cariOlustur(depo, servis, { ad: 'Ali Veli', roller: ['musteri'], telefon: null, vergiNo: null, adres: null, not: '' });
    const okuma = yzSozlesmeCevir({
      tur: 'satis',
      tarih: '2026-02-01',
      satis: { daire_no: bolum.bolum.no, fiyat: 3000000, kdv_orani: 1, plan: [{ tur: 'pesinat', vade: '2026-02-01', tutar: 1000000 }, { tur: 'taksit', tutar: 2000000 }], teslim_tarihi: '2027-06-30' },
    });
    const h = await havuzBelgesi();
    const { satis, uyarilar } = await satisKur(depo, servis, firma, { havuzId: h.id, bolumId: bolum.bolum.id, cariId: musteri.id, okuma, bugun: '2026-10-29' });
    expect(satis).toMatchObject({ tarih: '2026-02-01', fiyat: 300000000, kdvOrani: 1, teslimTarihi: '2027-06-30', onay: null });
    expect(satis.plan.map((x) => [x.tur, x.tutar])).toEqual([['pesinat', 100000000]]);
    expect(uyarilar.join(' ')).toContain('Vadesi okunamayan');
    expect(await belgeleriListele(depo, oturum.firmaId, 'satis', satis.id)).toHaveLength(1);
  });

  it('ruhsat belgesi takip başlığını tarihiyle tamamlar (bir kez)', async () => {
    const p = await proje('satin_alma');
    expect(await takipBasliginiTamamla(depo, servis, p.id, 'ruhsat', '2026-05-10')).toBe(true);
    const b = (await depo.listele('takipBasligi', { projeId: p.id, firmaId: oturum.firmaId })).find((x) => x.ad === 'Ruhsat');
    expect(b).toMatchObject({ durum: 'tamamlandi', baslangicTarihi: '2026-05-10', bitisTarihi: '2026-05-10' });
    expect(await takipBasliginiTamamla(depo, servis, p.id, 'ruhsat', '2026-06-01')).toBe(false);
    expect(await takipBasliginiTamamla(depo, servis, p.id, 'iskan', '2027-01-02')).toBe(true);
  });
});
