import { describe, expect, it } from 'vitest';
import type {
  AcilisBakiyesi,
  CekHareketi,
  CekSenet,
  Eslestirme,
  Gider,
  Hakedis,
  Hesap,
  Odeme,
  Transfer,
} from '../veri/tipler';
import { cariBakiye, cariEkstresi, giderKalanBorc, hesapBakiye, hesapEkstresi, odemeAcikTutar, type CariHareketleri } from './bakiye';

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
const IPTAL = { zaman: Z, kullaniciId: 'u', gerekce: 'yanlış giriş' };
const TL = (n: number) => n * 100;

const gider = (id: string, cariId: string | null, toplam: number, ek: Partial<Gider> = {}): Gider => ({
  ...ortak(id),
  tarih: '2026-10-01',
  projeId: 'p',
  cariId,
  faturaNo: null,
  vadeTarihi: null,
  aciklama: '',
  kdvHaricToplam: toplam,
  kdvToplam: 0,
  toplam,
  tevkifatToplam: 0,
  paraBirimi: 'TRY',
  kur: null,
  ...ek,
});

const odeme = (id: string, yon: Odeme['yon'], tutar: number, ek: Partial<Odeme> = {}): Odeme => ({
  ...ortak(id),
  tarih: '2026-10-01',
  yon,
  amac: 'cari',
  yontem: 'nakit',
  cariId: 'tedarikci',
  hesapId: 'kasa',
  cekSenetId: null,
  projeId: 'p',
  tutar,
  doviz: null,
  aciklama: '',
  ...ek,
});

const esl = (id: string, odemeId: string, hedefId: string, tutar: number, ek: Partial<Eslestirme> = {}): Eslestirme => ({
  ...ortak(id),
  odemeId,
  hedefTur: 'gider',
  hedefId,
  tutar,
  ...ek,
});

const acilis = (id: string, hedefTur: AcilisBakiyesi['hedefTur'], hedefId: string, tutar: number): AcilisBakiyesi => ({
  ...ortak(id),
  hedefTur,
  hedefId,
  tarih: '2026-01-01',
  tutar,
});

const cek = (id: string, yon: CekSenet['yon'], cariId: string, tutar: number, ek: Partial<CekSenet> = {}): CekSenet => ({
  ...ortak(id),
  tur: 'cek',
  yon,
  cariId,
  vadeTarihi: '2026-12-01',
  tutar,
  doviz: null,
  banka: null,
  seriNo: null,
  durum: yon === 'alinan' ? 'portfoyde' : 'verildi',
  ...ek,
});

const cekHareketi = (id: string, cekSenetId: string, durum: CekHareketi['durum'], ek: Partial<CekHareketi> = {}): CekHareketi => ({
  ...ortak(id),
  cekSenetId,
  tarih: '2026-12-01',
  durum,
  cariId: null,
  hesapId: null,
  aciklama: '',
  ...ek,
});

const bos = (): CariHareketleri => ({
  acilislar: [],
  giderler: [],
  hakedisler: [],
  odemeler: [],
  cekler: [],
  cekHareketleri: [],
});

