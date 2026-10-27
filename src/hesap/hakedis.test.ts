import { describe, expect, it } from 'vitest';
import type { SozlesmeBolumu, SozlesmeKalemi } from '../veri/tipler';
import {
  asamaSatiri,
  hakedisHatalari,
  hakedisTutarlari,
  hakedisUyarilari,
  metrajSatiri,
  oncekiDurum,
  oranlaDagit,
  tutarSatiri,
  type HakedisGirdisi,
} from './hakedis';

const TL = (n: number) => Math.round(n * 100);

const bolum = (id: string, ad: string, d: Partial<SozlesmeBolumu> = {}): SozlesmeBolumu => ({
  ustaTipiId: id,
  ustaTipiAdi: ad,
  sablonSurumu: 1,
  hakedisSekli: 'yuzde',
  takipYontemi: 'metraj',
  asamalar: [],
  ...d,
});
const kalem = (id: string, tip: string, ad: string, fiyat: number, miktar: number | null = 1000, kod: string | null = 'siva'): SozlesmeKalemi => ({
  id,
  ustaTipiId: tip,
  ad,
  birim: 'm²',
  aciklama: '',
  miktar,
  birimFiyat: TL(fiyat),
  butceKalemiKodu: kod,
});

const SOZLESME = {
  bolumler: [
    bolum('s', 'Sıvacı'),
    bolum('k', 'Kalıpçı (demir işçiliği dahil)', {
      takipYontemi: 'asama',
      asamalar: [
        { id: 'a1', ad: '1. kat betonu', tutar: TL(85_000) },
        { id: 'a2', ad: '2. kat betonu', tutar: TL(85_000) },
      ],
    }),
  ],
  kalemler: [kalem('ic', 's', 'İç sıva', 180), kalem('dis', 's', 'Dış sıva', 220, 500), kalem('kk', 'k', 'Kalıp', 400, null, 'kaba')],
};

const girdi = (d: Partial<HakedisGirdisi> = {}): HakedisGirdisi => ({
  tarih: '2026-11-30',
  donemAsama: 'Kasım',
  satirlar: [metrajSatiri(SOZLESME.kalemler[0]!, 400)],
  kesintiler: [],
  kdvOrani: 0,
  tevkifat: null,
  teminatOrani: 0,
  avansMahsubu: 0,
  sgkPrimiDahil: false,
  not: '',
  ...d,
});

const BOS = oncekiDurum([]);

describe('hakediş tutarı', () => {
  it('oranla dağıtım toplamı korur', () => {
    expect(oranlaDagit(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(oranlaDagit(0, [5, 5])).toEqual([0, 0]);
  });

  it('metraj: miktar × birim fiyat; KDV yok, teminat %5, avans mahsubu', () => {
    const t = hakedisTutarlari(girdi({ teminatOrani: 5, avansMahsubu: TL(20_000) }), () => 'Sıvacı');
    expect(t.brutTutar).toBe(TL(72_000));
    expect(t.borcTutari).toBe(TL(72_000));
    expect(t.teminatTutari).toBe(TL(3_600));
    expect(t.netTutar).toBe(TL(48_400));
    expect(t.giderSatirlari).toEqual([{ ustaTipiId: 's', butceKalemiKodu: 'siva', aciklama: 'Sıvacı hakedişi: İç sıva 400 m²', tutar: TL(72_000) }]);
  });

  it('kesinti işlere oranla düşer; KDV ve tevkifat kesinti sonrası tutardan', () => {
    const t = hakedisTutarlari(
      girdi({
        satirlar: [metrajSatiri(SOZLESME.kalemler[0]!, 400), asamaSatiri('k', SOZLESME.bolumler[1]!.asamalar[0]!, 'kaba')],
        kesintiler: [{ aciklama: 'Gecikme cezası', tutar: TL(15_700) }],
        kdvOrani: 20,
        tevkifat: { pay: 4, payda: 10 },
      }),
    );
    expect(t.brutTutar).toBe(TL(157_000));
    expect(t.giderSatirlari.map((x) => x.tutar)).toEqual([TL(64_800), TL(76_500)]);
    expect(t.kdvTutari).toBe(TL(28_260));
    expect(t.tevkifatTutari).toBe(TL(11_304));
    expect(t.borcTutari).toBe(TL(141_300 + 28_260 - 11_304));
  });
});

describe('önceki hakedişler ve denetim', () => {
  const onceki = oncekiDurum(
    [
      { id: 'h1', iptal: null, satirlar: [metrajSatiri(SOZLESME.kalemler[0]!, 700), asamaSatiri('k', SOZLESME.bolumler[1]!.asamalar[0]!, 'kaba')] },
      { id: 'h2', iptal: { zaman: 'z', kullaniciId: 'u', gerekce: 'x' }, satirlar: [asamaSatiri('k', SOZLESME.bolumler[1]!.asamalar[1]!, 'kaba')] },
    ],
    'h9',
  );

  it('iptal edilen sayılmaz; miktar, aşama ve iş tutarı birikir', () => {
    expect(onceki.kalemMiktari.get('ic')).toBe(700);
    expect([...onceki.asamalar]).toEqual(['a1']);
    expect(onceki.isTutari.get('k')).toBe(TL(85_000));
  });

  it('ödenmiş aşama tekrar ödenmez; sözleşme miktarı aşılırsa yalnız uyarı', () => {
    const g = girdi({ satirlar: [asamaSatiri('k', SOZLESME.bolumler[1]!.asamalar[0]!, null), metrajSatiri(SOZLESME.kalemler[0]!, 400)] });
    expect(hakedisHatalari(g, SOZLESME, onceki, 0)).toEqual(['Kalıpçı: "1. kat betonu" aşaması önceki bir hakedişte var.']);
    expect(hakedisUyarilari(g, SOZLESME, onceki)).toEqual(['"İç sıva": toplam 1.100 m², sözleşmedeki 1.000 m² miktarını aşıyor.']);
  });

  it('boş hakediş, büyük kesinti, açık avansı aşan mahsup ve KDVsiz tevkifat hata', () => {
    expect(hakedisHatalari(girdi({ satirlar: [] }), SOZLESME, BOS, 0)).toContain('En az bir iş için miktar, aşama ya da tutar girin.');
    expect(hakedisHatalari(girdi({ kesintiler: [{ aciklama: 'Ceza', tutar: TL(72_000) }] }), SOZLESME, BOS, 0)).toEqual(['Kesintiler hakediş tutarından küçük olmalı.']);
    expect(hakedisHatalari(girdi({ avansMahsubu: TL(10_000) }), SOZLESME, BOS, TL(5_000))[0]).toContain('açık avansından');
    expect(hakedisHatalari(girdi({ tevkifat: { pay: 4, payda: 10 } }), SOZLESME, BOS, 0)).toEqual(["KDV'siz hakedişte tevkifat olmaz."]);
    expect(hakedisHatalari(girdi({ satirlar: [tutarSatiri('yok', TL(1), 'x', null)] }), SOZLESME, BOS, 0)).toEqual(['Satırlardan biri sözleşmedeki bir işe bağlı değil.']);
  });
});
