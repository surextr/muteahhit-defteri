import { describe, expect, it } from 'vitest';
import type { Gider, GiderSatiri, Kalem } from '../veri/tipler';
import { butceAgaci, kalemGerceklesen } from './butce';

const ortak = (id: string) => ({
  id,
  firmaId: 'f1',
  olusturan: 'u1',
  olusturmaZamani: '2026-10-01T09:00:00.000Z',
  guncelleyen: 'u1',
  guncellemeZamani: '2026-10-01T09:00:00.000Z',
  surum: 1,
  iptal: null,
});
const IPTAL = { zaman: '2026-10-02T09:00:00.000Z', kullaniciId: 'u1', gerekce: '' };
const TL = (n: number) => n * 100;

const kalem = (id: string, ust: string | null, butce: number | null, sira = 1, ek: Partial<Kalem> = {}): Kalem => ({
  ...ortak(id),
  projeId: 'p1',
  sistemKodu: null,
  ustKalemId: ust,
  ad: id,
  birim: null,
  butceMiktari: null,
  butceTutari: butce === null ? null : TL(butce),
  sira,
  ...ek,
});

const harcama = (pairs: [string | null, number][]) => new Map(pairs.map(([k, v]) => [k, TL(v)]));

describe('bütçe ağacı', () => {
  it('ana kalem alt kalemlerinin toplamıdır; aynı maliyet iki kez sayılmaz', () => {
    const ozet = butceAgaci(
      [
        kalem('kaba', null, null, 1),
        kalem('beton', 'kaba', 1_000_000, 2),
        kalem('demir', 'kaba', 600_000, 1),
        kalem('arsa', null, 3_000_000, 0),
      ],
      harcama([
        ['beton', 1_100_000],
        ['demir', 200_000],
        ['arsa', 3_000_000],
      ]),
    );
    expect(ozet.dugumler.map((d) => d.kalem.id)).toEqual(['arsa', 'kaba']);
    const kaba = ozet.dugumler[1]!;
    expect(kaba.altlar.map((a) => a.kalem.id)).toEqual(['demir', 'beton']);
    expect(kaba).toMatchObject({ butce: TL(1_600_000), gerceklesen: TL(1_300_000), kalan: TL(300_000) });
    expect(kaba.altlar[1]).toMatchObject({ kalan: -TL(100_000), oran: 110 });
    expect(ozet).toMatchObject({ butce: TL(4_600_000), gerceklesen: TL(4_300_000), kalemsiz: 0, butcesizHarcama: 0 });
  });

  it('bütçesi olmayan kalemin bütçesi null; harcaması ayrıca bildirilir', () => {
    const ozet = butceAgaci(
      [kalem('genel', null, null), kalem('su', 'genel', null), kalem('elektrik', 'genel', 50)],
      harcama([['su', 30], ['elektrik', 20]]),
    );
    const genel = ozet.dugumler[0]!;
    expect(genel.altlar[0]).toMatchObject({ butce: null, kalan: null, oran: null, gerceklesen: TL(30) });
    expect(genel).toMatchObject({ butce: TL(50), gerceklesen: TL(50) });
    expect(ozet.butcesizHarcama).toBe(TL(30));
  });

  it('kalemsiz ve iptal edilmiş kaleme yazılmış harcama kaybolmaz', () => {
    const ozet = butceAgaci(
      [kalem('a', null, 100), kalem('b', null, 100, 2, { iptal: IPTAL }), kalem('c', 'b', 50)],
      harcama([[null, 10], ['b', 20], ['c', 5], ['a', 40]]),
    );
    expect(ozet.dugumler.map((d) => d.kalem.id)).toEqual(['a']);
    expect(ozet).toMatchObject({ butce: TL(100), kalemsiz: TL(35), gerceklesen: TL(75) });
  });
});

describe('kalem gerçekleşeni', () => {
  const gider = (id: string, iptal = false): Gider => ({
    ...ortak(id),
    iptal: iptal ? IPTAL : null,
    tarih: '2026-10-01',
    projeId: 'p1',
    cariId: null,
    faturaNo: null,
    vadeTarihi: null,
    aciklama: '',
    kdvHaricToplam: 0,
    kdvToplam: 0,
    toplam: 0,
    tevkifatToplam: 0,
    paraBirimi: 'TRY',
    kur: null,
    tur: 'alis',
    iadeEdilenGiderId: null,
  });
  const satir = (id: string, giderId: string, kalemId: string | null, haric: number): GiderSatiri => ({
    ...ortak(id),
    giderId,
    kalemId,
    aciklama: '',
    miktar: null,
    birim: null,
    birimFiyat: null,
    kdvHaricTutar: TL(haric),
    kdvOrani: 20,
    kdvTutari: TL(haric * 0.2),
    tevkifat: null,
    tevkifatTutari: 0,
    toplam: TL(haric * 1.2), ilaveImalatId: null,
  });

  it('KDV ayarına göre toplar; iptal gider sayılmaz', () => {
    const satirlar = [satir('s1', 'g1', 'beton', 100), satir('s2', 'g1', null, 50), satir('s3', 'g2', 'beton', 1_000)];
    const giderler = [gider('g1'), gider('g2', true)];
    expect(kalemGerceklesen(satirlar, giderler, true)).toEqual(new Map([['beton', TL(120)], [null, TL(60)]]));
    expect(kalemGerceklesen(satirlar, giderler, false)).toEqual(new Map([['beton', TL(100)], [null, TL(50)]]));
  });
});
