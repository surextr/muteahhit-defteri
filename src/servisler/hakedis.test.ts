import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { asamaSatiri, metrajSatiri, type HakedisGirdisi } from '../hesap/hakedis';
import { veriKatmaniniAc } from '../veri';
import type { Depo } from '../veri/depo';
import { yeniId } from '../veri/kimlik';
import type { Cari, Firma, Hesap, UstaSozlesmesi } from '../veri/tipler';
import { cariBakiye } from '../hesap/bakiye';
import { cariOlustur } from './cari';
import { giderGuncelle, giderIptal } from './gider';
import { hakedisBaglami, hakedisGuncelle, hakedisIptal, hakedisOlustur, hakedisOnayla, sozlesmeHakedisleri } from './hakedis';
import { hesapOlustur } from './hesap';
import { KayitServisi, type Oturum } from './kayitServisi';
import { ilkKurulum } from './kurulum';
import { acikOdemeler, odemeYap } from './odeme';
import { BOS_BLOK, projeOlustur } from './proje';
import { sozlesmeIcerigi, ustaSozlesmesiKaydet, ustaSozlesmesiOlustur, ustaSozlesmesiOnayla } from './ustaSozlesmesi';
import { hazirUstaTipleriniEkle, ustaTipleriListele } from './ustaTipi';

const TL = (n: number) => Math.round(n * 100);

let depo: Depo;
let oturum: Oturum;
let servis: KayitServisi;
let firma: Firma;
let usta: Cari;
let banka: Hesap;
let sozlesme: UstaSozlesmesi;

beforeEach(async () => {
  depo = await veriKatmaniniAc(`test-${yeniId()}`);
  oturum = await ilkKurulum(depo, { firmaAdi: 'Sürex İnşaat', kullaniciAdi: 'Yönetici' });
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
      adres: 'Merkez',
      parseller: [],
      arsaTipi: 'satin_alma',
      baslangicTarihi: null,
      planlananBitis: null,
      gerceklesenBitis: null,
      alanlar: { net: null, brut: null, toplamInsaat: null, satilabilir: null },
    },
    [{ ...BOS_BLOK, zeminBolumSayisi: 0, normalKatSayisi: 1, katBasinaDaire: 1 }],
  );
  usta = await cariOlustur(depo, servis, { ad: 'Yıldız İnşaat', roller: ['taseron'], telefon: null, vergiNo: null, adres: null, not: '' });
  banka = await hesapOlustur(depo, servis, { ad: 'Banka', tur: 'banka', paraBirimi: 'TRY', banka: null, iban: null }, { tutar: TL(1_000_000), tarih: '2026-10-01' });
  await hazirUstaTipleriniEkle(depo, servis);
  const tipler = await ustaTipleriListele(depo, oturum.firmaId);
  const siva = tipler.find((t) => t.sistemKodu === 'sivaci')!;
  const kalip = tipler.find((t) => t.sistemKodu === 'kalipci')!;
  const s = await ustaSozlesmesiOlustur(depo, servis, firma, { projeId: p.id, ustaTipiIdleri: [siva.id, kalip.id], cariId: usta.id });
  const ic = sozlesmeIcerigi(s);
  const tamam = await ustaSozlesmesiKaydet(depo, servis, s.id, {
    ...ic,
    sozlesmeTarihi: '2026-11-01',
    teminatOrani: 5,
    // Sıva metrajla, kalıp aşamayla: ilk sıva kalemi 180 TL/m², diğer kalemler 100 TL.
    bolumler: ic.bolumler.map((b) =>
      b.ustaTipiId === kalip.id
        ? { ...b, takipYontemi: 'asama' as const, asamalar: [{ id: 'a1', ad: '1. kat betonu', tutar: TL(85_000) }] }
        : { ...b, takipYontemi: 'metraj' as const },
    ),
    kalemler: ic.kalemler.map((k, i) => ({ ...k, birimFiyat: i === 0 ? TL(180) : TL(100), miktar: i === 0 ? 1000 : null })),
    sorumluluklar: ic.sorumluluklar.map((r) => ({ ...r, cevap: r.cevap ?? 'muteahhit' })),
    ortakMaddeler: ic.ortakMaddeler.map((m) => ({ ...m, cevap: 'Şantiye şefi ile.' })),
  });
  await ustaSozlesmesiOnayla(depo, servis, tamam.id);
  sozlesme = (await depo.getir('ustaSozlesmesi', tamam.id))!;
});
afterEach(() => depo.kapat());

const girdi = (d: Partial<HakedisGirdisi> = {}): HakedisGirdisi => ({
  tarih: '2026-11-30',
  donemAsama: 'Kasım',
  satirlar: [metrajSatiri(sozlesme.kalemler[0]!, 400), asamaSatiri(sozlesme.bolumler[1]!.ustaTipiId, sozlesme.bolumler[1]!.asamalar[0]!, null)],
  kesintiler: [],
  kdvOrani: 0,
  tevkifat: null,
  teminatOrani: 5,
  avansMahsubu: 0,
  sgkPrimiDahil: false,
  not: '',
  ...d,
});

