import { describe, expect, it } from 'vitest';
import type { Yazi } from './dxf';
import { aktarimOnerisi, birimTahmini, blokFormulOner, katBasligiCoz, kotlardanKatYuksekligi, mahalleriBul, odaSinifi, planlariBul } from './planOkuma';

const y = (metin: string, x: number, yy: number, h = 3, aci = 0): Yazi => ({ metin, x, y: yy, h, aci, katman: '' });

/** Bir plan: oda adları ve alanları ızgara düzeninde; başlık altında. */
const plan = (x0: number, baslik: string | null, odalar: [string, number][], dondur = false): Yazi[] => [
  ...odalar.flatMap(([ad, alan], i) => {
    const x = x0 + (i % 4) * 30;
    const yy = 200 + Math.floor(i / 4) * 30;
    return dondur ? [y(`${ad} ${String(alan).replace('.', ',')} m²`, x, yy)] : [y(ad, x, yy + 4), y(`${String(alan).replace('.', ',')} m²`, x, yy)];
  }),
  ...(baslik ? [y(baslik, x0 + 20, 170, 10)] : []),
];

describe('projeden okuma', () => {
  it('kat başlığı', () => {
    expect(katBasligiCoz('+3,25 KOTU ASMA KAT PLANI')).toEqual({ ad: 'Asma kat', kot: 3.25, tip: 'normal' });
    expect(katBasligiCoz('-7,00 KOTU 2. BODRUM SIĞINAK PLANI')).toMatchObject({ kot: -7, tip: 'bodrum' });
    expect(katBasligiCoz('+15,50 KOTU ÇATI KAT PLANI')).toMatchObject({ tip: 'cati' });
    expect(katBasligiCoz('ÇATI PLANI')).toMatchObject({ tip: 'diger', kot: null });
    expect(katBasligiCoz('VAZİYET PLANI Ö: 1 / 200')).toBeNull();
    expect(katBasligiCoz('NORMAL KAT İZDÜŞÜMÜ')).toBeNull();
  });

  it('mahaller: tek yazı ya da ad üstte + alan altta; toplam yazısı atlanır', () => {
    const m = mahalleriBul([y('OFİS', 10, 14), y('12,70 m²', 10, 10), y('ENGELLİ WC 4,00 m²', 50, 10), y('DÜKKAN m²', 90, 10), y('TOPLAM SIĞINAK ALAN := 104 m²', 0, 50), y('3,90', 130, 10), y('m²', 134, 10)]);
    expect(m.map((x) => [x.ad, x.alan, x.sinif])).toEqual([
      ['OFİS', 12.7, 'kuru'],
      ['ENGELLİ WC', 4, 'islak'],
      ['DÜKKAN', null, 'kuru'],
      ['Adsız mahal', 3.9, 'kuru'],
    ]);
    expect(['GALERİ BOŞLUĞU', 'KULLANILMAYAN TERAS', 'KLİMA BALKONU', 'YANGIN MERDİVENİ - 1', 'Ç.ODASI', 'BAYAN WC'].map(odaSinifi)).toEqual(['bosluk', 'bosluk', 'balkon', 'ortak', 'kuru', 'islak']);
  });

  it('planlar: yan yana planlar ayrılır, başlıklarla eşlenir (yandaki başlık öbür plana daha yakın olsa da)', () => {
    const odalar: [string, number][] = [['OFİS', 12], ['WC', 3.5], ['HOL', 4], ['Y.ODASI', 14], ['SALON', 25], ['BALKON', 6]];
    // Başlıklar planların sağında, dikey: ilk başlık ikinci plana birkaç birim daha yakın.
    const yazilar = [...plan(0, null, odalar), y('+3,25 KOTU ASMA KAT PLANI', 140, 200, 10, 90), ...plan(170, null, odalar), y('+6,25 KOTU BİRİNCİ KAT PLANI', 290, 200, 10, 90)];
    const o = planlariBul({ yazilar });
    expect(o.planlar).toHaveLength(2);
    expect(o.planlar.map((p) => [o.basliklar[p.baslik!]!.ad, p.mahaller.length, p.kutu.x0])).toEqual([
      ['Asma kat', 6, 0],
      ['Birinci kat', 6, 170],
    ]);
    // Bitişik iki plan tek küme olsa da altlarındaki iki başlıkla bölünür.
    const bitisik = planlariBul({ yazilar: [...plan(0, '+0,00 KOTU ZEMİN KAT PLANI', odalar, true), ...plan(140, '+3,00 KOTU 1. KAT PLANI', odalar, true)] });
    expect(bitisik.planlar.map((p) => p.mahaller.length)).toEqual([6, 6]);
    expect(kotlardanKatYuksekligi([-3.5, 0, 3.25, 6.5, 9.5, 12.5, null])).toBe(3.25);
  });

  it('birim tahmini ve blok önerisi', () => {
    expect(birimTahmini([0, 0, 25, 0, 0, 20, 0, 0, 500, 0, 0, 900], 4)).toBe(0.01);
    expect(birimTahmini([0, 0, 0.2, 0, 0, 0.25, 0, 0, 5], null)).toBe(1);
    expect(birimTahmini(undefined, 4)).toBe(0.001);
    expect(['KAPI 100 LÜK', 'KAPI PERVAZI 10 LUK', 'KOMBİ', 'LAVABOOO', '*U7', 'A$C3D6C2CD6'].map(blokFormulOner)).toEqual(['ic_kapi', null, 'kombi', 'lavabo', null, null]);
  });

  it('aktarım önerisi: alanlar, tekrar, yaklaşık duvar/tavan, duvar uzunluğu, bloklar, girdiler', () => {
    const o = planlariBul({ yazilar: plan(0, '+3,00 KOTU 1. KAT PLANI', [['OFİS', 16], ['WC', 4], ['HOL', 9], ['BALKON', 5], ['GALERİ BOŞLUĞU', 10]]) });
    const p = o.planlar[0]!;
    const r = aktarimOnerisi({
      dosyaAdi: 'mimari.dxf',
      planlar: [{ plan: p, secim: { no: p.no, dahil: true, tekrar: 2, ad: '1. kat', tip: 'normal', kot: 3 }, duvarUzunlugu: 100, bloklar: new Map([['KAPI 100 LÜK', 3], ['X', 1]]) }],
      siniflar: new Map(),
      blokFormulleri: new Map([['KAPI 100 LÜK', 'ic_kapi']]),
      katYuksekligi: 3,
    });
    expect(r.alanlar).toEqual({ kuru: 50, islak: 8, balkon: 10, ortak: 0, bosluk: 20 });
    expect(r.girdiler).toEqual({ islakHacimSayisi: 2, katYuksekligi: 3, normalKatSayisi: 2 });
    const s = Object.fromEntries(r.satirlar.map((x) => [x.formulKodu, x]));
    expect(s.sap!.miktar).toBe(68);
    expect(s.fayans!).toMatchObject({ miktar: 2 * 8 * 2.65, yaklasik: true });
    // kuru odalar: 2 × (4·4 + 4·3) × 2,65 duvar + tavan (50 + 8)
    expect(s.ic_siva!.miktar).toBe(Math.round(((16 + 12) * 2 * 2.65 + 58) * 100) / 100);
    expect(s.duvar!).toMatchObject({ miktar: 300, dayanak: 'mimari.dxf (1. kat ×2): duvar uzunluğu 100 m × 3 m kat yüksekliği (boşluklar düşülmedi)' });
    expect(s.ic_kapi!.miktar).toBe(6);
    expect(s.klozet).toBeUndefined();
  });
});

