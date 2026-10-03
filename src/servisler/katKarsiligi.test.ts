import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { veriKatmaniniAc } from '../veri';
import type { Depo } from '../veri/depo';
import { yeniId } from '../veri/kimlik';
import type { Cari, Hesap } from '../veri/tipler';
import { katKarsiligiKaydet, tahsisEt } from './arsaSahibi';
import { carileriListele, cariOlustur } from './cari';
import { giderOlustur } from './gider';
import { hesapOlustur } from './hesap';
import { SISTEM_KALEMI, sistemKalemiHazirla } from './kalem';
import { GerekceGerekliHatasi, KayitServisi, type Oturum } from './kayitServisi';
import {
  arsaSahibiOdemesiEkle,
  cariKatKarsiligiOzeti,
  ilaveImalatDurumuDegistir,
  ilaveImalatEkle,
  katKarsiligiAyrintilariKaydet,
  katKarsiligiOnayla,
  katKarsiligiOzeti,
  type KatKarsiligiAyrintilari,
} from './katKarsiligi';
import { ilkKurulum } from './kurulum';
import { acikAlacaklar, tahsilatKaydet } from './odeme';
import { BOS_BLOK, projeOlustur, projeYapisiGetir } from './proje';

const TL = (n: number) => Math.round(n * 100);
const BUGUN = '2026-10-03';

let depo: Depo;
let oturum: Oturum;
let servis: KayitServisi;
let projeId: string;
let ahmet: Cari;
let kasa: Hesap;

beforeEach(async () => {
  depo = await veriKatmaniniAc(`test-${yeniId()}`);
  oturum = await ilkKurulum(depo, { firmaAdi: 'Firma', kullaniciAdi: 'Yönetici' });
  servis = new KayitServisi(depo, oturum);
  const p = await projeOlustur(
    depo,
    servis,
    {
      ad: 'P',
      il: null,
      ilce: null,
      mahalle: null,
      adres: '',
      parseller: [],
      arsaTipi: 'kat_karsiligi',
      baslangicTarihi: null,
      planlananBitis: null,
      gerceklesenBitis: null,
      alanlar: { net: null, brut: null, toplamInsaat: null, satilabilir: null },
    },
    [{ ...BOS_BLOK, zeminBolumSayisi: 0, normalKatSayisi: 2, katBasinaDaire: 2 }],
  );
  projeId = p.id;
  ahmet = await cariOlustur(depo, servis, { ad: 'Ahmet', roller: ['arsa_sahibi'], telefon: null, vergiNo: null, adres: null, not: '' });
  kasa = await hesapOlustur(depo, servis, { ad: 'Kasa', tur: 'kasa', paraBirimi: 'TRY', banka: null, iban: null }, { tutar: TL(1_000_000), tarih: '2026-01-01' });
  await katKarsiligiKaydet(depo, servis, projeId, { arsaSahibiOrani: 45, arsaSahipleri: [{ cariId: ahmet.id, hisse: 100 }], payYontemi: 'brut' });
});
afterEach(() => depo.kapat());

const ayrinti = (ek: Partial<KatKarsiligiAyrintilari> = {}): KatKarsiligiAyrintilari => ({
  sozlesmeTarihi: '2026-02-01',
  teslimTarihi: '2027-09-30',
  teslimSuresiAy: null,
  gecikmeCezasi: { tutar: TL(25_000), birim: 'daire_ay' },
  not: '',
  kiralar: [{ cariId: ahmet.id, kiraAylik: TL(15_000), kiraBaslangic: '2026-03-01', teslimAlindi: null }],
  ...ek,
});

