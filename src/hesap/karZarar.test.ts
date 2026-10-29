import { describe, expect, it } from 'vitest';
import type { BagimsizBolum, Kalem, Satis } from '../veri/tipler';
import { butceAgaci } from './butce';
import { ayAdi, karZarar, type RaporSatisi } from './karZarar';
import { satisPlanDurumu } from './satis';

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
const TL = (n: number) => n * 100;

const kalem = (id: string, butce: number | null): Kalem => ({
  ...ortak(id),
  projeId: 'p1',
  sistemKodu: null,
  ustKalemId: null,
  ad: id,
  birim: null,
  butceMiktari: null,
  butceTutari: butce === null ? null : TL(butce),
  sira: 1,
});
const bolum = (id: string, brutM2: number | null, ek: Partial<BagimsizBolum> = {}) =>
  ({ ...ortak(id), projeId: 'p1', brutM2, sahiplik: 'muteahhit', ...ek }) as unknown as BagimsizBolum;

const satis = (id: string, b: BagimsizBolum, fiyat: number, imzali: boolean, plan: [string, number, number][]): RaporSatisi => {
  const s = {
    ...ortak(id),
    bolumId: b.id,
    fiyat: TL(fiyat),
    indirim: 0,
    kdvOrani: 1,
    takas: [],
    plan: plan.map(([vade, tutar], i) => ({
      id: `${id}-${i}`,
      tur: 'taksit',
      vadeTarihi: vade,
      tutar: TL(tutar),
      aciklama: '',
      alacakId: imzali ? `${id}-a${i}` : null,
    })),
    onay: imzali ? { zaman: '', kullaniciId: 'u1' } : null,
  } as unknown as Satis;
  const kalanlar = new Map(plan.map(([, tutar, tahsil], i) => [`${id}-a${i}`, TL(tutar - tahsil)]));
  return { satis: s, bolum: b, durumlar: satisPlanDurumu(s.plan, kalanlar, '2026-11-10') };
};

describe('kâr/zarar', () => {
  const butce = butceAgaci(
    [kalem('kaba', 4_000_000), kalem('ince', 3_000_000), kalem('genel', null)],
    new Map([
      ['kaba', TL(4_500_000)],
      ['ince', TL(500_000)],
      ['genel', TL(200_000)],
      [null, TL(100_000)],
    ]),
  );
  const b = [bolum('b1', 100), bolum('b2', 100), bolum('b3', 150), bolum('b4', 120, { sahiplik: 'arsa_sahibi' }), bolum('b5', 100)];
  const satislar = [
    satis('s1', b[0]!, 3_030_000, true, [
      ['2026-10-01', 1_030_000, 1_030_000],
      ['2026-11-01', 1_000_000, 0],
      ['2027-01-15', 1_000_000, 0],
    ]),
    satis('s2', b[1]!, 2_020_000, false, [['2026-12-01', 2_020_000, 0]]),
  ];

  const r = karZarar({
    butce,
    satislar,
    bolumler: b,
    ilaveImalat: [{ tarih: '2026-10-05', vadeTarihi: '2026-12-20', tutar: TL(100_000), kalan: TL(40_000) }],
    borclar: [
      { tarih: '2026-10-01', vadeTarihi: '2026-10-30', borc: TL(1_000_000), kalan: TL(300_000) },
      { tarih: '2026-11-01', vadeTarihi: '2027-02-01', borc: TL(500_000), kalan: TL(500_000) },
      { tarih: '2026-09-01', vadeTarihi: null, borc: TL(800_000), kalan: 0 },
    ],
    bugun: '2026-11-10',
    aySayisi: 3,
  });

  it('gelir KDV hariç; satılmamış bölümler imzalı satışların m² ortalamasıyla tahmin edilir', () => {
    expect(r.gelir.imzali).toEqual({ adet: 1, net: TL(3_030_000), kdvHaric: TL(3_000_000), takas: 0 });
    expect(r.gelir.rezerve.kdvHaric).toBe(TL(2_000_000));
    // b3 (150 m²) + b5 (100 m²) × 30.000 TL/m²
    expect(r.gelir.satilmamis).toEqual({ adet: 2, tahmin: TL(7_500_000), yontem: 'm2' });
    expect(r.gelir.arsaSahibiAdet).toBe(1);
    expect(r.gelir.tahmini).toBe(TL(3_000_000 + 2_000_000 + 100_000 + 7_500_000));
  });

  it('tahmini maliyet bütçe aşımını içerir; kâr ve başabaş', () => {
    // kaba 4.5M (aşım) + ince 3M + genel 0.2M (bütçesiz) + kalemsiz 0.1M
    expect(r.maliyet).toMatchObject({ gerceklesen: TL(5_300_000), butce: TL(7_000_000), tahmini: TL(7_800_000), kalan: TL(2_500_000), butcesizKalemVar: true });
    expect(r.kar.tahmini).toBe(TL(12_600_000 - 7_800_000));
    expect(r.kar.basabasIcinGereken).toBe(TL(7_800_000 - 5_100_000));
    expect(r.kar.basabasBolumBasina).toBe(TL(1_350_000));
  });

  it('nakit: tahsil/ödenen ve aylara göre bekleyen giriş-çıkış', () => {
    expect(r.nakit).toMatchObject({
      tahsilEdilen: TL(1_030_000 + 60_000),
      odenen: TL(700_000 + 800_000),
      bekleyenTahsilat: TL(2_040_000),
      odenecekBorc: TL(800_000),
    });
    expect(r.nakit.aylar.map((a) => [a.ay, a.giris / 100, a.cikis / 100, a.birikimli / 100])).toEqual([
      ['gecmis', 1_000_000, 300_000, 700_000],
      ['2026-11', 0, 0, 700_000],
      ['2026-12', 40_000, 0, 740_000],
      ['2027-01', 1_000_000, 0, 1_740_000],
      ['sonra', 0, 500_000, 1_240_000],
    ]);
    expect(ayAdi('2026-12')).toBe('Aralık 2026');
  });

  it('m² eksikse adet ortalaması; satış yoksa tahmin yok', () => {
    const adet = karZarar({ butce, satislar, bolumler: [...b, bolum('b6', null)], ilaveImalat: [], borclar: [], bugun: '2026-11-10' });
    expect(adet.gelir.satilmamis).toEqual({ adet: 3, tahmin: TL(9_000_000), yontem: 'adet' });
    const yok = karZarar({ butce, satislar: [], bolumler: b, ilaveImalat: [], borclar: [], bugun: '2026-11-10' });
    expect(yok.gelir.satilmamis.tahmin).toBeNull();
    expect(yok.kar.basabasBolumBasina).toBe(TL(1_950_000));
  });
});

