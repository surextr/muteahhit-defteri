import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { veriKatmaniniAc } from '../veri';
import type { Depo } from '../veri/depo';
import { yeniId } from '../veri/kimlik';
import {
  AyniAdliCariUyarisi,
  acilisBakiyesiAyarla,
  acilisBakiyesiGetir,
  cariGuncelle,
  cariIptal,
  cariOlustur,
  carileriListele,
  cariOrtakliklari,
  ortakEkle,
  ortakOraniDegistir,
  projeOrtaklari,
  type CariGirdisi,
} from './cari';
import { KayitServisi, type Oturum } from './kayitServisi';
import { ilkKurulum } from './kurulum';
import { BOS_BLOK, projeOlustur } from './proje';

let depo: Depo;
let oturum: Oturum;
let servis: KayitServisi;

beforeEach(async () => {
  depo = await veriKatmaniniAc(`test-${yeniId()}`);
  oturum = await ilkKurulum(depo, { firmaAdi: 'Firma', kullaniciAdi: 'Yönetici' });
  servis = new KayitServisi(depo, oturum);
});
afterEach(() => depo.kapat());

const girdi = (ek: Partial<CariGirdisi> = {}): CariGirdisi => ({
  ad: 'Ahmet Usta',
  roller: ['usta'],
  telefon: null,
  vergiNo: null,
  adres: null,
  not: '',
  ...ek,
});

/** Kurulumda açılan vergi dairesi kartı dışındaki cariler. */
const kullaniciCarileri = async () =>
  (await carileriListele(depo, oturum.firmaId)).filter((c) => !c.cari.roller.includes('vergi_dairesi'));

const yarinServis = () => new KayitServisi(depo, oturum, () => new Date(Date.now() + 86_400_000));

describe('cari kartı', () => {
  it('çok rollü cari açılış bakiyesiyle oluşur; bakiye hareketlerden hesaplanır', async () => {
    const cari = await cariOlustur(
      depo,
      servis,
      girdi({ ad: '  Demir   Yapı ', roller: ['tedarikci', 'usta', 'usta'], telefon: '0532 111 22 33', vergiNo: '123 456 7890' }),
      { tutar: 2_500_000, tarih: '2026-09-30' },
    );
    expect(cari).toMatchObject({ ad: 'Demir Yapı', roller: ['usta', 'tedarikci'], vergiNo: '1234567890', telefon: '0532 111 22 33' });
    expect(cari).not.toHaveProperty('bakiye');
    expect(await kullaniciCarileri()).toEqual([{ cari, bakiye: 2_500_000 }]);

    // Ödeme yapılınca bakiye düşer; açılış bakiyesi kaydı değişmez.
    await servis.ekle('odeme', {
      tarih: '2026-10-01',
      yon: 'odeme',
      amac: 'cari',
      yontem: 'nakit',
      cariId: cari.id,
      hesapId: null,
      cekSenetId: null,
      projeId: null,
      tutar: 1_000_000,
      doviz: null,
      aciklama: '',
    });
    expect((await kullaniciCarileri())[0]!.bakiye).toBe(1_500_000);
  });

  it('sıfır açılış bakiyesi kayıt oluşturmaz', async () => {
    const cari = await cariOlustur(depo, servis, girdi(), { tutar: 0, tarih: '2026-10-01' });
    expect(await acilisBakiyesiGetir(depo, oturum.firmaId, cari.id)).toBeNull();
  });

  it.each([
    [girdi({ ad: ' ' }), 'Cari adı boş'],
    [girdi({ roller: [] }), 'En az bir rol'],
    [girdi({ vergiNo: '12345' }), 'Vergi no'],
    [girdi({ telefon: '532 11' }), 'Telefon'],
  ])('hatalı girdi reddedilir: %#', async (g, mesaj) => {
    await expect(cariOlustur(depo, servis, g)).rejects.toThrow(mesaj);
    expect(await kullaniciCarileri()).toEqual([]);
  });

  it('aynı adda cari uyarı verir, mevcut kartın telefonunu taşır; onayla açılır', async () => {
    const ilk = await cariOlustur(depo, servis, girdi({ ad: 'İsmail Usta', telefon: '0532 111 22 33' }));
    for (const ad of ['ismail  usta', 'İSMAİL USTA']) {
      const hata = await cariOlustur(depo, servis, girdi({ ad })).catch((e: unknown) => e);
      expect(hata).toBeInstanceOf(AyniAdliCariUyarisi);
      expect((hata as AyniAdliCariUyarisi).mevcutlar).toEqual([
        { id: ilk.id, ad: 'İsmail Usta', telefon: '0532 111 22 33', roller: ['usta'] },
      ]);
    }
    const ikinci = await cariOlustur(depo, servis, girdi({ ad: 'İsmail Usta', telefon: '0505 999 88 77' }), null, {
      ayniAdOnayli: true,
    });
    expect((await kullaniciCarileri()).map((c) => c.cari.id).sort()).toEqual([ilk.id, ikinci.id].sort());

    // Adı değişmeyen kart düzenlenirken tekrar sorulmaz; başka karta bu ad verilirken sorulur.
    await cariGuncelle(depo, servis, ikinci.id, girdi({ ad: 'İsmail Usta', not: 'Sıvacı' }));
    const veli = await cariOlustur(depo, servis, girdi({ ad: 'Veli' }));
    await expect(cariGuncelle(depo, servis, veli.id, girdi({ ad: 'İsmail usta' }))).rejects.toBeInstanceOf(AyniAdliCariUyarisi);
    await cariGuncelle(depo, servis, veli.id, girdi({ ad: 'İsmail usta' }), undefined, { ayniAdOnayli: true });
  });

  it('düzenleme geçmişe yazılır; kendi adını koruyabilir', async () => {
    const cari = await cariOlustur(depo, servis, girdi());
    const guncel = await cariGuncelle(depo, servis, cari.id, girdi({ roller: ['usta', 'ortak'], not: 'Kalıpçı' }));
    expect(guncel).toMatchObject({ roller: ['usta', 'ortak'], not: 'Kalıpçı', surum: 2 });
    const kayitlar = await depo.listele('islemGecmisi', { kayitId: cari.id });
    expect(kayitlar.find((k) => k.islem === 'guncelle')?.yeni).toEqual({ roller: ['usta', 'ortak'], not: 'Kalıpçı' });
  });

  it('açılış bakiyesi değiştirilir ve iptal edilir; sonraki gün gerekçe ister', async () => {
    const cari = await cariOlustur(depo, servis, girdi(), { tutar: -500_000, tarih: '2026-09-30' });
    await acilisBakiyesiAyarla(depo, servis, cari.id, { tutar: -700_000, tarih: '2026-09-30' });
    expect((await acilisBakiyesiGetir(depo, oturum.firmaId, cari.id))?.tutar).toBe(-700_000);

    await expect(acilisBakiyesiAyarla(depo, yarinServis(), cari.id, null)).rejects.toThrow('gerekçe');
    await acilisBakiyesiAyarla(depo, yarinServis(), cari.id, null, 'Hesaplaştık');
    expect(await acilisBakiyesiGetir(depo, oturum.firmaId, cari.id)).toBeNull();
    expect((await kullaniciCarileri())[0]!.bakiye).toBe(0);
  });

  it('hareketi olmayan cari iptal edilir, açılış bakiyesi de iptal olur', async () => {
    const cari = await cariOlustur(depo, servis, girdi(), { tutar: 100, tarih: '2026-09-30' });
    const acilis = await acilisBakiyesiGetir(depo, oturum.firmaId, cari.id);
    await cariIptal(depo, servis, cari.id);
    expect(await kullaniciCarileri()).toEqual([]);
    expect((await depo.getir('acilisBakiyesi', acilis!.id))?.iptal).not.toBeNull();
  });
});

