import { beforeEach, describe, expect, it } from 'vitest';
import { veriKatmaniniAc } from '../veri';
import type { Depo } from '../veri/depo';
import { yeniId } from '../veri/kimlik';
import { fotografEkle, fotografGuncelle, fotografIptal, fotografSecenekleri, projeFotograflari, type FotografGirdisi } from './fotograf';
import { KayitServisi, type Oturum } from './kayitServisi';
import { ilkKurulum } from './kurulum';
import { BOS_BLOK, projeKonumuKaydet, projeOlustur } from './proje';

let depo: Depo;
let oturum: Oturum;
let servis: KayitServisi;
let projeId: string;
const BUGUN = '2026-10-30';

const proje = async (ad: string) =>
  projeOlustur(
    depo,
    servis,
    { ad, il: null, ilce: null, mahalle: null, adres: '', parseller: [], arsaTipi: 'satin_alma', baslangicTarihi: null, planlananBitis: null, gerceklesenBitis: null, alanlar: { net: null, brut: null, toplamInsaat: null, satilabilir: null } },
    [{ ...BOS_BLOK, zeminBolumSayisi: 0, normalKatSayisi: 2, katBasinaDaire: 1 }],
  );

const girdi = (g: Partial<FotografGirdisi> = {}): FotografGirdisi => ({
  projeId,
  cekimTarihi: '2026-10-12',
  cekimZamani: '14:35',
  tarihKaynagi: 'exif',
  takipBasligiId: null,
  kalemId: null,
  blokId: null,
  katId: null,
  aciklama: ' 3. kat döşeme ',
  dosya: new Blob([new Uint8Array([0xff, 0xd8, 1, 2])], { type: 'image/jpeg' }),
  dosyaAdi: 'IMG_1.jpg',
  kucukResim: 'data:image/jpeg;base64,AA==',
  konum: null,
  ...g,
});

beforeEach(async () => {
  depo = await veriKatmaniniAc(`test-${yeniId()}`);
  oturum = await ilkKurulum(depo, { firmaAdi: 'Sürex İnşaat', kullaniciAdi: 'Yönetici' });
  servis = new KayitServisi(depo, oturum);
  projeId = (await proje('Güneş Apt.')).id;
});

describe('şantiye fotoğrafları', () => {
  it('ekler: künye, belge (fotoğraf, çekim tarihli) ve adlar', async () => {
    const s = await fotografSecenekleri(depo, oturum.firmaId, projeId);
    expect(s.asamalar.length).toBeGreaterThan(0);
    const blok = s.bloklar[0]!;
    const f = await fotografEkle(depo, servis, girdi({ takipBasligiId: s.asamalar[0]!.id, blokId: blok.id, katId: blok.katlar[0]!.id }), BUGUN);
    expect(f.aciklama).toBe('3. kat döşeme');
    expect(f.uzaklikKm).toBeNull();
    const belgeler = await depo.listele('belge', { firmaId: oturum.firmaId, bagliId: f.id });
    expect(belgeler).toMatchObject([{ tur: 'fotograf', tarih: '2026-10-12', bagliTur: 'projeFotografi' }]);
    const [satir] = await projeFotograflari(depo, oturum.firmaId, projeId);
    expect(satir!.asamaAdi).toBe(s.asamalar[0]!.ad);
    expect(satir!.yerAdi).toContain(blok.katlar[0]!.ad);
    expect(satir!.belgeId).toBe(belgeler[0]!.id);
  });

  it('gelecek tarih, başka projenin aşaması ve bloğa ait olmayan kat reddedilir', async () => {
    await expect(fotografEkle(depo, servis, girdi({ cekimTarihi: '2026-11-01' }), BUGUN)).rejects.toThrow('bugünden sonra');
    await expect(fotografEkle(depo, servis, girdi({ cekimTarihi: '' }), BUGUN)).rejects.toThrow('Çekim tarihini');
    const baska = await proje('Deniz');
    const sb = await fotografSecenekleri(depo, oturum.firmaId, baska.id);
    await expect(fotografEkle(depo, servis, girdi({ takipBasligiId: sb.asamalar[0]!.id }), BUGUN)).rejects.toThrow('Aşama bu projede');
    const s = await fotografSecenekleri(depo, oturum.firmaId, projeId);
    await expect(fotografEkle(depo, servis, girdi({ katId: sb.bloklar[0]!.katlar[0]!.id }), BUGUN)).rejects.toThrow('Kat bu projede');
    expect(s.bloklar.length).toBe(1);
  });

  it('proje konumu varsa uzaklık yazılır; konum saklanmaz', async () => {
    await projeKonumuKaydet(depo, servis, projeId, { enlem: 36.8969, boylam: 30.7133 });
    const yakin = await fotografEkle(depo, servis, girdi({ konum: { enlem: 36.897, boylam: 30.7134 } }), BUGUN);
    const uzak = await fotografEkle(depo, servis, girdi({ konum: { enlem: 36.99, boylam: 30.7133 } }), BUGUN);
    expect(yakin.uzaklikKm).toBe(0);
    expect(uzak.uzaklikKm).toBeCloseTo(10.3, 0);
    expect('konum' in yakin).toBe(false);
  });

  it('güncelleme belgenin tarihini de değiştirir; iptal belgeye yayılır', async () => {
    const f = await fotografEkle(depo, servis, girdi(), BUGUN);
    await fotografGuncelle(depo, servis, f.id, { ...girdi(), cekimTarihi: '2026-09-01', tarihKaynagi: 'elle', aciklama: 'Temel' }, BUGUN);
    const [b] = await depo.listele('belge', { firmaId: oturum.firmaId, bagliId: f.id });
    expect(b!.tarih).toBe('2026-09-01');
    await fotografIptal(depo, servis, f.id);
    expect(await projeFotograflari(depo, oturum.firmaId, projeId)).toEqual([]);
    expect((await depo.getir('belge', b!.id))!.iptal).not.toBeNull();
  });
});
