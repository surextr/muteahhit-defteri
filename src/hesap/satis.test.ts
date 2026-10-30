import { describe, expect, it } from 'vitest';
import type { SatisPlanSatiri } from '../veri/tipler';
import {
  bolumTanimi,
  planOner,
  satisEksikleri,
  satisKayitHatalari,
  satisOzeti,
  satisPlanDurumu,
  satisProtokolu,
  satisTutarlari,
  type SatisIcerigi,
} from './satis';

const TL = (n: number) => Math.round(n * 100);
const p = (id: string, tur: SatisPlanSatiri['tur'], vade: string, tutar: number, alacakId: string | null = null): SatisPlanSatiri => ({
  id,
  tur,
  vadeTarihi: vade,
  tutar: TL(tutar),
  aciklama: '',
  alacakId,
});

const icerik = (d: Partial<SatisIcerigi> = {}): SatisIcerigi => ({
  tarih: '2026-11-01',
  fiyat: TL(3_000_000),
  indirim: TL(100_000),
  kdvOrani: 1,
  takas: [{ aciklama: '2019 model araç', deger: TL(900_000) }],
  ekIstekler: [],
  plan: [p('a', 'pesinat', '2026-11-01', 1_000_000), p('b', 'taksit', '2026-12-01', 500_000), p('c', 'taksit', '2027-01-01', 500_000)],
  teslimTarihi: '2027-06-30',
  tapuTarihi: null,
  maddeler: [{ id: 'tapu', baslik: 'Tapu devri ve masrafları', metin: 'Tapu harcı alıcıya aittir.' }],
  not: '',
  doviz: null,
  ...d,
});

const KUNYE = {
  bolum: { no: '7', tip: 'daire' as const, odaSayisi: 3, salonSayisi: 1, dubleks: 'cati' as const, brutM2: 136, netM2: 110, cephe: null },
  blokAdi: 'A',
  katAdi: '3. Kat',
};

describe('satış tutarları ve eksikler', () => {
  it('net = fiyat − indirim, nakit = net − takas, KDV ayrılır, plan farkı', () => {
    expect(satisTutarlari(icerik())).toEqual({
      ekler: 0,
      net: TL(2_900_000),
      takas: TL(900_000),
      nakit: TL(2_000_000),
      kdvHaric: TL(2_871_287.13),
      kdv: TL(28_712.87),
      planToplami: TL(2_000_000),
      planFarki: 0,
    });
    expect(satisEksikleri(icerik())).toEqual([]);
  });

  it('plan eksik/fazla, teslim tarihi, boş hüküm sorulur; takas bedeli aşamaz', () => {
    expect(
      satisEksikleri(icerik({ plan: [p('a', 'pesinat', '2026-11-01', 1_500_000)], teslimTarihi: null, maddeler: [{ id: 'x', baslik: 'Cayma', metin: ' ' }] })),
    ).toEqual(['Teslim tarihi yazılmadı.', 'Ödeme planının toplamı tahsil edilecek tutardan ₺500.000,00 eksik.', 'Hüküm yazılmadı: Cayma']);
    expect(satisKayitHatalari(icerik({ takas: [{ aciklama: 'Arsa', deger: TL(5_000_000) }] }))).toContain('Takas değeri satış bedelinden büyük olamaz.');
    expect(satisKayitHatalari(icerik({ kdvOrani: 8 }))).toEqual(['KDV oranını seçin.']);
  });
});