describe('proje ortakları', () => {
  const projeKur = () =>
    projeOlustur(
      depo,
      servis,
      { ad: 'Gül', il: null, ilce: null, mahalle: null, adres: '', parseller: [], planlananBitis: null, gerceklesenBitis: null, arsaTipi: 'satin_alma', baslangicTarihi: null, alanlar: { net: null, brut: null, toplamInsaat: null, satilabilir: null } },
      [BOS_BLOK],
    );

  it('ortak eklenir; oranlar toplamı %100\'ü geçemez', async () => {
    const p = await projeKur();
    const veli = await cariOlustur(depo, servis, girdi({ ad: 'Veli', roller: ['ortak'] }));
    const ayse = await cariOlustur(depo, servis, girdi({ ad: 'Ayşe', roller: ['ortak', 'musteri'] }));

    await ortakEkle(depo, servis, p.id, veli.id, 30);
    await expect(ortakEkle(depo, servis, p.id, ayse.id, 75)).rejects.toThrow('%105');
    await ortakEkle(depo, servis, p.id, ayse.id, 70);
    expect((await projeOrtaklari(depo, oturum.firmaId, p.id)).map((o) => [o.cari.ad, o.ortaklik.oran])).toEqual([
      ['Ayşe', 70],
      ['Veli', 30],
    ]);
    expect((await cariOrtakliklari(depo, oturum.firmaId, veli.id))[0]!.proje.ad).toBe('Gül');

    await expect(ortakEkle(depo, servis, p.id, veli.id, 0.5)).rejects.toThrow();
  });

  it('ortak rolü olmayan cari ve aynı cari iki kez eklenemez; oran değişir', async () => {
    const p = await projeKur();
    const usta = await cariOlustur(depo, servis, girdi());
    await expect(ortakEkle(depo, servis, p.id, usta.id, 10)).rejects.toThrow('ortak" rolü yok');

    const veli = await cariOlustur(depo, servis, girdi({ ad: 'Veli', roller: ['ortak'] }));
    const o = await ortakEkle(depo, servis, p.id, veli.id, 40);
    await expect(ortakEkle(depo, servis, p.id, veli.id, 10)).rejects.toThrow('zaten ortak');
    await ortakOraniDegistir(depo, servis, o.id, 50);
    await expect(ortakOraniDegistir(depo, servis, o.id, 120)).rejects.toThrow('en çok 100');
    expect((await depo.getir('projeOrtagi', o.id))?.oran).toBe(50);
  });

  it('ortak olan cari iptal edilemez ve ortak rolü kaldırılamaz', async () => {
    const p = await projeKur();
    const veli = await cariOlustur(depo, servis, girdi({ ad: 'Veli', roller: ['ortak'] }));
    await ortakEkle(depo, servis, p.id, veli.id, 40);
    await expect(cariIptal(depo, servis, veli.id)).rejects.toThrow('iptal edilemez');
    await expect(cariGuncelle(depo, servis, veli.id, girdi({ ad: 'Veli', roller: ['musteri'] }))).rejects.toThrow('ortak');
  });
});