import { yzPlanCoz } from './planOkuma';

describe('yapay zekâ plan okuması', () => {
  it('denetler: boş/bozuk alanlar atılır, kot ve tip, kat yüksekliği', () => {
    const r = yzPlanCoz({
      katlar: [
        { ad: 'Zemin kat planı', kot: '0,00', mahaller: [{ ad: 'SALON', alan: 24.5 }, { ad: 'WC', alan: '3,2' }, { ad: 'TOPLAM', alan: 100 }, { ad: '', alan: 5 }, { ad: 'HOL', alan: -1 }] },
        { ad: '1. bodrum', kot: -3.5, mahaller: [{ ad: 'OTOPARK', alan: 420 }] },
        { ad: 'Boş', mahaller: [] },
        'bozuk',
      ],
      kat_yuksekligi: 3.1,
    })!;
    expect(r.katYuksekligi).toBe(3.1);
    expect(r.basliklar.map((b) => [b.ad, b.kot, b.tip])).toEqual([
      ['Zemin kat planı', 0, 'normal'],
      ['1. bodrum', -3.5, 'bodrum'],
    ]);
    expect(r.planlar[0]!.mahaller.map((m) => [m.ad, m.alan, m.sinif])).toEqual([
      ['SALON', 24.5, 'kuru'],
      ['WC', 3.2, 'islak'],
      ['HOL', null, 'kuru'],
    ]);
    expect(yzPlanCoz({ katlar: [] })).toBeNull();
    expect(yzPlanCoz('x')).toBeNull();
  });
});
