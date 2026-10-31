import { describe, expect, it } from 'vitest';
import type { SabitGider } from '../veri/tipler';
import { kdvTakvimi } from './kdvTakvimi';
import { aylikKarsilik, ayindaGirildi, gelecekTekrarlar, girilmeyenTekrarlar, sabitGiderHatalari, tekrarTarihleri } from './sabitGider';

const sabit = (x: Partial<SabitGider>): SabitGider =>
  ({ id: 's', firmaId: 'f', ad: 'Kira', tutar: 1_000_000, periyot: 'aylik', gun: 31, baslangic: '2026-01-15', bitis: null, cariId: 'c', projeId: null, kalemId: null, not: '', iptal: null, ...x }) as SabitGider;

describe('sabit gider', () => {
  it('tekrar günleri: kısa ay son günü, üç aylık, yıllık, bitiş', () => {
    expect(tekrarTarihleri(sabit({}), '2026-01-01', '2026-04-30')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
    expect(tekrarTarihleri(sabit({ gun: 10 }), '2026-01-01', '2026-02-28')).toEqual(['2026-02-10']);
    expect(tekrarTarihleri(sabit({ periyot: 'ucAylik', gun: 5 }), '2026-03-01', '2027-01-31')).toEqual(['2026-04-05', '2026-07-05', '2026-10-05', '2027-01-05']);
    expect(tekrarTarihleri(sabit({ periyot: 'yillik', gun: 20 }), '2026-01-01', '2028-12-31')).toEqual(['2026-01-20', '2027-01-20', '2028-01-20']);
    expect(tekrarTarihleri(sabit({ bitis: '2026-03-15' }), '2026-01-01', '2026-12-31')).toEqual(['2026-01-31', '2026-02-28']);
    expect([aylikKarsilik(sabit({ periyot: 'ucAylik', tutar: 300 })), aylikKarsilik(sabit({ periyot: 'yillik', tutar: 1200 }))]).toEqual([100, 100]);
    expect(sabitGiderHatalari({ ...sabit({}), ad: ' ', tutar: 0, gun: 32 })).toHaveLength(3);
  });

  it('o ay girildiyse sayılmaz; girilmeyen geçmiş tekrar', () => {
    const g = [{ ay: '2026-02', cariId: 'c', kalemIdleri: [] }, { ay: '2026-03', cariId: null, kalemIdleri: ['k'] }];
    expect(ayindaGirildi(sabit({}), '2026-02', g)).toBe(true);
    expect(ayindaGirildi(sabit({ cariId: null, kalemId: 'k' }), '2026-03', g)).toBe(true);
    expect(ayindaGirildi(sabit({ cariId: null }), '2026-02', g)).toBe(false);
    expect(gelecekTekrarlar([sabit({ gun: 5 })], g, '2026-02-01', '2026-03-31').map((x) => x.tarih)).toEqual(['2026-03-05']);
    expect(girilmeyenTekrarlar([sabit({ gun: 5 })], g, '2026-03-10').map((x) => x.tarih)).toEqual(['2026-03-05']);
    expect(girilmeyenTekrarlar([sabit({ gun: 5 })], g, '2026-02-10')).toEqual([]);
  });
});

describe('KDV takvimi', () => {
  it('devreden taşınır; son günü geçmiş dönem ödenmiş sayılır; ödenecek izleyen ayın 28inde', () => {
    const indirilecek = [
      { tarih: '2026-08-10', kdv: 100 },
      { tarih: '2026-09-10', kdv: 50 },
      { tarih: '2026-10-05', kdv: 30 },
    ];
    const hesaplanan = [{ tarih: '2026-11-20', kdv: 500 }];
    const t = kdvTakvimi(hesaplanan, indirilecek, '2026-10-31', '2027-01-31');
    // Ağustos+Eylül (son günleri geçti) → devreden 150; Ekim +30 → 180; Kasım 500 − 180 = 320, 28 Aralık'ta.
    expect(t.devreden).toBe(150);
    expect(t.donemler.map((d) => [d.donem, d.sonGun, d.odenecek, d.devredenSonra])).toEqual([
      ['2026-10', '2026-11-28', 0, 180],
      ['2026-11', '2026-12-28', 320, 0],
      ['2026-12', '2027-01-28', 0, 0],
    ]);
  });
});