describe('gider ve ödeme ayrı kayıt (plan örneği)', () => {
  const alis = gider('g1', 'tedarikci', TL(100_000));
  const o1 = odeme('o1', 'odeme', TL(30_000));
  const o2 = odeme('o2', 'odeme', TL(70_000));

  it('100.000 alış, 30.000 ödeme → kalan borç 70.000', () => {
    const e = [esl('e1', 'o1', 'g1', TL(30_000))];
    expect(giderKalanBorc(alis, e)).toBe(TL(70_000));
    expect(cariBakiye('tedarikci', { ...bos(), giderler: [alis], odemeler: [o1] })).toBe(TL(70_000));
  });

  it('sonraki 70.000 ödeme borcu kapatır, yeni maliyet oluşturmaz', () => {
    const e = [esl('e1', 'o1', 'g1', TL(30_000)), esl('e2', 'o2', 'g1', TL(70_000))];
    const giderler = [alis];
    expect(giderKalanBorc(alis, e)).toBe(0);
    expect(cariBakiye('tedarikci', { ...bos(), giderler, odemeler: [o1, o2] })).toBe(0);
    // Maliyet yalnızca giderden gelir: toplam maliyet hâlâ 100.000.
    expect(giderler.reduce((t, g) => t + g.toplam, 0)).toBe(TL(100_000));
  });

  it('iptal edilen eşleştirme ve ödeme hesaba girmez', () => {
    const e = [esl('e1', 'o1', 'g1', TL(30_000), { iptal: IPTAL })];
    expect(giderKalanBorc(alis, e)).toBe(TL(100_000));
    const iptalOdeme = { ...o1, iptal: IPTAL };
    expect(cariBakiye('tedarikci', { ...bos(), giderler: [alis], odemeler: [iptalOdeme] })).toBe(TL(100_000));
  });

  it('iptal edilen giderin kalan borcu yoktur', () => {
    expect(giderKalanBorc({ ...alis, iptal: IPTAL }, [])).toBe(0);
  });

  it('eşleşmemiş ödeme kısmı avans olarak açık kalır', () => {
    const avansli = odeme('o3', 'odeme', TL(50_000));
    expect(odemeAcikTutar(avansli, [esl('e3', 'o3', 'g1', TL(20_000))])).toBe(TL(30_000));
  });
});

describe('cari bakiyesi', () => {
  it('açılış bakiyesi ayrı kayıttır; müşteri tahsilatı alacağı azaltır', () => {
    const h = {
      ...bos(),
      acilislar: [acilis('a1', 'cari', 'musteri', -TL(50_000))],
      odemeler: [odeme('t1', 'tahsilat', TL(20_000), { cariId: 'musteri' })],
    };
    expect(cariBakiye('musteri', h)).toBe(-TL(30_000));
  });

  it('başka carinin ve hesabın açılışı karışmaz', () => {
    const h = { ...bos(), acilislar: [acilis('a1', 'hesap', 'musteri', TL(1)), acilis('a2', 'cari', 'baska', TL(5))] };
    expect(cariBakiye('musteri', h)).toBe(0);
  });

  it('yalnızca onaylı hakediş borç doğurur', () => {
    const hakedis = (id: string, onayli: boolean): Hakedis => ({
      ...ortak(id),
      onay: onayli ? { zaman: Z, kullaniciId: 'u' } : null,
      sozlesmeId: 's',
      projeId: 'p',
      cariId: 'usta',
      tarih: '2026-10-01',
      donemAsama: '1. kat',
      miktar: null,
      brutTutar: TL(120_000),
      avansMahsubu: TL(10_000),
      kesintiler: TL(10_000),
      netTutar: TL(100_000),
      sgkPrimiDahil: false,
    });
    const h = { ...bos(), hakedisler: [hakedis('h1', true), hakedis('h2', false)] };
    expect(cariBakiye('usta', h)).toBe(TL(100_000));
  });

  it('ortağın yatırdığı para ortağa borç olarak görünür', () => {
    const h = { ...bos(), odemeler: [odeme('t1', 'tahsilat', TL(500_000), { cariId: 'ortak', amac: 'ortakSermaye' })] };
    expect(cariBakiye('ortak', h)).toBe(TL(500_000));
  });
});