describe('kat karşılığı ayrıntıları', () => {
  it('kaydedilir; paylaşım değişince kira bilgisi korunur; onaydan sonra gerekçe ister', async () => {
    await katKarsiligiAyrintilariKaydet(depo, servis, projeId, ayrinti());
    await katKarsiligiKaydet(depo, servis, projeId, { arsaSahibiOrani: 40, arsaSahipleri: [{ cariId: ahmet.id, hisse: 100 }], payYontemi: 'brut' });
    const o = (await katKarsiligiOzeti(depo, oturum.firmaId, projeId, BUGUN))!;
    expect(o.sozlesme.arsaSahipleri[0]).toMatchObject({ kiraAylik: TL(15_000), kiraBaslangic: '2026-03-01' });
    expect(o.teslim).toBe('2027-09-30');
    expect(o.yukumlulukler[0]!.kiraDogan).toBe(TL(120_000));

    await katKarsiligiOnayla(depo, servis, projeId);
    await expect(katKarsiligiAyrintilariKaydet(depo, servis, projeId, ayrinti({ not: 'Tadil' }))).rejects.toBeInstanceOf(GerekceGerekliHatasi);
    await katKarsiligiAyrintilariKaydet(depo, servis, projeId, ayrinti({ not: 'Tadil' }), 'Ek protokol');
  });

  it('ruhsattan itibaren X ay: ruhsat tamamlanınca teslim tarihi hesaplanır', async () => {
    await katKarsiligiAyrintilariKaydet(depo, servis, projeId, ayrinti({ teslimSuresiAy: 24 }));
    expect((await katKarsiligiOzeti(depo, oturum.firmaId, projeId, BUGUN))!.teslim).toBeNull();
    const ruhsat = (await projeYapisiGetir(depo, oturum.firmaId, projeId))!.takipBasliklari.find((t) => t.ad === 'Ruhsat')!;
    await servis.guncelle('takipBasligi', ruhsat.id, { durum: 'tamamlandi', bitisTarihi: '2026-04-10' });
    expect((await katKarsiligiOzeti(depo, oturum.firmaId, projeId, BUGUN))!.teslim).toBe('2028-04-10');
  });

  it('hatalı girdi reddedilir', async () => {
    await expect(katKarsiligiAyrintilariKaydet(depo, servis, projeId, ayrinti({ teslimSuresiAy: 0 }))).rejects.toThrow('1 ile 120');
    await expect(
      katKarsiligiAyrintilariKaydet(depo, servis, projeId, ayrinti({ kiralar: [{ cariId: ahmet.id, kiraAylik: TL(1), kiraBaslangic: null, teslimAlindi: null }] })),
    ).rejects.toThrow('başladığı ayı');
  });
});

