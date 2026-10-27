import { describe, expect, it } from 'vitest';
import { bolumCikar, bolumEkle, bosIcerik, eksikBilgiler, sozlesmeTahminiTutari, isAdlariMetni, kalemTutari, sozlesmeMetni, sozlesmeToplami, sozlesmeUyarilari, type BolumSablonu, type MetinKaynaklari, type SozlesmeIcerigi } from './ustaSozlesmesi';

const TL = (n: number) => Math.round(n * 100);

const icerik = (d: Partial<SozlesmeIcerigi> = {}): SozlesmeIcerigi & { ustaTipiAdi: string } => ({
  ustaTipiAdi: 'Duvarcı',
  sozlesmeTarihi: '2026-11-01',
  baslamaTarihi: '2026-11-05',
  bitisTarihi: '2027-01-31',
  bolumler: [{ ustaTipiId: 'd', ustaTipiAdi: 'Duvarcı', sablonSurumu: 1, hakedisSekli: 'kat', takipYontemi: 'metraj', asamalar: [] }],
  fiyatlamaBirimi: 'm²',
  kalemler: [{ id: 'k1', ustaTipiId: 'd', ad: 'Duvar örme', birim: 'm²', aciklama: '', miktar: 1200.5, birimFiyat: TL(85), butceKalemiKodu: 'duvar' }],
  sorumluluklar: [{ ustaTipiId: 'd', soru: 'Malzeme taşıma kimde?', cevap: 'usta', aciklama: '' }],
  ortakMaddeler: [{ id: 'olcum', baslik: 'Ölçüm yöntemi ve metrajı kimin onaylayacağı', cevap: 'Şantiye şefi ölçer.' }],
  ozelSartlar: '1. Duvar şakülünde örülür.\n\n2) Moloz her gün toplanır.',
  odemeKosulu: 'Hakediş onayından sonra 7 gün içinde.',
  teminatOrani: 0,
  sgkTaahhudu: null,
  not: '',
  ...d,
});

const kaynak: MetinKaynaklari = {
  firma: { ad: 'Sürex İnşaat', bilgiler: { yetkili: 'Süleyman Özdemir', telefon: '', eposta: '', web: '', adres: 'Korkuteli', vergiDairesi: 'Korkuteli', vergiNo: '123' } },
  cari: { ad: 'Usta Ali', telefon: '0 532 111 22 33', vergiNo: null, adres: null, roller: ['usta'], yetkili: null },
  proje: { ad: 'Güneş Apt.', parseller: [{ ada: '101', parsel: '5', alanM2: null }] },
  projeAdresi: 'Korkuteli / Antalya',
};

describe('usta sözleşmesi tutarı', () => {
  it('miktar × birim fiyat kuruşa yuvarlanır; miktarı boş kalem toplama girmez', () => {
    expect(kalemTutari({ miktar: 1200.5, birimFiyat: TL(85) })).toBe(TL(102042.5));
    expect(kalemTutari({ miktar: null, birimFiyat: TL(85) })).toBeNull();
    expect(
      sozlesmeToplami([
        { miktar: 10, birimFiyat: TL(100) },
        { miktar: null, birimFiyat: TL(50) },
      ]),
    ).toEqual({ toplam: TL(1000), eksikMiktar: true });
    expect(sozlesmeToplami([])).toEqual({ toplam: 0, eksikMiktar: false });
  });
});