describe('firma raporu', () => {
  it('projeleri ve genel giderleri toplar; nakit akışı eldeki paradan başlar, aylar birleşir', async () => {
    const { firmaRaporu } = await import('./karZarar');
    const bos = butceAgaci([], new Map());
    const p1 = karZarar({
      butce: butceAgaci([kalem('k', 1_000_000)], new Map([['k', TL(400_000)]])),
      satislar: [satis('s1', bolum('b1', 100), 2_020_000, true, [['2026-12-01', 2_020_000, 20_000]])],
      bolumler: [bolum('b1', 100)],
      ilaveImalat: [],
      borclar: [{ tarih: '2026-11-01', vadeTarihi: '2026-12-15', borc: TL(100_000), kalan: TL(100_000) }],
      bugun: '2026-11-10',
      aySayisi: 3,
    });
    const p2 = karZarar({ butce: bos, satislar: [], bolumler: [], ilaveImalat: [], borclar: [], bugun: '2026-11-10', aySayisi: 3 });
    const f = firmaRaporu({
      projeler: [
        { projeId: 'p2', ad: 'Boş', rapor: p2 },
        { projeId: 'p1', ad: 'Güneş', rapor: p1 },
      ],
      genelHarcanan: TL(50_000),
      genelBorclar: [{ tarih: '2026-10-01', vadeTarihi: '2026-11-05', borc: TL(30_000), kalan: TL(30_000) }],
      eldeki: TL(500_000),
      bugun: '2026-11-10',
      aySayisi: 3,
    });
    expect(f.projeler.map((p) => p.projeId)).toEqual(['p1', 'p2']);
    expect(f).toMatchObject({ gelir: TL(2_000_000), maliyet: TL(1_050_000), kar: TL(950_000), genel: { harcanan: TL(50_000), odenecek: TL(30_000) } });
    expect(f.aylar.map((a) => [a.ay, a.giris / 100, a.cikis / 100, a.birikimli / 100])).toEqual([
      ['gecmis', 0, 30_000, 470_000],
      ['2026-11', 0, 0, 470_000],
      ['2026-12', 2_000_000, 100_000, 2_370_000],
      ['2027-01', 0, 0, 2_370_000],
    ]);
  });
});
