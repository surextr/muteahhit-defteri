import { describe, expect, it } from 'vitest';
import type { Hakedis, UstaSozlesmesi } from '../veri/tipler';
import { asamaSatiri, ilaveSatiri, metrajSatiri } from './hakedis';
import { hakedisBelgesi, oncekiOnaylilar } from './hakedisBelgesi';

const TL = (n: number) => Math.round(n * 100);

const sozlesme = {
  sozlesmeTarihi: '2026-11-01',
  baslamaTarihi: null,
  bitisTarihi: null,
  ustaTipiAdi: 'Sıvacı + Kalıpçı',
  bolumler: [
    { ustaTipiId: 's', ustaTipiAdi: 'Sıvacı', sablonSurumu: 1, hakedisSekli: 'kat', takipYontemi: 'metraj', asamalar: [] },
    { ustaTipiId: 'k', ustaTipiAdi: 'Kalıpçı (demir işçiliği dahil)', sablonSurumu: 1, hakedisSekli: 'beton_dokumu', takipYontemi: 'asama', asamalar: [{ id: 'a1', ad: 'Temel', tutar: TL(85_000) }] },
  ],
  kalemler: [{ id: 'ic', ustaTipiId: 's', ad: 'İç sıva', birim: 'm²', aciklama: '', miktar: 1000, birimFiyat: TL(180), butceKalemiKodu: null }],
  sorumluluklar: [],
  ortakMaddeler: [],
  ozelSartlar: '',
  odemeKosulu: '',
  teminatOrani: 5,
  sgkTaahhudu: null,
  fiyatlamaBirimi: 'm²',
  not: '',
} as unknown as UstaSozlesmesi;

const kaynak = {
  sozlesme,
  firma: { ad: 'Sürex İnşaat', bilgiler: { yetkili: 'Süleyman Özdemir', telefon: '', eposta: '', web: '', adres: '', vergiDairesi: '', vergiNo: '' } },
  cari: { ad: 'Yıldız İnşaat', telefon: null, vergiNo: null, adres: null, roller: ['taseron' as const], yetkili: 'Mehmet Yıldız' },
  proje: { ad: 'Güneş Apt.', parseller: [] },
  projeAdresi: '',
};

const ic = sozlesme.kalemler[0]!;
const hakedis = {
  no: 2,
  tarih: '2026-12-30',
  donemAsama: 'Aralık',
  satirlar: [metrajSatiri(ic, 300), asamaSatiri('k', sozlesme.bolumler[1]!.asamalar[0]!, null), ilaveSatiri('s', { aciklama: 'Balkon tavanı', miktar: 40, birim: 'm²', birimFiyat: TL(200), tutar: 0, butceKalemiKodu: null })],
  kesintiler: [{ aciklama: 'Gecikme cezası', tutar: TL(5_000) }],
  kdvOrani: 0,
  tevkifat: null,
  teminatOrani: 5,
  avansMahsubu: TL(20_000),
  brutTutar: TL(147_000),
  kesintiToplam: TL(5_000),
  kdvTutari: 0,
  tevkifatTutari: 0,
  borcTutari: TL(142_000),
  teminatTutari: TL(7_100),
  netTutar: TL(114_900),
  not: '',
};

describe('hakediş belgesi', () => {
  it('önceki yalnız numarası küçük onaylı hakedişler', () => {
    const h = (no: number, onayli: boolean, iptal = false) => ({ no, onay: onayli ? { zaman: 'z', kullaniciId: 'u' } : null, iptal: iptal ? { zaman: 'z', kullaniciId: 'u', gerekce: 'x' } : null });
    expect(oncekiOnaylilar([h(1, true), h(2, true), h(3, true), h(1, false), h(1, true, true)] as Pick<Hakedis, 'no' | 'onay' | 'iptal'>[], 2).map((x) => x.no)).toEqual([1]);
  });

  it('kalem tablosu işlere göre; metrajda önceki/bu/toplam; hesap özeti ve toplam durum', () => {
    const onceki = { satirlar: [metrajSatiri(ic, 400)], brutTutar: TL(72_000), kesintiToplam: 0, teminatTutari: TL(3_600) };
    const m = hakedisBelgesi(hakedis, { ...kaynak, oncekiler: [onceki] });
    expect(m.baslik).toBe('HAKEDİŞ BELGESİ');
    expect(m.altBaslik).toBe('Hakediş 2 · Aralık · Sıvacı, Kalıpçı');
    expect(m.taraflar[1]!.ad).toBe('Yıldız İnşaat');
    const t = m.maddeler.find((x) => x.baslik === 'Yapılan işler')!.tablo!;
    expect(t.satirTurleri).toEqual(['grup', 'kalem', 'kalem', 'ara', 'grup', 'kalem', 'ara']);
    expect(t.satirlar[1]).toEqual(['İç sıva', 'm²', '400', '300', '700', '₺180,00', '₺54.000,00']);
    expect(t.satirlar[2]![0]).toBe('İlave iş: Balkon tavanı');
    expect(t.satirlar[5]![0]).toBe('Temel (aşama)');
    const h = m.maddeler.find((x) => x.baslik === 'Hesap')!.tablo!;
    expect(h.satirlar.map((x) => x[0])).toEqual([
      'Hakediş tutarı',
      'Kesinti: Gecikme cezası',
      'Yükleniciye borç',
      'Teminat kesintisi %5 (iş teslim edilip kabul edilince ödenir)',
      'Daha önce verilen avanstan mahsup',
    ]);
    expect(h.alt).toEqual(['Bu hakedişte ödenecek', '₺114.900,00']);
    const d = m.maddeler.find((x) => x.baslik === 'Toplam durum')!.paragraflar;
    expect(d[0]).toBe('Önceki hakedişler: ₺72.000,00 · Bu hakediş: ₺142.000,00 · Toplam: ₺214.000,00.');
    expect(d[1]).toBe("Sözleşmenin tahmini tutarı ₺265.000,00; yapılan iş bunun %81'idir.");
    expect(d[2]).toBe('Bu hakedişle birlikte tutulan toplam teminat: ₺10.700,00.');
    expect(m.imzaTarihi).toBe('30.12.2026');
  });
});