describe('nakit ödeme planı ve ödenen', () => {
  it('plan satırları ve kat karşılığı kalemindeki giderler kalanı belirler; başka kalem ve ceza ayrı; bakiyeye karışmaz', async () => {
    const nakit = await sistemKalemiHazirla(depo, servis, projeId, SISTEM_KALEMI.nakit);
    const ceza = await sistemKalemiHazirla(depo, servis, projeId, SISTEM_KALEMI.ceza);
    expect(ceza.ustKalemId).toBe(nakit.ustKalemId);
    expect((await sistemKalemiHazirla(depo, servis, projeId, SISTEM_KALEMI.nakit)).id).toBe(nakit.id);
    const gider = (kalemId: string | null, tutar: number) =>
      giderOlustur(
        depo,
        servis,
        {
          tarih: '2026-04-15',
          projeId,
          cariId: ahmet.id,
          faturaNo: null,
          vadeTarihi: null,
          aciklama: '',
          iadeEdilenGiderId: null,
          satirlar: [{ kalemId, aciklama: '', miktar: null, birim: null, tutar, kdvDahil: true, kdvOrani: 0, tevkifat: null }],
        },
        { hesapId: kasa.id, tutar },
      );
    await katKarsiligiAyrintilariKaydet(depo, servis, projeId, ayrinti({ kiralar: [] }));
    await arsaSahibiOdemesiEkle(depo, servis, projeId, { cariId: ahmet.id, vadeTarihi: '2026-04-15', kosul: '', tutar: TL(500_000), aciklama: 'Peşinat' });
    await arsaSahibiOdemesiEkle(depo, servis, projeId, { cariId: ahmet.id, vadeTarihi: null, kosul: 'Ruhsat alınınca', tutar: TL(300_000), aciklama: '' });
    await expect(arsaSahibiOdemesiEkle(depo, servis, projeId, { cariId: ahmet.id, vadeTarihi: null, kosul: '', tutar: TL(1), aciklama: '' })).rejects.toThrow('koşulu');
    await gider(nakit.id, TL(500_000));
    await gider(null, TL(7_000)); // başka iş (kalemsiz): sayılmaz
    await gider(ceza.id, TL(25_000)); // ceza ödemesi: ayrı
    const y = (await katKarsiligiOzeti(depo, oturum.firmaId, projeId, BUGUN))!.yukumlulukler[0]!;
    expect(y).toMatchObject({ nakitToplam: TL(800_000), odenen: TL(500_000), cezaOdenen: TL(25_000), kalan: TL(300_000), vadesiGecen: 0 });
    expect(await cariKatKarsiligiOzeti(depo, oturum.firmaId, ahmet.id, BUGUN)).toMatchObject({ odenen: TL(500_000), kalan: TL(300_000) });
    const bakiye = (await carileriListele(depo, oturum.firmaId)).find((c) => c.cari.id === ahmet.id)!.bakiye;
    expect(bakiye).toBe(0);
  });
});

