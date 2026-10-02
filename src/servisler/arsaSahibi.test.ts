import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { veriKatmaniniAc } from '../veri';
import type { Depo } from '../veri/depo';
import { yeniId } from '../veri/kimlik';
import type { CariRol, Proje } from '../veri/tipler';
import { arsaSahibiDurumu, katKarsiligiKaydet, tahsisEt, tahsisKaldir } from './arsaSahibi';
import { cariIptal, cariOlustur } from './cari';
import { GerekceGerekliHatasi, KayitServisi, type Oturum } from './kayitServisi';
import { ilkKurulum } from './kurulum';
import { BOS_BLOK, projeGuncelle, projeOlustur, projeYapisiGetir } from './proje';

let depo: Depo;
let oturum: Oturum;
let servis: KayitServisi;

beforeEach(async () => {
  depo = await veriKatmaniniAc(`test-${yeniId()}`);
  oturum = await ilkKurulum(depo, { firmaAdi: 'Firma', kullaniciAdi: 'Yönetici' });
  servis = new KayitServisi(depo, oturum);
});
afterEach(() => depo.kapat());

const cari = (ad: string, roller: CariRol[] = ['arsa_sahibi']) =>
  cariOlustur(depo, servis, { ad, roller, telefon: null, vergiNo: null, adres: null, not: '' });

async function kur(arsaTipi: Proje['arsaTipi'] = 'kat_karsiligi') {
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
      arsaTipi,
      baslangicTarihi: null,
      planlananBitis: null,
      gerceklesenBitis: null,
      alanlar: { net: null, brut: null, toplamInsaat: null, satilabilir: null },
    },
    [{ ...BOS_BLOK, ad: 'A', zeminBolumSayisi: 0, normalKatSayisi: 2, katBasinaDaire: 2 }],
  );
  const yapi = (await projeYapisiGetir(depo, oturum.firmaId, p.id))!;
  const bolumler = yapi.bloklar[0]!.katlar.flatMap((k) => k.bolumler);
  return { projeId: p.id, bolumler };
}

const bolumGetir = (id: string) => depo.getir('bagimsizBolum', id);

describe('kat karşılığı sözleşmesi', () => {
  it('ilk kayıtta açılır, sonra güncellenir; müteahhit oranı kalandır', async () => {
    const { projeId } = await kur();
    const ahmet = await cari('Ahmet');
    const ayse = await cari('Ayşe');
    const s = await katKarsiligiKaydet(depo, servis, projeId, {
      arsaSahibiOrani: 45,
      arsaSahipleri: [{ cariId: ahmet.id, hisse: 50 }, { cariId: ayse.id, hisse: 50 }],
      payYontemi: 'brut',
    });
    expect(s).toMatchObject({ arsaSahibiOrani: 45, muteahhitOrani: 55, payYontemi: 'brut' });
    const g = await katKarsiligiKaydet(depo, servis, projeId, {
      arsaSahibiOrani: 40,
      arsaSahipleri: [{ cariId: ahmet.id, hisse: 60 }, { cariId: ayse.id, hisse: 40 }],
      payYontemi: 'adet',
    });
    expect(g.id).toBe(s.id);
    const d = (await arsaSahibiDurumu(depo, oturum.firmaId, projeId))!;
    expect(d.sozlesme).toMatchObject({ muteahhitOrani: 60, payYontemi: 'adet' });
    expect(d.sahipler.map((x) => [x.cari.ad, x.hisse])).toEqual([['Ahmet', 60], ['Ayşe', 40]]);
  });

  it('hisseler %100 olmalı, rol arsa sahibi olmalı, proje kat karşılığı olmalı', async () => {
    const { projeId } = await kur();
    const ahmet = await cari('Ahmet');
    const usta = await cari('Usta', ['usta']);
    const g = (ek = {}) => ({ arsaSahibiOrani: 45, arsaSahipleri: [{ cariId: ahmet.id, hisse: 60 }], payYontemi: 'brut' as const, ...ek });
    await expect(katKarsiligiKaydet(depo, servis, projeId, g())).rejects.toThrow('%100 olmalı');
    await expect(katKarsiligiKaydet(depo, servis, projeId, g({ arsaSahibiOrani: 100, arsaSahipleri: [] }))).rejects.toThrow('0 ile 100');
    await expect(
      katKarsiligiKaydet(depo, servis, projeId, g({ arsaSahipleri: [{ cariId: ahmet.id, hisse: 50 }, { cariId: ahmet.id, hisse: 50 }] })),
    ).rejects.toThrow('iki kez');
    await expect(katKarsiligiKaydet(depo, servis, projeId, g({ arsaSahipleri: [{ cariId: usta.id, hisse: 100 }] }))).rejects.toThrow(
      'rolü yok',
    );
    const satin = await kur('satin_alma');
    await expect(katKarsiligiKaydet(depo, servis, satin.projeId, g({ arsaSahipleri: [] }))).rejects.toThrow('yalnızca kat karşılığı');
  });

  it('ertesi gün değişiklik gerekçe ister (mali kayıt)', async () => {
    const { projeId } = await kur();
    const ahmet = await cari('Ahmet');
    const g = { arsaSahibiOrani: 45, arsaSahipleri: [{ cariId: ahmet.id, hisse: 100 }], payYontemi: 'brut' as const };
    await katKarsiligiKaydet(depo, servis, projeId, g);
    const yarin = new KayitServisi(depo, oturum, () => new Date(Date.now() + 86_400_000));
    await expect(katKarsiligiKaydet(depo, yarin, projeId, { ...g, arsaSahibiOrani: 50 })).rejects.toBeInstanceOf(GerekceGerekliHatasi);
    await katKarsiligiKaydet(depo, yarin, projeId, { ...g, arsaSahibiOrani: 50 }, 'Sözleşme tadili');
  });
});