const bakiye = async () => {
  const k = { firmaId: oturum.firmaId };
  const [giderler, odemeler, eslestirmeler] = await Promise.all([depo.listele('gider', k), depo.listele('odeme', k), depo.listele('eslestirme', k)]);
  void eslestirmeler;
  return cariBakiye(usta.id, { acilislar: [], giderler, hakedisler: [], odemeler, cekler: [], cekHareketleri: [], alacaklar: [], vergiDairesiId: null });
};

describe('hakediş', () => {
  it('taslak borç doğurmaz; onayla gider oluşur, borç ve bütçe giderden, avans mahsup edilir', async () => {
    await odemeYap(depo, servis, { tarih: '2026-11-10', cariId: usta.id, hesapId: banka.id, tutar: TL(50_000), aciklama: 'Avans', dagitim: [] });
    // Ekrandan gelen tutar yok sayılır: metraj tutarı sözleşmenin birim fiyatından hesaplanır.
    const ekran = girdi({ avansMahsubu: TL(30_000) });
    ekran.satirlar[0] = { ...ekran.satirlar[0]!, tutar: 1 };
    const h = await hakedisOlustur(depo, servis, sozlesme.id, ekran);
    expect(h).toMatchObject({ no: 1, brutTutar: TL(157_000), borcTutari: TL(157_000), teminatTutari: TL(7_850), netTutar: TL(119_150), giderId: null, onay: null });
    expect(await bakiye()).toBe(TL(-50_000));

    const o = await hakedisOnayla(depo, servis, h.id);
    expect(o.onay).not.toBeNull();
    const gider = (await depo.getir('gider', o.giderId!))!;
    expect(gider).toMatchObject({ hakedisId: h.id, toplam: TL(157_000), cariId: usta.id, projeId: sozlesme.projeId });
    const satirlar = await depo.listele('giderSatiri', { giderId: gider.id, firmaId: oturum.firmaId });
    expect(satirlar.map((x) => x.toplam).sort()).toEqual([TL(72_000), TL(85_000)].sort());
    expect(satirlar.every((x) => x.kalemId !== null)).toBe(true);
    // 157.000 borç − 50.000 ödeme; ödemenin 30.000'i bu gidere, 20.000'i açık avans.
    expect(await bakiye()).toBe(TL(107_000));
    expect((await acikOdemeler(depo, oturum.firmaId, usta.id))[0]!.acik).toBe(TL(20_000));

    // Onaylı hakediş ve gideri değiştirilmez.
    await expect(hakedisGuncelle(depo, servis, h.id, girdi())).rejects.toThrow('Onaylı hakediş değiştirilemez');
    await expect(giderIptal(depo, servis, gider.id, 'x')).rejects.toThrow('hakedişin onayıyla');
    await expect(
      giderGuncelle(depo, servis, gider.id, { tarih: gider.tarih, projeId: gider.projeId, cariId: gider.cariId, faturaNo: null, vadeTarihi: null, aciklama: '', satirlar: [] }),
    ).rejects.toThrow('hakedişin onayıyla');

    // Aynı aşama ikinci hakedişe girmez; metraj birikir.
    const b = await hakedisBaglami(depo, oturum.firmaId, sozlesme.id);
    expect(b!.onceki.kalemMiktari.get(sozlesme.kalemler[0]!.id)).toBe(400);
    await expect(hakedisOlustur(depo, servis, sozlesme.id, girdi())).rejects.toThrow('önceki bir hakedişte var');

    // İptal: gider ve eşleştirme iptal, ödeme yeniden açık avans.
    await hakedisIptal(servis, h.id, 'Yanlış metraj');
    expect((await depo.getir('gider', gider.id))!.iptal).not.toBeNull();
    expect(await bakiye()).toBe(TL(-50_000));
    expect(await sozlesmeHakedisleri(depo, oturum.firmaId, sozlesme.id)).toEqual([]);
    // Numara yeniden kullanılmaz.
    expect((await hakedisOlustur(depo, servis, sozlesme.id, girdi())).no).toBe(2);
  });

  it('imzalanmamış sözleşmeden hakediş çıkmaz; KDV ve tevkifatlı hakedişin borcu tevkifat düşülmüş', async () => {
    const taslak = await ustaSozlesmesiOlustur(depo, servis, firma, { projeId: sozlesme.projeId, ustaTipiIdleri: [sozlesme.bolumler[0]!.ustaTipiId], cariId: usta.id });
    await expect(hakedisOlustur(depo, servis, taslak.id, girdi())).rejects.toThrow('imzalı');

    const h = await hakedisOlustur(depo, servis, sozlesme.id, girdi({ satirlar: [metrajSatiri(sozlesme.kalemler[0]!, 100)], kdvOrani: 20, tevkifat: { pay: 4, payda: 10 }, teminatOrani: 0 }));
    expect(h).toMatchObject({ brutTutar: TL(18_000), kdvTutari: TL(3_600), tevkifatTutari: TL(1_440), borcTutari: TL(20_160) });
    const o = await hakedisOnayla(depo, servis, h.id);
    const gider = (await depo.getir('gider', o.giderId!))!;
    expect(gider.toplam - gider.tevkifatToplam).toBe(TL(20_160));
  });
});