describe('plan durumu', () => {
  it('imzasızda bekliyor; alacak kalanına göre tahsil/kısmen/gecikti/yaklaşan', () => {
    const plan = [
      p('a', 'pesinat', '2026-11-01', 100, 'A'),
      p('b', 'taksit', '2026-12-01', 100, 'B'),
      p('c', 'taksit', '2026-12-20', 100, 'C'),
      p('d', 'taksit', '2027-06-01', 100, 'D'),
    ];
    const d = satisPlanDurumu(
      plan,
      new Map([
        ['A', 0],
        ['B', TL(40)],
        ['C', TL(100)],
        ['D', TL(100)],
      ]),
      '2026-12-05',
    );
    expect(d.map((x) => x.durum)).toEqual(['tahsil_edildi', 'gecikti', 'yaklasan', 'ileride']);
    const o = satisOzeti({ fiyat: TL(400), indirim: 0, kdvOrani: 1, takas: [], plan }, d);
    expect(o).toMatchObject({ net: TL(400), tahsil: TL(160), kalan: TL(240), geciken: TL(40) });
    expect(o.sonraki?.satir.id).toBe('b');
    expect(satisPlanDurumu([p('a', 'kapora', '2026-11-01', 10)], new Map(), '2026-12-01')[0]!.durum).toBe('bekliyor');
  });
});

describe('protokol', () => {
  it('bölüm tanımı, bedel, takas, plan tablosu, teslim ve hükümler', () => {
    expect(bolumTanimi(KUNYE)).toBe('A Blok, 3. Kat, A-7 numaralı daire (3+1, çatı dubleksi; brüt 136 m², net 110 m²)');
    const m = satisProtokolu(icerik(), {
      ...KUNYE,
      firma: { ad: 'Sürex İnşaat', bilgiler: { yetkili: 'Süleyman Özdemir', telefon: '', eposta: '', web: '', adres: '', vergiDairesi: '', vergiNo: '' } },
      cari: { ad: 'Ayşe Kaya', telefon: '0 532 000 00 00', vergiNo: '12345678901', adres: null },
      proje: { ad: 'Güneş Apt.', parseller: [{ ada: '101', parsel: '5', alanM2: null }] },
      projeAdresi: 'Korkuteli / Antalya',
    });
    expect(m.baslik).toBe('ÖN SATIŞ PROTOKOLÜ');
    expect(m.altBaslik).toBe('Güneş Apt. · A-7');
    expect(m.taraflar[1]).toMatchObject({ rol: 'Alıcı', ad: 'Ayşe Kaya', satirlar: ['TC / Vergi no: 12345678901', 'Tel: 0 532 000 00 00'] });
    const madde = (b: string) => m.maddeler.find((x) => x.baslik === b)!;
    expect(madde('Konu').paragraflar[0]).toContain('Korkuteli / Antalya, 101 ada 5 parsel adresindeki "Güneş Apt." projesinde');
    expect(madde('Bedel').paragraflar).toEqual([
      'Satış bedeli KDV dahil ₺3.000.000,00, indirim ₺100.000,00, indirimli bedel ₺2.900.000,00.',
      'Bedelin içinde %1 KDV (₺28.712,87) vardır.',
      'Bedelin ₺900.000,00 kısmı aşağıdaki mallarla takas edilerek ödenmiştir; kalan ₺2.000.000,00 nakit olarak ödenir.',
    ]);
    expect(madde('Bedel').liste).toEqual(['2019 model araç: ₺900.000,00']);
    expect(madde('Ödeme planı').tablo!.satirlar.map((r) => r[0])).toEqual(['Peşinat', 'Taksit 1', 'Taksit 2']);
    expect(madde('Teslim').paragraflar[0]).toContain('30.06.2027');
    expect(madde('Diğer hükümler').liste).toEqual(['Tapu devri ve masrafları: Tapu harcı alıcıya aittir.']);
  });

  it('dövizli satış: kur protokolde sabitlenir, plan tablosunda döviz karşılığı; TL fiyat döviz × kur olmalı', () => {
    const doviz = { paraBirimi: 'USD' as const, tutar: TL(100_000), kur: 30 };
    const ic = icerik({ doviz, fiyat: TL(3_000_000) });
    expect(satisKayitHatalari(ic)).toEqual([]);
    expect(satisKayitHatalari({ ...ic, fiyat: TL(2_000_000) })).toContain('TL fiyat, dövizli fiyat × kur olmalı.');
    expect(satisKayitHatalari({ ...ic, doviz: { ...doviz, kur: 0 } })).toContain('Sözleşme kurunu yazın (1 birimin TL karşılığı).');
    const m = satisProtokolu(ic, {
      ...KUNYE,
      firma: { ad: 'Sürex İnşaat', bilgiler: { yetkili: '', telefon: '', eposta: '', web: '', adres: '', vergiDairesi: '', vergiNo: '' } },
      cari: { ad: 'Ayşe Kaya', telefon: null, vergiNo: null, adres: null },
      proje: { ad: 'Güneş Apt.', parseller: [] },
      projeAdresi: '',
    });
    const bedel = m.maddeler.find((x) => x.baslik === 'Bedel')!;
    expect(bedel.paragraflar[0]).toContain('$100.000,00 olup protokol tarihindeki 1 USD = 30,00 TL kuruyla ₺3.000.000,00 olarak sabitlenmiştir');
    const plan = m.maddeler.find((x) => x.baslik === 'Ödeme planı')!.tablo!;
    expect(plan.basliklar).toEqual(['Ödeme', 'Vade', 'USD karşılığı', 'Tutar']);
    expect(plan.satirlar[0]![2]).toBe('$33.333,33');
  });
});

