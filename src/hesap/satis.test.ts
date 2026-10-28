import { describe, expect, it } from 'vitest';
import type { SatisPlanSatiri } from '../veri/tipler';
import { bolumTanimi, satisEksikleri, satisKayitHatalari, satisOzeti, satisPlanDurumu, satisProtokolu, satisTutarlari, type SatisIcerigi } from './satis';

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
  plan: [p('a', 'pesinat', '2026-11-01', 1_000_000), p('b', 'taksit', '2026-12-01', 500_000), p('c', 'taksit', '2027-01-01', 500_000)],
  teslimTarihi: '2027-06-30',
  tapuTarihi: null,
  maddeler: [{ id: 'tapu', baslik: 'Tapu devri ve masrafları', metin: 'Tapu harcı alıcıya aittir.' }],
  not: '',
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
    expect(satisEksikleri(icerik({ plan: [p('a', 'pesinat', '2026-11-01', 1_500_000)], teslimTarihi: null, maddeler: [{ id: 'x', baslik: 'Cayma', metin: ' ' }] }))).toEqual([
      'Teslim tarihi yazılmadı.',
      'Ödeme planının toplamı tahsil edilecek tutardan ₺500.000,00 eksik.',
      'Hüküm yazılmadı: Cayma',
    ]);
    expect(satisKayitHatalari(icerik({ takas: [{ aciklama: 'Arsa', deger: TL(5_000_000) }] }))).toContain('Takas değeri satış bedelinden büyük olamaz.');
    expect(satisKayitHatalari(icerik({ kdvOrani: 8 }))).toEqual(['KDV oranını seçin.']);
  });
});

describe('plan durumu', () => {
  it('imzasızda bekliyor; alacak kalanına göre tahsil/kısmen/gecikti/yaklaşan', () => {
    const plan = [p('a', 'pesinat', '2026-11-01', 100, 'A'), p('b', 'taksit', '2026-12-01', 100, 'B'), p('c', 'taksit', '2026-12-20', 100, 'C'), p('d', 'taksit', '2027-06-01', 100, 'D')];
    const d = satisPlanDurumu(plan, new Map([['A', 0], ['B', TL(40)], ['C', TL(100)], ['D', TL(100)]]), '2026-12-05');
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
});
