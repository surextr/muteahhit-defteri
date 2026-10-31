import { describe, expect, it } from 'vitest';
import type { Gider, GiderSatiri, Kalem, KalemIlerlemesi } from '../veri/tipler';
import { degisimNedenleri, isSonuAnlik, kalemTahmini, tahminGecmisi, type IsSonuHamVerisi } from './isSonu';

const TL = (n: number) => Math.round(n * 100);

describe('iş sonu tahmini', () => {
  it('kalem: ilerlemeye göre, bütçeye göre, taahhüt alt sınırı', () => {
    // %40 yapıldı, 400 harcandı → 1000 (bütçe 800 olsa da).
    expect(kalemTahmini({ butce: TL(800), harcanan: TL(400), ilerleme: 40, taahhut: 0 })).toEqual({ tahmin: TL(1000), yontem: 'ilerleme' });
    // İlerleme eşik altı → bütçe.
    expect(kalemTahmini({ butce: TL(800), harcanan: TL(50), ilerleme: 5, taahhut: 0 })).toEqual({ tahmin: TL(800), yontem: 'butce' });
    // Sözleşmelerde kalan iş bütçeyi aşıyor → harcanan + taahhüt.
    expect(kalemTahmini({ butce: TL(800), harcanan: TL(300), ilerleme: null, taahhut: TL(700) })).toEqual({ tahmin: TL(1000), yontem: 'taahhut' });
    // İlerleme hızı taahhüdün altında kalırsa taahhüt kazanır.
    expect(kalemTahmini({ butce: null, harcanan: TL(500), ilerleme: 50, taahhut: TL(800) })).toEqual({ tahmin: TL(1300), yontem: 'taahhut' });
    // Tamamlanan iş: harcanan.
    expect(kalemTahmini({ butce: TL(800), harcanan: TL(750), ilerleme: 100, taahhut: 0 })).toEqual({ tahmin: TL(750), yontem: 'ilerleme' });
    expect(kalemTahmini({ butce: null, harcanan: TL(90), ilerleme: null, taahhut: 0 })).toEqual({ tahmin: TL(90), yontem: 'harcanan' });
  });

  const kayit = { firmaId: 'f', iptal: null, olusturan: 'u', guncelleyen: 'u', guncellemeZamani: '2026-01-01T00:00:00Z' };
  const kalem = (id: string, ad: string, butce: number | null, sira: number): Kalem =>
    ({ ...kayit, id, ad, projeId: 'p', ustKalemId: null, birim: null, butceMiktari: null, butceTutari: butce === null ? null : TL(butce), sira, sistemKodu: null, olusturmaZamani: '2026-01-01T00:00:00Z' }) as Kalem;
  const gider = (id: string, tarih: string, girildi = `${tarih}T10:00:00Z`): Gider =>
    ({ ...kayit, id, tur: 'alis', tarih, olusturmaZamani: girildi, projeId: 'p', cariId: null, faturaNo: null, vadeTarihi: null, hakedisId: null }) as unknown as Gider;
  const satir = (giderId: string, kalemId: string, tutar: number): GiderSatiri =>
    ({ ...kayit, id: `s-${giderId}`, giderId, kalemId, kdvHaricTutar: TL(tutar), toplam: TL(tutar), olusturmaZamani: '2026-01-01T00:00:00Z' }) as unknown as GiderSatiri;
  const ilerleme = (kalemId: string, tarih: string, yuzde: number): KalemIlerlemesi =>
    ({ ...kayit, id: `i-${kalemId}-${tarih}`, projeId: 'p', kalemId, tarih, yuzde, kaynak: 'elle', hakedisId: null, not: '', olusturmaZamani: `${tarih}T10:00:00Z` }) as KalemIlerlemesi;

  const ham = (): IsSonuHamVerisi => ({
    kalemler: [kalem('k1', 'Kaba inşaat', 1000, 1), kalem('k2', 'İnce inşaat', 2000, 2)],
    giderler: [gider('g1', '2026-08-10'), gider('g2', '2026-09-15'), gider('g3', '2026-10-05', '2026-10-20T09:00:00Z')],
    satirlar: [satir('g1', 'k1', 200), satir('g2', 'k1', 300), satir('g3', 'k2', 100)],
    ilerlemeKayitlari: [ilerleme('k1', '2026-08-31', 20), ilerleme('k1', '2026-09-30', 40)],
    sozlesmeler: [],
    hakedisler: [],
    satislar: [],
    bolumler: [],
    ilaveImalat: [],
    katKarsiligiTaahhudu: new Map(),
    kdvDahil: true,
  });

  it('o günkü durumla: kayıtlar kendi tarihine göre (sonradan girilen fatura kendi gününe)', () => {
    const agustos = isSonuAnlik(ham(), '2026-08-31');
    expect(agustos.harcanan).toBe(TL(200));
    // Kaba: 200 / %20 = 1000; ince: projede ilerleme var ama ince girilmedi → %0 → bütçe 2000.
    expect(agustos.kalemler.map((k) => [k.ad, k.tahmin / 100, k.yontem])).toEqual([
      ['Kaba inşaat', 1000, 'ilerleme'],
      ['İnce inşaat', 2000, 'butce'],
    ]);
    const eylul = isSonuAnlik(ham(), '2026-09-30');
    expect(eylul.kalemler[0]!.tahmin).toBe(TL(1250)); // 500 / %40
    // g3'ün tarihi 5 Ekim, programa 20 Ekim'de girildi: 10 Ekim'deki durumda sayılır.
    expect(isSonuAnlik(ham(), '2026-10-04').harcanan).toBe(TL(500));
    expect(isSonuAnlik(ham(), '2026-10-10').harcanan).toBe(TL(600));
    expect(isSonuAnlik(ham(), '2026-10-31').harcanan).toBe(TL(600));
  });

  it('geçmiş noktalar ve değişim nedenleri', () => {
    const g = tahminGecmisi(ham(), '2026-10-31', 3);
    expect(g.map((x) => x.gun)).toEqual(['2026-07-31', '2026-08-31', '2026-09-30', '2026-10-31']);
    expect(g.map((x) => x.tahmin.tahmin / 100)).toEqual([3000, 3000, 3250, 3250]);
    expect(g[2]!.karFarki).toBe(TL(-250));
    expect(g[2]!.nedenler).toEqual(['Kaba inşaat: maliyet +250 TL (harcanan +300 TL, ilerleme %20 → %40)']);
    expect(degisimNedenleri(g[3]!.tahmin, g[3]!.tahmin)).toEqual([]);
  });
});