describe('eksik bilgiler', () => {
  it('tam doldurulmuş sözleşmede eksik yok', () => {
    expect(eksikBilgiler(icerik())).toEqual([]);
  });

  it('tarih, fiyat, cevapsız sorumluluk, boş hüküm ve "sözleşmede yazılacak" boş açıklama sorulur', () => {
    const e = eksikBilgiler(
      icerik({
        sozlesmeTarihi: null,
        kalemler: [
          { id: 'k2', ustaTipiId: 'd', ad: 'Duvar örme', birim: 'm²', aciklama: '', miktar: null, birimFiyat: 0, butceKalemiKodu: null },
          { id: 'k3', ustaTipiId: 'd', ad: ' ', birim: 'm²', aciklama: '', miktar: null, birimFiyat: TL(1), butceKalemiKodu: null },
        ],
        sorumluluklar: [
          { ustaTipiId: 'd', soru: 'İskele kimde?', cevap: null, aciklama: '' },
          { ustaTipiId: 'd', soru: 'Malzeme kimde?', cevap: 'sozlesmede', aciklama: ' ' },
        ],
        ortakMaddeler: [{ id: 'ayip', baslik: 'Ayıplı işin düzeltme sorumluluğu', cevap: '' }],
      }),
    );
    expect(e).toEqual([
      'Sözleşme tarihi seçilmedi.',
      '"Duvar örme" kaleminin birim fiyatı yazılmadı.',
      'Adı yazılmamış kalem var.',
      'Cevaplanmadı: İskele kimde?',
      'Sözleşmeye yazılacak hüküm boş: Malzeme kimde?',
      'Hüküm yazılmadı: Ayıplı işin düzeltme sorumluluğu',
    ]);
    expect(eksikBilgiler(icerik({ kalemler: [] }))).toEqual(['En az bir kalem ekleyin.']);
  });

  it('başlama/bitiş tarihi ve miktar zorunlu değil, uyarı olarak gösterilir', () => {
    const s = icerik({ baslamaTarihi: null, bitisTarihi: null, kalemler: [{ id: 'k4', ustaTipiId: 'd', ad: 'Duvar', birim: 'm²', aciklama: '', miktar: null, birimFiyat: TL(85), butceKalemiKodu: null }] });
    expect(eksikBilgiler(s)).toEqual([]);
    expect(sozlesmeUyarilari(s)).toHaveLength(3);
    expect(sozlesmeUyarilari(icerik())).toEqual([]);
  });
});

describe('sözleşme metni', () => {
  it('taraflar, konu, kalem tablosu, sorumluluk, hüküm ve özel şartlar', () => {
    const m = sozlesmeMetni(icerik(), kaynak);
    expect(m.altBaslik).toBe('Duvarcı');
    expect(m.taraflar[0]).toMatchObject({ rol: 'İşveren', ad: 'Sürex İnşaat', satirlar: ['Yetkili: Süleyman Özdemir', 'Korkuteli', 'Vergi: Korkuteli / 123'] });
    expect(m.taraflar[1]).toMatchObject({ rol: 'Yüklenici', ad: 'Usta Ali', satirlar: ['Sıfatı: Duvarcı', 'Tel: 0 532 111 22 33'] });
    expect(m.imzalar[1]).toEqual({ rol: 'Yüklenici', ad: 'Usta Ali' });
    const konu = m.maddeler[0]!.paragraflar[0]!;
    expect(konu).toContain('"Güneş Apt." projesinde (Korkuteli / Antalya, 101 ada 5 parsel) Duvarcı işlerinin');
    const tablo = m.maddeler[1]!.tablo!;
    expect(tablo.satirlar[0]).toEqual(['Duvar örme', 'm²', '1.200,5', '₺85,00', '₺102.042,50']);
    expect(tablo.alt).toEqual(['Tahmini toplam', '', '', '', '₺102.042,50']);
    const madde = (b: string) => m.maddeler.find((x) => x.baslik === b);
    expect(madde('Malzeme ve sorumluluklar')!.liste).toEqual(["Malzeme taşıma kimde: Yüklenici'ye aittir."]);
    expect(madde('Genel hükümler')!.liste).toEqual(['Ölçüm yöntemi ve metrajı kimin onaylayacağı: Şantiye şefi ölçer.']);
    // Kullanıcının yazdığı numaralar atılır; metin kendi numarasını verir.
    expect(madde('Özel şartlar')!.liste).toEqual(['Duvar şakülünde örülür.', 'Moloz her gün toplanır.']);
    expect(madde('Hakediş ve ödeme')!.paragraflar).toEqual(['Hakediş şekli: Kat bazında.', 'Ödeme: Hakediş onayından sonra 7 gün içinde.']);
    expect(madde('Sosyal güvenlik')).toBeUndefined();
    expect(m.imzaTarihi).toBe('01.11.2026');
  });

  it('taşeron firma: sıfatta taşeron ve sözleşmenin branşı (parantezsiz), yetkili hem tarafta hem imzada', () => {
    const m = sozlesmeMetni(
      icerik({ bolumler: [{ ustaTipiId: 'd', ustaTipiAdi: 'Kalıpçı (demir işçiliği dahil)', sablonSurumu: 1, hakedisSekli: 'beton_dokumu', takipYontemi: 'metraj', asamalar: [] }] }),
      { ...kaynak, cari: { ...kaynak.cari, ad: 'Yıldız İnşaat Ltd. Şti.', roller: ['taseron'], yetkili: 'Mehmet Yıldız' } },
    );
    expect(m.taraflar[1]!.satirlar).toEqual(['Sıfatı: Taşeron (Kalıpçı)', 'Yetkili: Mehmet Yıldız', 'Tel: 0 532 111 22 33']);
    expect(m.imzalar[1]).toEqual({ rol: 'Yüklenici', ad: 'Yıldız İnşaat Ltd. Şti. · Mehmet Yıldız' });
  });

  it('boş bilgi uydurulmaz, "…" kalır', () => {
    const m = sozlesmeMetni(
      icerik({
        sozlesmeTarihi: null,
        baslamaTarihi: null,
        kalemler: [{ id: 'k5', ustaTipiId: 'd', ad: 'Duvar', birim: 'm²', aciklama: '', miktar: null, birimFiyat: 0, butceKalemiKodu: null }],
        sorumluluklar: [{ ustaTipiId: 'd', soru: 'İskele kimde?', cevap: null, aciklama: '' }],
      }),
      kaynak,
    );
    expect(m.imzaTarihi).toBe('…/…/……');
    expect(m.maddeler.find((x) => x.baslik === 'Süre')!.paragraflar[0]).toBe('İşe başlama tarihi: …/…/…….');
    expect(m.maddeler[1]!.tablo!.satirlar[0]).toEqual(['Duvar', 'm²', '—', '…', '—']);
    expect(m.maddeler[1]!.tablo!.alt![0]).toBe('Miktarı yazılı kalemlerin toplamı');
    expect(m.maddeler.find((x) => x.baslik === 'Malzeme ve sorumluluklar')!.liste).toEqual(['İskele kimde: …']);
  });
});

