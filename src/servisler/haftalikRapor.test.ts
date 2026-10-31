import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { haftaBasi, haftalikMesaj } from '../hesap/haftalikRapor';
import { veriKatmaniniAc } from '../veri';
import type { Depo } from '../veri/depo';
import { yeniId } from '../veri/kimlik';
import type { Firma } from '../veri/tipler';
import { cariOlustur } from './cari';
import { giderOlustur } from './gider';
import { gunlukKaydet } from './gunluk';
import { haftalikRaporGetir } from './haftalikRapor';
import { KayitServisi, type Oturum } from './kayitServisi';
import { ilkKurulum } from './kurulum';
import { eksikIsEkle } from './teslim';
import { BOS_BLOK, projeOlustur } from './proje';

const TL = (n: number) => Math.round(n * 100);

let depo: Depo;
let oturum: Oturum;
let servis: KayitServisi;
let firma: Firma;
let projeId: string;
beforeEach(async () => {
  depo = await veriKatmaniniAc(`test-${yeniId()}`);
  oturum = await ilkKurulum(depo, { firmaAdi: 'Sürex İnşaat', kullaniciAdi: 'Y' });
  servis = new KayitServisi(depo, oturum);
  firma = (await depo.getir('firma', oturum.firmaId))!;
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
});
afterEach(() => depo.kapat());

describe('haftalık şantiye raporu', () => {
  it('hafta başı pazartesi', () => {
    expect([haftaBasi('2026-10-26'), haftaBasi('2026-10-31'), haftaBasi('2026-11-01'), haftaBasi('2026-11-02')]).toEqual(['2026-10-26', '2026-10-26', '2026-10-26', '2026-11-02']);
  });

  it('günlükler, ekipler, harcama, sorun, eksik, gelecek hafta ödenecek', async () => {
    const usta = await cariOlustur(depo, servis, { ad: 'Ali Sıvacı', roller: ['usta'], telefon: null, vergiNo: null, adres: null, not: '' });
    const bos = { hava: null, sicaklik: null, calisilmadi: false, yapilanIsler: '', ekipler: [], puantaj: [], sorunlar: '', not: '' };
    await gunlukKaydet(depo, servis, projeId, '2026-10-26', {
      ...bos,
      hava: 'gunesli',
      sicaklik: 22,
      yapilanIsler: '3. kat sıva',
      ekipler: [{ id: 'e', cariId: usta.id, ad: '', kisi: 4, is: 'sıva' }],
      puantaj: [{ id: 'p', cariId: usta.id, durum: 'yarim', yevmiye: TL(1_500), mesaiSaat: 0, mesaiUcreti: null, giderId: null }],
      sorunlar: 'Kum geç geldi',
    });
    await gunlukKaydet(depo, servis, projeId, '2026-10-27', { ...bos, calisilmadi: true });
    await gunlukKaydet(depo, servis, projeId, '2026-10-19', { ...bos, yapilanIsler: 'önceki hafta' });
    const satir = [{ kalemId: null, aciklama: 'kum', miktar: null, birim: null, tutar: TL(10_000), kdvDahil: true, kdvOrani: 0, tevkifat: null }];
    await giderOlustur(depo, servis, { tarih: '2026-10-28', projeId, cariId: usta.id, faturaNo: 'F1', vadeTarihi: '2026-11-04', aciklama: '', satirlar: satir });
    await giderOlustur(depo, servis, { tarih: '2026-10-10', projeId, cariId: usta.id, faturaNo: 'F0', vadeTarihi: null, aciklama: '', satirlar: satir });
    await eksikIsEkle(depo, servis, { projeId, bolumId: null, kaynak: 'kontrol', baslik: 'Merdiven boyası', aciklama: '', sorumluCariId: null, sonTarih: null });

    const s = (await haftalikRaporGetir(depo, firma, projeId, '2026-10-26', '2026-10-29'))!;
    const r = s.rapor;
    expect(r).toMatchObject({ baslangic: '2026-10-26', bitis: '2026-11-01', devamEdiyor: true, calisilanGun: 1, calisilmayanGun: 1, gunluksuzGun: 2, adamGun: 4.5 });
    expect(r.gunler[0]).toMatchObject({ hava: 'Güneşli 22°', kisi: 4.5, yapilan: '3. kat sıva' });
    expect(r.ekipler.map((e) => [e.ad, e.adamGun])).toEqual([
      ['Ali Sıvacı', 4],
      ['Yevmiyeli işçiler', 0.5],
    ]);
    expect(r.harcama).toMatchObject({ toplam: TL(10_000), faturaSayisi: 1 });
    expect(r.harcama.kalemler).toEqual([{ ad: 'Kalemi seçilmemiş', tutar: TL(10_000) }]);
    expect(r.sorunlar).toEqual([{ tarih: '2026-10-26', metin: 'Kum geç geldi' }]);
    expect(r.eksik.acik).toBe(1);
    expect(r.gelecek.odenecek.map((x) => [x.vade, x.tutar])).toEqual([['2026-11-04', TL(10_000)]]);
    expect(r.bos).toBe(false);
    const m = haftalikMesaj(s.proje.ad, r, firma.ad);
    expect(m).toContain('26 Ekim – 1 Kasım');
    expect(m).toContain('hava yüzünden 1 gün çalışılmadı');

    // Boş hafta.
    expect((await haftalikRaporGetir(depo, firma, projeId, '2026-09-07', '2026-10-29'))!.rapor.bos).toBe(true);
  });
});
