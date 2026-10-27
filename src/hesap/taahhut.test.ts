import { describe, expect, it } from 'vitest';
import { esitTaksitler, planDurumu, sozlesmeTaahhudu } from './taahhut';

const TL = (n: number) => Math.round(n * 100);
const p = (id: string, vadeTarihi: string, tutar: number) => ({ id, vadeTarihi, tutar: TL(tutar), aciklama: '' });

describe('ödeme planı', () => {
  it('ödenen en eski vadeden dağılır; durumlar bugüne göre', () => {
    const d = planDurumu([p('c', '2027-03-01', 100), p('a', '2026-10-01', 100), p('b', '2026-11-15', 100)], TL(150), '2026-11-01');
    expect(d.map((x) => [x.plan.id, x.odenen / 100, x.kalan / 100, x.durum])).toEqual([
      ['a', 100, 0, 'odendi'],
      ['b', 50, 50, 'kismen'],
      ['c', 0, 100, 'ileride'],
    ]);
    expect(planDurumu([p('a', '2026-10-01', 100), p('b', '2026-11-20', 100)], 0, '2026-11-01').map((x) => x.durum)).toEqual(['gecikti', 'yaklasan']);
  });

  it('eşit taksit: kuruş farkı sonuncuya, ay sonu taşmaz', () => {
    expect(esitTaksitler(TL(100), 3, '2027-01-31')).toEqual([
      { vadeTarihi: '2027-01-31', tutar: 3333 },
      { vadeTarihi: '2027-02-28', tutar: 3333 },
      { vadeTarihi: '2027-03-31', tutar: 3334 },
    ]);
    expect(esitTaksitler(0, 3, '2027-01-01')).toEqual([]);
  });
});

describe('sözleşme taahhüdü', () => {
  it('yalnız onaylı hakedişler; kalan borç, kalan iş, bekleyen teminat, geciken plan', () => {
    const h = (onayli: boolean, brut: number) => ({ onay: onayli ? { zaman: 'z', kullaniciId: 'u' } : null, iptal: null, brutTutar: TL(brut), kesintiToplam: 0, borcTutari: TL(brut), teminatTutari: TL(brut / 20) });
    const t = sozlesmeTaahhudu({
      sozlesmeTutari: TL(500_000),
      eksikMiktar: false,
      hakedisler: [h(true, 200_000), h(false, 100_000)],
      teminatIadeleri: [],
      odenen: TL(150_000),
      plan: [p('a', '2026-10-01', 100_000), p('b', '2026-10-15', 100_000)],
      bugun: '2026-11-01',
    });
    expect(t).toMatchObject({ hakedisTutari: TL(200_000), borc: TL(200_000), kalanBorc: TL(50_000), kalanIs: TL(300_000), bekleyenTeminat: TL(10_000), geciken: TL(50_000) });
  });
});