const tip = (id: string, ad: string, d: Partial<BolumSablonu> = {}): BolumSablonu => ({
  id,
  ad,
  sablonSurumu: 2,
  hakedisSekli: 'yuzde',
  takipYontemi: 'metraj',
  fiyatlamaBirimi: 'm²',
  butceKalemiKodu: 'genel',
  kalemler: [{ ad: `${ad} işçiliği`, birim: 'm²', aciklama: '', butceKalemiKodu: null }],
  sorular: [{ soru: 'Malzeme kimde?', varsayilan: null }],
  ozelSartlar: ['Moloz her gün toplanır.'],
  kapaliOrtakMaddeler: [],
  ...d,
});
const MADDELER = [
  { id: 'olcum', metin: 'Ölçüm' },
  { id: 'iskele', metin: 'İskele' },
];

describe('toplu sözleşme bölümleri', () => {
  it('her iş kendi kalem ve sorularıyla eklenir; özel şart tekrarlanmaz; ortak madde bütün işlerde kapalıysa gelmez', () => {
    let ic = bolumEkle(bosIcerik(), tip('s', 'Sıvacı', { kapaliOrtakMaddeler: ['iskele'] }), MADDELER);
    expect(ic.ortakMaddeler.map((m) => m.id)).toEqual(['olcum']);
    ic = { ...ic, ortakMaddeler: [{ id: 'olcum', baslik: 'Ölçüm', cevap: 'Şef ölçer.' }] };
    ic = bolumEkle(ic, tip('b', 'Boyacı', { hakedisSekli: 'is_bitimi', ozelSartlar: ['Moloz her gün toplanır.', 'İki kat boya.'] }), MADDELER);
    expect(ic.bolumler.map((b) => [b.ustaTipiId, b.hakedisSekli, b.sablonSurumu])).toEqual([
      ['s', 'yuzde', 2],
      ['b', 'is_bitimi', 2],
    ]);
    expect(ic.kalemler.map((k) => [k.ustaTipiId, k.ad, k.butceKalemiKodu])).toEqual([
      ['s', 'Sıvacı işçiliği', 'genel'],
      ['b', 'Boyacı işçiliği', 'genel'],
    ]);
    expect(ic.sorumluluklar.map((r) => r.ustaTipiId)).toEqual(['s', 'b']);
    expect(ic.ozelSartlar).toBe('Moloz her gün toplanır.\nİki kat boya.');
    // Yazılmış cevap korunur, boyada açık olan iskele maddesi eklenir.
    expect(ic.ortakMaddeler).toEqual([
      { id: 'olcum', baslik: 'Ölçüm', cevap: 'Şef ölçer.' },
      { id: 'iskele', baslik: 'İskele', cevap: '' },
    ]);
    expect(bolumEkle(ic, tip('s', 'Sıvacı'), MADDELER)).toBe(ic);
    expect(isAdlariMetni([{ ustaTipiAdi: 'Sıvacı' }, { ustaTipiAdi: 'Boyacı' }, { ustaTipiAdi: 'Kalıpçı (demir dahil)' }])).toBe('Sıvacı, Boyacı ve Kalıpçı');
  });

  it('iş çıkarılınca kalem ve soruları gider; son iş çıkarılmaz', () => {
    const ic = [tip('s', 'Sıvacı'), tip('b', 'Boyacı')].reduce((x, t) => bolumEkle(x, t, MADDELER), bosIcerik());
    const tek = bolumCikar(ic, 's');
    expect(tek.bolumler.map((b) => b.ustaTipiId)).toEqual(['b']);
    expect(tek.kalemler.every((k) => k.ustaTipiId === 'b')).toBe(true);
    expect(tek.sorumluluklar).toHaveLength(1);
    expect(bolumCikar(tek, 'b')).toBe(tek);
  });

  it('kalemsiz iş eksik bilgidir', () => {
    const ic = icerik({
      bolumler: [
        { ustaTipiId: 'd', ustaTipiAdi: 'Duvarcı', sablonSurumu: 1, hakedisSekli: 'kat', takipYontemi: 'metraj', asamalar: [] },
        { ustaTipiId: 's', ustaTipiAdi: 'Sıvacı', sablonSurumu: 1, hakedisSekli: 'kat', takipYontemi: 'metraj', asamalar: [] },
      ],
    });
    expect(eksikBilgiler(ic)).toEqual(['Sıvacı işi için kalem yok.']);
  });

  it('metin: konu iş adlarıyla, tablo işlere göre gruplu ve ara toplamlı, sorumluluk iş adıyla, hakediş iş başına', () => {
    const m = sozlesmeMetni(
      icerik({
        bolumler: [
          { ustaTipiId: 's', ustaTipiAdi: 'Sıvacı', sablonSurumu: 1, hakedisSekli: 'yuzde', takipYontemi: 'metraj', asamalar: [] },
          { ustaTipiId: 'b', ustaTipiAdi: 'Boyacı', sablonSurumu: 1, hakedisSekli: 'is_bitimi', takipYontemi: 'metraj', asamalar: [] },
        ],
        kalemler: [
          { id: 'k6', ustaTipiId: 's', ad: 'İç sıva', birim: 'm²', aciklama: '', miktar: 100, birimFiyat: TL(180), butceKalemiKodu: null },
          { id: 'k7', ustaTipiId: 'b', ad: 'İç boya', birim: 'm²', aciklama: '', miktar: 100, birimFiyat: TL(90), butceKalemiKodu: null },
        ],
        sorumluluklar: [
          { ustaTipiId: 's', soru: 'Malzeme kimde?', cevap: 'muteahhit', aciklama: '' },
          { ustaTipiId: 'b', soru: 'Malzeme kimde?', cevap: 'usta', aciklama: '' },
        ],
      }),
      kaynak,
    );
    expect(m.altBaslik).toBe('Sıvacı · Boyacı');
    expect(m.maddeler[0]!.paragraflar[0]).toContain('Sıvacı ve Boyacı işlerinin');
    expect(m.taraflar[1]!.satirlar[0]).toBe('Sıfatı: Sıvacı, Boyacı');
    const t = m.maddeler[1]!.tablo!;
    expect(t.satirTurleri).toEqual(['grup', 'kalem', 'ara', 'grup', 'kalem', 'ara']);
    expect(t.satirlar[0]).toEqual(['Sıvacı işleri']);
    expect(t.satirlar[2]).toEqual(['Sıvacı toplamı', '', '', '', '₺18.000,00']);
    expect(t.alt).toEqual(['Genel toplam (tahmini)', '', '', '', '₺27.000,00']);
    const madde = (b: string) => m.maddeler.find((x) => x.baslik === b)!;
    expect(madde('Malzeme ve sorumluluklar').liste).toEqual(["Sıvacı · Malzeme kimde: İşveren'e aittir.", "Boyacı · Malzeme kimde: Yüklenici'ye aittir."]);
    expect(madde('Hakediş ve ödeme').paragraflar[0]).toBe('Hakediş her iş için ayrı yapılır:');
    expect(madde('Hakediş ve ödeme').liste).toHaveLength(2);
  });
});

