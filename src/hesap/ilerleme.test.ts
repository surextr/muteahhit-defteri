import { describe, expect, it } from 'vitest';
import type { Hakedis, Kalem, KalemIlerlemesi, TakipBasligi, UstaSozlesmesi } from '../veri/tipler';
import { butceAgaci } from './butce';
import { devamEdenAsama, gecerliIlerlemeler, hakedisOnerileri, projeIlerlemesi, yuzdeHatasi } from './ilerleme';

const ortak = (id: string, zaman = '2026-10-01T09:00:00.000Z') => ({
  id,
  firmaId: 'f1',
  olusturan: 'u1',
  olusturmaZamani: zaman,
  guncelleyen: 'u1',
  guncellemeZamani: zaman,
  surum: 1,
  iptal: null,
});
const IPTAL = { zaman: '2026-10-02T09:00:00.000Z', kullaniciId: 'u1', gerekce: '' };
const TL = (n: number) => n * 100;

const kalem = (id: string, ust: string | null, butce: number | null, kod: string | null = null): Kalem => ({
  ...ortak(id),
  projeId: 'p1',
  sistemKodu: kod,
  ustKalemId: ust,
  ad: id,
  birim: null,
  butceMiktari: null,
  butceTutari: butce === null ? null : TL(butce),
  sira: 1,
});

const giris = (id: string, kalemId: string, tarih: string, yuzde: number, ek: Partial<KalemIlerlemesi> = {}): KalemIlerlemesi => ({
  ...ortak(id, ek.olusturmaZamani),
  projeId: 'p1',
  kalemId,
  tarih,
  yuzde,
  kaynak: 'elle',
  hakedisId: null,
  not: '',
  ...ek,
});

