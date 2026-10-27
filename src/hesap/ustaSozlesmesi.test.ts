import { describe, expect, it } from 'vitest';
import { eksikBilgiler, kalemTutari, sozlesmeMetni, sozlesmeToplami, sozlesmeUyarilari, type MetinKaynaklari, type SozlesmeIcerigi } from './ustaSozlesmesi';

const TL = (n: number) => Math.round(n * 100);

const icerik = (d: Partial<SozlesmeIcerigi> = {}): SozlesmeIcerigi & { ustaTipiAdi: string } => ({
  ustaTipiAdi: 'Duvarcı',
  sozlesmeTarihi: '2026-11-01',
  baslamaTarihi: '2026-11-05',
  bitisTarihi: '2027-01-31',
  fiyatlamaBirimi: 'm²',
  kalemler: [{ ad: 'Duvar örme', birim: 'm²', aciklama: '', miktar: 1200.5, birimFiyat: TL(85), butceKalemiKodu: 'duvar' }],
  sorumluluklar: [{ soru: 'Malzeme taşıma kimde?', cevap: 'usta', aciklama: '' }],
  ortakMaddeler: [{ id: 'olcum', baslik: 'Ölçüm yöntemi ve metrajı kimin onaylayacağı', cevap: 'Şantiye şefi ölçer.' }],
  ozelSartlar: '1. Duvar şakülünde örülür.\n\n2) Moloz her gün toplanır.',
  hakedisSekli: 'kat',
  odemeKosulu: 'Hakediş onayından sonra 7 gün içinde.',
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
          { ad: 'Duvar örme', birim: 'm²', aciklama: '', miktar: null, birimFiyat: 0, butceKalemiKodu: null },
          { ad: ' ', birim: 'm²', aciklama: '', miktar: null, birimFiyat: TL(1), butceKalemiKodu: null },
        ],
        sorumluluklar: [
          { soru: 'İskele kimde?', cevap: null, aciklama: '' },
          { soru: 'Malzeme kimde?', cevap: 'sozlesmede', aciklama: ' ' },
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
    const s = icerik({ baslamaTarihi: null, bitisTarihi: null, kalemler: [{ ad: 'Duvar', birim: 'm²', aciklama: '', miktar: null, birimFiyat: TL(85), butceKalemiKodu: null }] });
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
      { ...icerik(), ustaTipiAdi: 'Kalıpçı (demir işçiliği dahil)' },
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
        kalemler: [{ ad: 'Duvar', birim: 'm²', aciklama: '', miktar: null, birimFiyat: 0, butceKalemiKodu: null }],
        sorumluluklar: [{ soru: 'İskele kimde?', cevap: null, aciklama: '' }],
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