describe('ilave imalat ve alacak', () => {
  it('arsa sahibi öderse onayda alacak doğar; tahsilat kapatır; tahsil edilmişse reddedilemez', async () => {
    const i = await ilaveImalatEkle(depo, servis, projeId, { cariId: ahmet.id, bolumId: null, tarih: BUGUN, aciklama: 'Jakuzi', tutar: TL(45_000), oder: 'arsa_sahibi' });
    const bakiye = async () => (await carileriListele(depo, oturum.firmaId)).find((c) => c.cari.id === ahmet.id)!.bakiye;
    expect(await bakiye()).toBe(0);
    await ilaveImalatDurumuDegistir(depo, servis, i.id, 'onaylandi', undefined, BUGUN);
    expect(await bakiye()).toBe(-TL(45_000)); // bize borçlu

    await tahsilatKaydet(depo, servis, { tarih: BUGUN, amac: 'cari', cariId: ahmet.id, hesapId: kasa.id, projeId, tutar: TL(20_000), aciklama: '', iadeId: null });
    let satir = (await katKarsiligiOzeti(depo, oturum.firmaId, projeId, BUGUN))!.ilaveImalatlar[0]!;
    expect(satir).toMatchObject({ alinacak: TL(45_000), tahsilEdilen: TL(20_000) });
    await expect(ilaveImalatDurumuDegistir(depo, servis, i.id, 'reddedildi')).rejects.toThrow('tahsilatı yapılmış');

    // Yapıldı'ya geçmek yeni alacak açmaz.
    await ilaveImalatDurumuDegistir(depo, servis, i.id, 'yapildi');
    satir = (await katKarsiligiOzeti(depo, oturum.firmaId, projeId, BUGUN))!.ilaveImalatlar[0]!;
    expect(satir.alinacak).toBe(TL(45_000));
  });

  it('tahsil edilmemiş alacak reddedilince iptal olur; müteahhit öderse alacak yok; maliyet bağlı giderden', async () => {
    const i = await ilaveImalatEkle(depo, servis, projeId, { cariId: ahmet.id, bolumId: null, tarih: BUGUN, aciklama: 'Parke', tutar: TL(30_000), oder: 'arsa_sahibi' });
    await ilaveImalatDurumuDegistir(depo, servis, i.id, 'onaylandi');
    await ilaveImalatDurumuDegistir(depo, servis, i.id, 'reddedildi');
    expect((await carileriListele(depo, oturum.firmaId)).find((c) => c.cari.id === ahmet.id)!.bakiye).toBe(0);

    const m = await ilaveImalatEkle(depo, servis, projeId, { cariId: ahmet.id, bolumId: null, tarih: BUGUN, aciklama: 'Ek priz', tutar: 0, oder: 'muteahhit' });
    await ilaveImalatDurumuDegistir(depo, servis, m.id, 'onaylandi');
    await giderOlustur(
      depo,
      servis,
      {
        tarih: BUGUN,
        projeId,
        cariId: null,
        faturaNo: null,
        vadeTarihi: null,
        aciklama: '',
        iadeEdilenGiderId: null,
        satirlar: [{ kalemId: null, aciklama: 'Priz', miktar: null, birim: null, tutar: TL(1_200), kdvDahil: true, kdvOrani: 20, tevkifat: null, ilaveImalatId: m.id }],
      },
      { hesapId: kasa.id, tutar: TL(1_200) },
    );
    const satirlar = (await katKarsiligiOzeti(depo, oturum.firmaId, projeId, BUGUN))!.ilaveImalatlar;
    expect(satirlar.find((x) => x.imalat.id === m.id)).toMatchObject({ maliyet: TL(1_200), alinacak: 0 });
    expect(satirlar.find((x) => x.imalat.id === i.id)).toMatchObject({ alinacak: 0 });
  });

  it('tahsilat dağıtımı elle verilebilir; boş dağıtımda alacak açık kalır; fazlası reddedilir', async () => {
    const i = await ilaveImalatEkle(depo, servis, projeId, { cariId: ahmet.id, bolumId: null, tarih: BUGUN, aciklama: 'Kapı', tutar: TL(10_000), oder: 'arsa_sahibi' });
    await ilaveImalatDurumuDegistir(depo, servis, i.id, 'onaylandi', undefined, BUGUN);
    const alacak = (await acikAlacaklar(depo, oturum.firmaId, ahmet.id))[0]!.alacak;
    const tahsil = (tutar: number, alacakDagitimi?: { alacakId: string; tutar: number }[]) =>
      tahsilatKaydet(depo, servis, { tarih: BUGUN, amac: 'cari', cariId: ahmet.id, hesapId: kasa.id, projeId, tutar, aciklama: '', iadeId: null, alacakDagitimi });
    await tahsil(TL(3_000), []);
    expect((await acikAlacaklar(depo, oturum.firmaId, ahmet.id))[0]!.kalan).toBe(TL(10_000));
    await tahsil(TL(5_000), [{ alacakId: alacak.id, tutar: TL(4_000) }]);
    expect((await acikAlacaklar(depo, oturum.firmaId, ahmet.id))[0]!.kalan).toBe(TL(6_000));
    await expect(tahsil(TL(1_000), [{ alacakId: alacak.id, tutar: TL(2_000) }])).rejects.toThrow('tahsilattan fazla');
    await expect(tahsil(TL(9_000), [{ alacakId: alacak.id, tutar: TL(7_000) }])).rejects.toThrow('en çok');
  });

  it('daire başı gecikme cezası tahsisli daire sayısıyla', async () => {
    const bolumler = (await projeYapisiGetir(depo, oturum.firmaId, projeId))!.bloklar[0]!.katlar.flatMap((k) => k.bolumler);
    await tahsisEt(depo, servis, projeId, [bolumler[0]!.id, bolumler[1]!.id], ahmet.id);
    await katKarsiligiAyrintilariKaydet(depo, servis, projeId, ayrinti({ teslimTarihi: '2026-06-30', kiralar: [] }));
    const o = (await katKarsiligiOzeti(depo, oturum.firmaId, projeId, BUGUN))!;
    expect(o.toplamCeza).toBe(TL(3 * 25_000 * 2));
  });
});