describe('aşama ve teminat', () => {
  const kalip = { ustaTipiId: 'd', ustaTipiAdi: 'Kalıpçı', sablonSurumu: 1, hakedisSekli: 'beton_dokumu' as const, takipYontemi: 'asama' as const };
  it('metinde aşamalar tutarlarıyla ve teminat hükmü yer alır', () => {
    const m = sozlesmeMetni(
      icerik({ teminatOrani: 5, bolumler: [{ ...kalip, asamalar: [{ id: 'a1', ad: '1. kat betonu', tutar: TL(85_000) }, { id: 'a2', ad: 'Çatı', tutar: 0 }] }] }),
      kaynak,
    );
    const p = m.maddeler.find((x) => x.baslik === 'Hakediş ve ödeme')!.paragraflar;
    expect(p[1]).toBe('Hakediş aşağıdaki aşamalar tamamlandıkça, aşamanın tutarı üzerinden yapılır: 1. kat betonu ₺85.000,00; Çatı ….');
    expect(p[2]).toContain("Her hakedişten %5 teminat kesilir");
  });

  it('aşamasız ya da tutarsız aşamalı iş eksik bilgi; aşama toplamı kalem toplamından farklıysa uyarı', () => {
    expect(eksikBilgiler(icerik({ bolumler: [{ ...kalip, asamalar: [] }] }))).toEqual(['Kalıpçı: aşamalı hakediş için aşamaları yazın.']);
    expect(eksikBilgiler(icerik({ bolumler: [{ ...kalip, asamalar: [{ id: 'a', ad: 'Temel', tutar: 0 }] }] }))).toEqual(['Kalıpçı: tutarı yazılmamış aşama var.']);
    const u = sozlesmeUyarilari(icerik({ bolumler: [{ ...kalip, asamalar: [{ id: 'a', ad: 'Temel', tutar: TL(100_000) }] }] }));
    expect(u).toEqual(['Kalıpçı: aşamaların toplamı (₺100.000,00) kalemlerin toplamından (₺102.042,50) farklı.']);
  });
});

describe('tahmini tutar', () => {
  it('aşamalı işte aşama toplamı, diğerinde miktarlı kalem toplamı', () => {
    const t = sozlesmeTahminiTutari({
      bolumler: [
        { ustaTipiId: 's', ustaTipiAdi: 'Sıvacı', sablonSurumu: 1, hakedisSekli: 'kat', takipYontemi: 'metraj', asamalar: [] },
        { ustaTipiId: 'k', ustaTipiAdi: 'Kalıpçı', sablonSurumu: 1, hakedisSekli: 'beton_dokumu', takipYontemi: 'asama', asamalar: [{ id: 'a', ad: 'Temel', tutar: TL(85_000) }] },
      ],
      kalemler: [
        { id: '1', ustaTipiId: 's', ad: 'Sıva', birim: 'm²', aciklama: '', miktar: 100, birimFiyat: TL(180), butceKalemiKodu: null },
        { id: '2', ustaTipiId: 'k', ad: 'Kalıp', birim: 'm²', aciklama: '', miktar: null, birimFiyat: TL(400), butceKalemiKodu: null },
      ],
    });
    expect(t).toEqual({ toplam: TL(103_000), eksikMiktar: false });
  });
});
