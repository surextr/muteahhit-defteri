import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { odaTipiSecenekleri } from '../hesap/odaTipi';
import { veriKatmaniniAc } from '../veri';
import type { Depo } from '../veri/depo';
import { yeniId } from '../veri/kimlik';
import type { Firma } from '../veri/tipler';
import { topluOzellikVer } from './bina';
import { KayitServisi, type Oturum } from './kayitServisi';
import { ilkKurulum } from './kurulum';
import { odaTipiEkle, odaTipiGizle, odaTipiKullanimi } from './odaTipi';
import { BOS_BLOK, projeOlustur, projeYapisiGetir } from './proje';

let depo: Depo;
let oturum: Oturum;
let servis: KayitServisi;

beforeEach(async () => {
  depo = await veriKatmaniniAc(`test-${yeniId()}`);
  oturum = await ilkKurulum(depo, { firmaAdi: 'Firma', kullaniciAdi: 'Yönetici' });
  servis = new KayitServisi(depo, oturum);
});
afterEach(() => depo.kapat());

const firma = async () => (await depo.getir('firma', oturum.firmaId)) as Firma;

describe('oda tipi listesi', () => {
  it('kullanım sıklığı sıralamayı belirler', async () => {
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
    const b = (await projeYapisiGetir(depo, oturum.firmaId, p.id))!.bloklar[0]!.katlar.flatMap((k) => k.bolumler);
    await topluOzellikVer(depo, servis, [b[0]!.id, b[1]!.id, b[2]!.id], { odaSayisi: 2, salonSayisi: 1 });
    await topluOzellikVer(depo, servis, [b[3]!.id], { odaSayisi: 4, salonSayisi: 2 });
    const kullanim = await odaTipiKullanimi(depo, oturum.firmaId);
    expect(kullanim.get('2+1')).toBe(3);
    expect(odaTipiSecenekleri((await firma()).ayarlar.odaTipleri, kullanim)[0]).toBe('2+1');
  });

  it('ekleme, tekrar eklemede değişmez; gizleme ve geri gösterme', async () => {
    expect(await odaTipiEkle(servis, await firma(), ' 4 + 2 ')).toBe('4+2');
    await odaTipiEkle(servis, await firma(), '4+2');
    expect((await firma()).ayarlar.odaTipleri.eklenen).toEqual(['4+2']);
    await expect(odaTipiEkle(servis, await firma(), 'dört artı iki')).rejects.toThrow('4+2');

    await odaTipiGizle(servis, await firma(), '5+1', true);
    expect(odaTipiSecenekleri((await firma()).ayarlar.odaTipleri, new Map())).not.toContain('5+1');
    // Gizli tipi "+ Ekle" ile yazmak onu yeniden gösterir.
    await odaTipiEkle(servis, await firma(), '5+1');
    expect((await firma()).ayarlar.odaTipleri).toEqual({ eklenen: ['4+2'], gizli: [] });
  });
});