describe('ilerleme', () => {
  it('geçerli yüzde en yeni tarihli, eşitse en son girilen iptal edilmemiş kayıttır', () => {
    const g = gecerliIlerlemeler([
      giris('1', 'kaba', '2026-10-01', 20),
      giris('2', 'kaba', '2026-10-10', 40),
      giris('3', 'kaba', '2026-10-10', 45, { olusturmaZamani: '2026-10-10T12:00:00.000Z' }),
      giris('4', 'kaba', '2026-10-20', 90, { iptal: IPTAL }),
      giris('5', 'ince', '2026-09-01', 5),
    ]);
    expect(g.get('kaba')!.yuzde).toBe(45);
    expect(g.get('ince')!.yuzde).toBe(5);
  });

  it('genel ilerleme bütçe ağırlıklıdır; harcama ilerlemeyi eşikten fazla geçerse uyarı verir', () => {
    const agac = butceAgaci(
      [
        kalem('kaba', null, null),
        kalem('beton', 'kaba', 600_000),
        kalem('demir', 'kaba', 400_000),
        kalem('ince', null, 1_000_000),
        kalem('peyzaj', null, null),
      ],
      new Map([
        ['beton', TL(500_000)],
        ['demir', TL(300_000)],
        ['ince', TL(50_000)],
        ['peyzaj', TL(20_000)],
      ]),
    );
    // Giriş yokken yüzde ve uyarı yok, harcama yüzdesi var.
    const bos = projeIlerlemesi(agac, new Map());
    expect(bos).toMatchObject({ ilerleme: null, uyari: false, girildi: false });
    expect(bos.harcamaYuzdesi).toBeCloseTo(43.5);

    const i = projeIlerlemesi(agac, gecerliIlerlemeler([giris('1', 'kaba', '2026-10-01', 60)]));
    // (1.000.000 × 60 + 1.000.000 × 0) / 2.000.000
    expect(i.ilerleme).toBe(30);
    expect(i.harcamaYuzdesi).toBeCloseTo(43.5);
    expect(i.uyari).toBe(true);
    const [kaba, ince, peyzaj] = i.kalemler;
    expect(kaba).toMatchObject({ yuzde: 60, harcamaYuzdesi: 80, uyari: true });
    expect(kaba!.fark).toBeCloseTo(20);
    // Yüzdesi girilmemiş kalem %0 sayılır: %5 harcama eşiği geçmez.
    expect(ince).toMatchObject({ yuzde: null, harcamaYuzdesi: 5, uyari: false });
    // Bütçesiz kalemde yüzde hesaplanmaz.
    expect(peyzaj).toMatchObject({ butce: null, harcamaYuzdesi: null, uyari: false });

    const iyi = projeIlerlemesi(agac, gecerliIlerlemeler([giris('1', 'kaba', '2026-10-01', 75), giris('2', 'ince', '2026-10-01', 10)]));
    expect(iyi.ilerleme).toBe(42.5);
    expect(iyi.uyari).toBe(false);
    expect(iyi.kalemler[0]!.uyari).toBe(false);
  });

  it('devam eden aşama sıraca ilk; birden çoksa +n', () => {
    const b = (ad: string, sira: number, durum: TakipBasligi['durum']): TakipBasligi => ({
      ...ortak(ad),
      projeId: 'p1',
      ad,
      sira,
      durum,
      baslangicTarihi: null,
      bitisTarihi: null,
      not: '',
    });
    expect(devamEdenAsama([b('Ruhsat', 0, 'tamamlandi'), b('İnce', 2, 'devam'), b('Kaba inşaat', 1, 'devam')])).toBe('Kaba inşaat +1');
    expect(devamEdenAsama([b('Ruhsat', 0, 'baslamadi')])).toBeNull();
  });

  it('hakedişten öneri: metrajda miktarlı kalemler, aşamalıda aşama tutarları; ilave iş sayılmaz', () => {
    const kalemler = [
      kalem('kaba', null, null, 'kaba'),
      kalem('kalip', 'kaba', 1_000_000, 'kalip'),
      kalem('ince', null, null, 'ince'),
      kalem('siva', 'ince', 500_000, 'siva'),
    ];
    const sozlesme = (id: string, ek: Partial<UstaSozlesmesi>) =>
      ({ ...ortak(id), onay: { zaman: '', kullaniciId: 'u1' }, projeId: 'p1', ...ek }) as unknown as UstaSozlesmesi;
    const kalipci = sozlesme('s1', {
      bolumler: [
        {
          ustaTipiId: 'kalipci',
          takipYontemi: 'asama',
          asamalar: [
            { id: 'a1', ad: '1. kat', tutar: TL(100_000) },
            { id: 'a2', ad: '2. kat', tutar: TL(100_000) },
          ],
        },
      ],
      kalemler: [{ id: 'k1', ustaTipiId: 'kalipci', ad: 'Kalıp', birim: 'm²', aciklama: '', miktar: null, birimFiyat: 0, butceKalemiKodu: 'kalip' }],
    } as unknown as Partial<UstaSozlesmesi>);
    const sivaci = sozlesme('s2', {
      bolumler: [{ ustaTipiId: 'sivaci', takipYontemi: 'metraj', asamalar: [] }],
      kalemler: [
        { id: 'k2', ustaTipiId: 'sivaci', ad: 'İç sıva', birim: 'm²', aciklama: '', miktar: 1000, birimFiyat: TL(200), butceKalemiKodu: 'siva' },
        { id: 'k3', ustaTipiId: 'sivaci', ad: 'Dış sıva', birim: 'm²', aciklama: '', miktar: null, birimFiyat: TL(300), butceKalemiKodu: 'siva' },
      ],
    } as unknown as Partial<UstaSozlesmesi>);
    const taslak = { ...sivaci, id: 's3', onay: null } as UstaSozlesmesi;
    const hakedis = (id: string, sozlesmeId: string, no: number, satirlar: unknown[], ek: Partial<Hakedis> = {}) =>
      ({ ...ortak(id), sozlesmeId, no, tarih: `2026-10-0${no}`, onay: { zaman: '', kullaniciId: 'u1' }, satirlar, ...ek }) as unknown as Hakedis;
    const oneri = hakedisOnerileri(
      kalemler,
      [kalipci, sivaci, taslak],
      [
        hakedis('h1', 's1', 1, [{ ustaTipiId: 'kalipci', tur: 'asama', tutar: TL(100_000), butceKalemiKodu: 'kalip' }]),
        hakedis('h2', 's2', 1, [
          { ustaTipiId: 'sivaci', tur: 'metraj', tutar: TL(50_000), butceKalemiKodu: 'siva' },
          { ustaTipiId: 'sivaci', tur: 'ilave', tutar: TL(90_000), butceKalemiKodu: 'siva' },
        ]),
        hakedis('h3', 's2', 2, [{ ustaTipiId: 'sivaci', tur: 'metraj', tutar: TL(10_000), butceKalemiKodu: 'siva' }], { onay: null }),
        hakedis('h4', 's3', 1, [{ ustaTipiId: 'sivaci', tur: 'metraj', tutar: TL(99_000), butceKalemiKodu: 'siva' }]),
      ],
    );
    expect(oneri.get('kaba')).toMatchObject({ yuzde: 50, sozlesmeTutari: TL(200_000), yapilan: TL(100_000), sonHakedisId: 'h1' });
    expect(oneri.get('ince')).toMatchObject({ yuzde: 25, sozlesmeTutari: TL(200_000), yapilan: TL(50_000), sonHakedisId: 'h2', sozlesmeSayisi: 1 });
  });

  it('yüzde 0–100 arasında olmalı', () => {
    expect(yuzdeHatasi(null)).toBe('Yüzde yazın.');
    expect(yuzdeHatasi(101)).toMatch('0 ile 100');
    expect(yuzdeHatasi(0)).toBeNull();
  });
});