describe('çek/senet', () => {
  it('müşteriden alınan çek karşılıksız çıkarsa alacak geri gelir', () => {
    const c = cek('c1', 'alinan', 'musteri', TL(10_000));
    const h = {
      ...bos(),
      acilislar: [acilis('a1', 'cari', 'musteri', -TL(10_000))],
      odemeler: [odeme('t1', 'tahsilat', TL(10_000), { cariId: 'musteri', yontem: 'cek', hesapId: null, cekSenetId: 'c1' })],
      cekler: [c],
    };
    expect(cariBakiye('musteri', h)).toBe(0);
    h.cekHareketleri = [cekHareketi('x1', 'c1', 'karsiliksiz')];
    expect(cariBakiye('musteri', h)).toBe(-TL(10_000));
  });

  it('ciro edilen çek karşılıksız çıkarsa tedarikçiye borcumuz geri gelir; iade de olsa bir kez sayılır', () => {
    const c = cek('c1', 'alinan', 'musteri', TL(10_000));
    const h = {
      ...bos(),
      giderler: [gider('g1', 'tedarikci', TL(10_000))],
      odemeler: [odeme('o1', 'odeme', TL(10_000), { yontem: 'ciro', hesapId: null, cekSenetId: 'c1' })],
      cekler: [c],
      cekHareketleri: [cekHareketi('x1', 'c1', 'ciro_edildi', { cariId: 'tedarikci' })],
    };
    expect(cariBakiye('tedarikci', h)).toBe(0);
    h.cekHareketleri.push(cekHareketi('x2', 'c1', 'karsiliksiz'), cekHareketi('x3', 'c1', 'iade_edildi'));
    expect(cariBakiye('tedarikci', h)).toBe(TL(10_000));
  });

  it('verdiğimiz çek karşılıksız çıkarsa borcumuz geri gelir', () => {
    const h = {
      ...bos(),
      giderler: [gider('g1', 'tedarikci', TL(10_000))],
      odemeler: [odeme('o1', 'odeme', TL(10_000), { yontem: 'cek', hesapId: null, cekSenetId: 'c1' })],
      cekler: [cek('c1', 'verilen', 'tedarikci', TL(10_000))],
      cekHareketleri: [cekHareketi('x1', 'c1', 'karsiliksiz')],
    };
    expect(cariBakiye('tedarikci', h)).toBe(TL(10_000));
  });
});

