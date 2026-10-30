import { describe, expect, it } from 'vitest';
import { anaKalem, karsilastir, type GercekSatir, type PlanSatiri } from './karsilastirma';

const plan = (p: Partial<PlanSatiri>): PlanSatiri => ({ id: 'p', ad: 'Hazır beton (betonarme)', tur: 'malzeme', birim: 'm³', kod: 'beton', miktar: 400, birimFiyat: 300000, tutar: 120000000, ...p });
const gercek = (g: Partial<GercekSatir>): GercekSatir => ({
  kod: 'beton',
  kodAdi: 'Beton',
  anaKod: 'kaba_insaat',
  anaAdi: 'Kaba inşaat',
  aciklama: 'C30 beton',
  miktar: 100,
  birim: 'm3',
  tutar: 33000000,
  tarih: '2026-10-01',
  giderId: 'g',
  ...g,
});

describe('başlangıç maliyeti ile gerçekleşen', () => {
  it('ana kalem kodu', () => {
    expect(anaKalem('beton')).toEqual({ kod: 'kaba_insaat', ad: 'Kaba inşaat' });
    expect(anaKalem(null)).toEqual({ kod: null, ad: 'Kalemsiz' });
  });

  it('eşleşen kalemde fiyat ve miktar farkı, birim çevirme; planda olmayan; harcanmamış; ilerleme ve uyarı', () => {
    const planlar = [
      plan({}),
      plan({ id: 'd', ad: 'Nervürlü demir (bütün çaplar)', birim: 'ton', miktar: 44, birimFiyat: 2500000, tutar: 110000000 }),
      plan({ id: 'k', ad: 'Kalıpçı · Temel', tur: 'iscilik', birim: 'm²', miktar: 500, birimFiyat: 20000, tutar: 10000000 }),
      plan({ id: 's', ad: 'Sıvacı · İç sıva', kod: 'siva', birim: 'm²', miktar: 1000, birimFiyat: 15000, tutar: 15000000 }),
    ];
    const gercekler = [
      gercek({}),
      gercek({ aciklama: 'C30 beton pompalı', miktar: 50, tutar: 17500000 }),
      gercek({ kod: 'demir', aciklama: 'Ø12 nervürlü demir', miktar: 10000, birim: 'kg', tutar: 27000000 }),
      gercek({ kod: 'demir', aciklama: 'Bağ teli', miktar: 50, birim: 'kg', tutar: 500000 }),
    ];
    const r = karsilastir(planlar, gercekler, new Map([['kaba_insaat', 20]]), 10);
    const kaba = r.kalemler.find((k) => k.kod === 'kaba_insaat')!;
    expect(kaba).toMatchObject({ plan: 240000000, gercek: 78000000, ilerleme: 20, beklenen: 48000000, sapma: 30000000, uyari: true });
    const beton = kaba.eslesmeler.find((e) => e.plan.id === 'p')!;
    // 150 m³ × 3.000 TL = 450.000 planlanan fiyatla; gerçek 505.000 → fiyat farkı 55.000 TL
    expect(beton).toMatchObject({ gercekTutar: 50500000, gercekMiktar: 150, ortalamaFiyat: 336667, fiyatFarki: 5500000, miktarFarki: (150 - 400) * 300000 });
    expect(kaba.eslesmeler.find((e) => e.plan.id === 'd')).toMatchObject({ gercekMiktar: 10, fiyatFarki: 27000000 - 25000000 });
    expect(kaba.plandaYok.map((g) => g.aciklama)).toEqual(['Bağ teli']);
    expect(kaba.harcanmamis.map((p) => p.id)).toEqual(['k']);
    const ince = r.kalemler.find((k) => k.kod === 'ince_insaat' || k.ad !== 'Kaba inşaat')!;
    expect(ince).toMatchObject({ plan: 15000000, gercek: 0, ilerleme: null, sapma: null });
    expect(r).toMatchObject({ plan: 255000000, gercek: 78000000, ilerleme: 20, beklenen: 48000000, sapma: 30000000, fiyatFarki: 5500000 + 2000000, plandaYok: 500000 });
  });

  it('miktarsız satırda yalnız tutar; birimi plana uymayan benzer satır (pompa · sefer) planda yok sayılır', () => {
    const r = karsilastir([plan({})], [gercek({ miktar: null }), gercek({ aciklama: 'Beton pompası', miktar: 1, birim: 'sefer' })], new Map(), 10);
    expect(r.kalemler[0]!.eslesmeler[0]).toMatchObject({ gercekTutar: 33000000, gercekMiktar: null, fiyatFarki: null, miktarFarki: null });
    expect(r.kalemler[0]!.plandaYok.map((g) => g.aciklama)).toEqual(['Beton pompası']);
    expect(r.ilerleme).toBeNull();
  });
});