describe('tahsis', () => {
  async function hazirla() {
    const k = await kur();
    const ahmet = await cari('Ahmet');
    const ayse = await cari('Ayşe');
    await katKarsiligiKaydet(depo, servis, k.projeId, {
      arsaSahibiOrani: 50,
      arsaSahipleri: [{ cariId: ahmet.id, hisse: 50 }, { cariId: ayse.id, hisse: 50 }],
      payYontemi: 'brut',
    });
    return { ...k, ahmet, ayse };
  }

  it('tahsis sahipliği değiştirir, başka sahibe aktarılır, kaldırılınca müteahhide döner', async () => {
    const { projeId, bolumler, ahmet, ayse } = await hazirla();
    const [b1, b2] = bolumler;
    await servis.guncelle('bagimsizBolum', b1!.id, { satisDurumu: 'satista' });
    expect(await tahsisEt(depo, servis, projeId, [b1!.id, b2!.id], ahmet.id)).toBe(2);
    expect(await bolumGetir(b1!.id)).toMatchObject({ sahiplik: 'arsa_sahibi', satisDurumu: 'satisa_kapali' });
    expect(await tahsisEt(depo, servis, projeId, [b1!.id], ahmet.id)).toBe(0);

    await tahsisEt(depo, servis, projeId, [b2!.id], ayse.id);
    let d = (await arsaSahibiDurumu(depo, oturum.firmaId, projeId))!;
    expect(d.tahsis.get(b1!.id)).toBe(ahmet.id);
    expect(d.tahsis.get(b2!.id)).toBe(ayse.id);
    expect(d.tahsis.size).toBe(2);

    expect(await tahsisKaldir(depo, servis, projeId, [b1!.id, b2!.id])).toBe(2);
    d = (await arsaSahibiDurumu(depo, oturum.firmaId, projeId))!;
    expect(d.tahsis.size).toBe(0);
    expect((await bolumGetir(b1!.id))!.sahiplik).toBe('muteahhit');
  });

  it('rezerve/satılmış bölüm ve sözleşmede olmayan kişi reddedilir', async () => {
    const { projeId, bolumler, ahmet } = await hazirla();
    await servis.guncelle('bagimsizBolum', bolumler[0]!.id, { satisDurumu: 'rezerve' });
    await expect(tahsisEt(depo, servis, projeId, [bolumler[1]!.id, bolumler[0]!.id], ahmet.id)).rejects.toThrow('rezerve');
    // Tek işlem: ilk bölüm de tahsis edilmemiş olmalı.
    expect((await bolumGetir(bolumler[1]!.id))!.sahiplik).toBe('muteahhit');
    const veli = await cari('Veli');
    await expect(tahsisEt(depo, servis, projeId, [bolumler[1]!.id], veli.id)).rejects.toThrow('arsa sahibi değil');
  });

  it('tahsis varken proje satın almaya çevrilemez; tahsis kaldırılınca çevrilir', async () => {
    const { projeId, bolumler, ahmet } = await hazirla();
    await tahsisEt(depo, servis, projeId, [bolumler[0]!.id], ahmet.id);
    const p = (await depo.getir('proje', projeId))!;
    const girdi = {
      ad: p.ad,
      il: p.il,
      ilce: p.ilce,
      mahalle: p.mahalle,
      adres: p.adres,
      parseller: p.parseller,
      arsaTipi: 'satin_alma' as const,
      baslangicTarihi: p.baslangicTarihi,
      planlananBitis: p.planlananBitis,
      gerceklesenBitis: p.gerceklesenBitis,
      alanlar: p.alanlar,
      durum: p.durum,
    };
    await expect(projeGuncelle(depo, servis, projeId, girdi)).rejects.toThrow('Önce krokide tahsisleri kaldırın');
    expect((await depo.getir('proje', projeId))!.arsaTipi).toBe('kat_karsiligi');
    await tahsisKaldir(depo, servis, projeId, [bolumler[0]!.id]);
    expect((await projeGuncelle(depo, servis, projeId, girdi)).arsaTipi).toBe('satin_alma');
  });

  it('tahsisli arsa sahibi listeden çıkarılamaz; sözleşmedeki cari iptal edilemez', async () => {
    const { projeId, bolumler, ahmet, ayse } = await hazirla();
    await tahsisEt(depo, servis, projeId, [bolumler[0]!.id], ayse.id);
    await expect(
      katKarsiligiKaydet(depo, servis, projeId, { arsaSahibiOrani: 50, arsaSahipleri: [{ cariId: ahmet.id, hisse: 100 }], payYontemi: 'brut' }),
    ).rejects.toThrow('önce krokide tahsisi kaldırın');
    await expect(cariIptal(depo, servis, ahmet.id)).rejects.toThrow('iptal edilemez');
  });
});
