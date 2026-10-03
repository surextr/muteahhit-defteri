import { describe, expect, it } from 'vitest';
import type { Eslestirme, Gider, GiderSatiri } from '../veri/tipler';
import { beyanSonGunu, tevkifatDonemleri } from './tevkifat';

const Z = '2026-10-01T09:00:00.000Z';
const ortak = (id: string) => ({
  id,
  firmaId: 'f',
  olusturan: 'u',
  olusturmaZamani: Z,
  guncelleyen: 'u',
  guncellemeZamani: Z,
  surum: 1,
  iptal: null,
});
const IPTAL = { zaman: Z, kullaniciId: 'u', gerekce: 'yanlış' };
const TL = (n: number) => n * 100;

/** KDV %20, verilen tevkifatla tek satırlı gider. */
function fatura(id: string, tarih: string, matrah: number, pay: number, ek: Partial<Gider> = {}): [Gider, GiderSatiri] {
  const kdv = matrah / 5;
  const tevkifat = Math.round((kdv * pay) / 10);
  const gider: Gider = {
    ...ortak(id),
    tarih,
    projeId: null,
    cariId: 'c',
    faturaNo: id.toUpperCase(),
    vadeTarihi: null,
    aciklama: '',
    kdvHaricToplam: matrah,
    kdvToplam: kdv,
    toplam: matrah + kdv,
    tevkifatToplam: tevkifat,
    paraBirimi: 'TRY',
    kur: null,
    tur: 'alis',
    iadeEdilenGiderId: null,
    ...ek,
  };
  const satir: GiderSatiri = {
    ...ortak(`${id}-s`),
    giderId: id,
    ilaveImalatId: null,
    kalemId: null,
    aciklama: '',
    miktar: null,
    birim: null,
    birimFiyat: null,
    kdvHaricTutar: matrah,
    kdvOrani: 20,
    kdvTutari: kdv,
    tevkifat: { pay, payda: 10 },
    tevkifatTutari: tevkifat,
    toplam: matrah + kdv,
  };
  return [gider, satir];
}

const esl = (hedefId: string, tutar: number, hedefTur: Eslestirme['hedefTur'] = 'tevkifat'): Eslestirme => ({
  ...ortak(`e-${hedefId}-${hedefTur}`),
  kaynakTur: 'odeme',
  odemeId: 'o',
  hedefTur,
  hedefId,
  tutar,
});

describe('beyan son günü', () => {
  it('izleyen ayın 28i; aralıkta yıl değişir', () => {
    expect(beyanSonGunu('2026-09')).toBe('2026-10-28');
    expect(beyanSonGunu('2026-12')).toBe('2027-01-28');
  });
});

describe('aylık tevkifat', () => {
  it('fatura ayına göre toplanır, oran kırılımı ve ödenen/kalan çıkar; en yeni ay önce', () => {
    const [a, as] = fatura('a', '2026-09-05', TL(100_000), 4); // tevkifat 8.000
    const [b, bs] = fatura('b', '2026-09-30', TL(50_000), 4); // 4.000
    const [c, cs] = fatura('c', '2026-09-12', TL(10_000), 9); // 1.800
    const [d, ds] = fatura('d', '2026-10-01', TL(10_000), 5); // 1.000
    const [x, xs] = fatura('x', '2026-09-15', TL(10_000), 4, { iptal: IPTAL });
    const donemler = tevkifatDonemleri(
      [a, b, c, d, x],
      [as, bs, cs, ds, xs],
      // Tedarikçiye ödeme (hedefTur 'gider') tevkifatı kapatmaz.
      [esl('a', TL(8_000)), esl('b', TL(1_000)), esl('c', TL(1_800), 'gider')],
    );

    expect(donemler.map((p) => p.donem)).toEqual(['2026-10', '2026-09']);
    const eylul = donemler[1]!;
    expect(eylul).toMatchObject({ sonGun: '2026-10-28', toplam: TL(13_800), odenen: TL(9_000), kalan: TL(4_800) });
    expect(eylul.faturalar.map((f) => [f.gider.id, f.tevkifatTutari, f.kalan])).toEqual([
      ['a', TL(8_000), 0],
      ['c', TL(1_800), TL(1_800)],
      ['b', TL(4_000), TL(3_000)],
    ]);
    expect(eylul.oranlar).toEqual([
      { kdvOrani: 20, tevkifat: { pay: 9, payda: 10 }, matrah: TL(10_000), kdv: TL(2_000), tevkifatTutari: TL(1_800) },
      { kdvOrani: 20, tevkifat: { pay: 4, payda: 10 }, matrah: TL(150_000), kdv: TL(30_000), tevkifatTutari: TL(12_000) },
    ]);
    expect(donemler[0]).toMatchObject({ toplam: TL(1_000), kalan: TL(1_000), odenen: 0 });
  });

  it('tevkifatsız satırlar matraha girmez', () => {
    const [a, as] = fatura('a', '2026-09-05', TL(100_000), 4);
    const tevkifatsiz: GiderSatiri = { ...as, id: 'a-s2', tevkifat: null, tevkifatTutari: 0, kdvHaricTutar: TL(5_000) };
    const [p] = tevkifatDonemleri([a], [as, tevkifatsiz], []);
    expect(p!.faturalar[0]).toMatchObject({ matrah: TL(100_000), tevkifatTutari: TL(8_000) });
  });
});