describe('daireye özel ek işler', () => {
  it('bedele eklenir, KDV ve plan farkı ona göre; protokolde ayrı madde; boş ad/tutar hatası', () => {
    const ic = icerik({ ekIstekler: [{ id: 'e1', ad: 'Ankastre set', tutar: TL(60_000), maliyet: TL(45_000), maliyetSatiriId: 'm1' }] });
    const t = satisTutarlari(ic);
    expect(t).toMatchObject({ ekler: TL(60_000), net: TL(2_960_000), nakit: TL(2_060_000) });
    const m = satisProtokolu(ic, {
      ...KUNYE,
      firma: { ad: 'Sürex İnşaat', bilgiler: { yetkili: '', telefon: '', eposta: '', web: '', adres: '', vergiDairesi: '', vergiNo: '' } },
      cari: { ad: 'Ayşe Kaya', telefon: null, vergiNo: null, adres: null },
      proje: { ad: 'Güneş Apt.', parseller: [] },
      projeAdresi: '',
    });
    expect(m.maddeler.find((x) => x.baslik === 'Bedel')!.paragraflar[0]).toBe(
      'Satış bedeli KDV dahil ₺3.000.000,00, daireye özel ek işler (aşağıda) ₺60.000,00, indirim ₺100.000,00, toplam bedel ₺2.960.000,00.',
    );
    expect(m.maddeler.find((x) => x.baslik === 'Daireye özel ek işler')!.liste).toEqual(['Ankastre set: ₺60.000,00']);
    expect(satisKayitHatalari(icerik({ ekIstekler: [{ id: 'e', ad: ' ', tutar: 0, maliyet: null, maliyetSatiriId: null }] }))).toEqual(
      expect.arrayContaining(['Ek işin adını yazın (örn. ankastre set).', 'Ek işin tutarı sıfırdan büyük olmalı.']),
    );
  });
});

describe('plan önerisi', () => {
  it('kapora korunur, peşinat satış gününde, kalan eşit aylık taksit', () => {
    let n = 0;
    const plan = planOner(
      icerik({ plan: [p('k', 'kapora', '2026-10-20', 100_000)] }),
      { pesinat: TL(900_000), taksitSayisi: 3, ilkVade: '2027-01-31' },
      () => `y${++n}`,
    );
    expect(plan.map((x) => [x.tur, x.vadeTarihi, x.tutar / 100])).toEqual([
      ['kapora', '2026-10-20', 100_000],
      ['pesinat', '2026-11-01', 900_000],
      ['taksit', '2027-01-31', 333_333.33],
      ['taksit', '2027-02-28', 333_333.33],
      ['taksit', '2027-03-31', 333_333.34],
    ]);
    expect(planOner(icerik({ plan: [] }), { pesinat: 0, taksitSayisi: 0, ilkVade: '2027-01-01' }, () => 'x').map((x) => x.tutar)).toEqual([TL(2_000_000)]);
  });
});