describe('kasa/banka bakiyesi', () => {
  const hesap = (id: string, paraBirimi: Hesap['paraBirimi'] = 'TRY'): Hesap => ({
    ...ortak(id),
    ad: id,
    tur: 'banka',
    paraBirimi,
    banka: null,
    iban: null,
  });
  const transfer = (id: string, kaynak: string, hedef: string, tutar: number, hedefTutar: number | null = null): Transfer => ({
    ...ortak(id),
    tarih: '2026-10-01',
    kaynakHesapId: kaynak,
    hedefHesapId: hedef,
    tutar,
    hedefTutar,
    aciklama: '',
  });

  it('açılış, ödeme/tahsilat, transfer ve çek hareketlerinden hesaplanır', () => {
    const h = {
      acilislar: [acilis('a1', 'hesap', 'banka', TL(1_000))],
      odemeler: [
        odeme('t1', 'tahsilat', TL(500), { hesapId: 'banka' }),
        odeme('o1', 'odeme', TL(200), { hesapId: 'banka' }),
        odeme('o2', 'odeme', TL(999), { hesapId: 'banka', iptal: IPTAL }),
        odeme('o3', 'odeme', TL(999), { hesapId: null, cekSenetId: 'c2', yontem: 'cek' }),
      ],
      transferler: [transfer('tr1', 'banka', 'kasa', TL(100)), transfer('tr2', 'kasa', 'banka', TL(40))],
      cekler: [cek('c1', 'alinan', 'musteri', TL(300)), cek('c2', 'verilen', 'tedarikci', TL(50))],
      cekHareketleri: [
        cekHareketi('x1', 'c1', 'tahsil_edildi', { hesapId: 'banka' }),
        cekHareketi('x2', 'c2', 'odendi', { hesapId: 'banka' }),
      ],
    };
    // 1000 + 500 − 200 − 100 + 40 + 300 − 50
    expect(hesapBakiye(hesap('banka'), h)).toBe(TL(1_490));
  });

  it('kasa-banka transferi toplam parayı değiştirmez', () => {
    const h = {
      acilislar: [acilis('a1', 'hesap', 'banka', TL(1_000))],
      odemeler: [],
      transferler: [transfer('tr1', 'banka', 'kasa', TL(400))],
      cekler: [],
      cekHareketleri: [],
    };
    expect(hesapBakiye(hesap('banka'), h) + hesapBakiye(hesap('kasa'), h)).toBe(TL(1_000));
  });

  it('dövizli hesap kendi para biriminde hesaplanır', () => {
    const h = {
      acilislar: [],
      odemeler: [
        odeme('t1', 'tahsilat', TL(41_000), {
          hesapId: 'usd',
          doviz: { paraBirimi: 'USD', tutar: 1_000_00, kur: 41 },
        }),
      ],
      transferler: [transfer('tr1', 'usd', 'banka', 200_00, TL(8_200))],
      cekler: [],
      cekHareketleri: [],
    };
    expect(hesapBakiye(hesap('usd', 'USD'), h)).toBe(800_00);
    expect(hesapBakiye(hesap('banka'), h)).toBe(TL(8_200));
  });

  it('ekstre tarih sırasıyla yürüyen bakiye verir; son satır bakiyeye eşittir', () => {
    const h = {
      acilislar: [{ ...acilis('a1', 'hesap', 'banka', TL(1_000)), tarih: '2026-09-01' }],
      odemeler: [{ ...odeme('o1', 'odeme', TL(200), { hesapId: 'banka' }), tarih: '2026-10-05' }],
      transferler: [{ ...transfer('tr1', 'kasa', 'banka', TL(50)), tarih: '2026-09-15' }],
      cekler: [],
      cekHareketleri: [],
    };
    const ekstre = hesapEkstresi(hesap('banka'), h);
    expect(ekstre.map((x) => [x.tur, x.tutar, x.bakiye, x.karsiHesapId])).toEqual([
      ['acilis', TL(1_000), TL(1_000), null],
      ['transferGiris', TL(50), TL(1_050), 'kasa'],
      ['odeme', -TL(200), TL(850), null],
    ]);
    expect(hesapBakiye(hesap('banka'), h)).toBe(TL(850));
  });
});

describe('tevkifatlı fatura', () => {
  it('kalan borç ve cari bakiyesi tevkifat düşülmüş tutardan', () => {
    const g = gider('g1', 'tedarikci', TL(120_000), { tevkifatToplam: TL(8_000) });
    expect(giderKalanBorc(g, [])).toBe(TL(112_000));
    expect(cariBakiye('tedarikci', { acilislar: [], giderler: [g], hakedisler: [], odemeler: [], cekler: [], cekHareketleri: [] })).toBe(
      TL(112_000),
    );
  });
});

describe('cari ekstresi', () => {
  it('tarih sırasıyla yürüyen bakiye; son satır cari bakiyesine eşit', () => {
    const h: CariHareketleri = {
      acilislar: [{ ...acilis('a1', 'cari', 'tedarikci', TL(5_000)), tarih: '2026-09-01' }],
      giderler: [gider('g1', 'tedarikci', TL(10_000), { tarih: '2026-10-01', faturaNo: 'F1' })],
      hakedisler: [],
      odemeler: [{ ...odeme('o1', 'odeme', TL(12_000), { cariId: 'tedarikci' }), tarih: '2026-10-05' }],
      cekler: [],
      cekHareketleri: [],
    };
    const e = cariEkstresi('tedarikci', h);
    expect(e.map((x) => [x.tur, x.tutar, x.bakiye, x.aciklama])).toEqual([
      ['acilis', TL(5_000), TL(5_000), 'Açılış bakiyesi'],
      ['gider', TL(10_000), TL(15_000), 'Fatura F1'],
      ['odeme', -TL(12_000), TL(3_000), ''],
    ]);
    expect(cariBakiye('tedarikci', h)).toBe(TL(3_000));
  });
});
