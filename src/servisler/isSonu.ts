import { tahminGecmisi, type IsSonuHamVerisi, type TahminDegisimi } from '../hesap/isSonu';
import type { Depo } from '../veri/depo';
import type { Kurus, Tarih } from '../veri/tipler';
import { SISTEM_KALEMI } from '../veri/sabit/hazirKalemKodlari';
import { katKarsiligiOzeti } from './katKarsiligi';

// Projenin iş sonu maliyet tahmini ve son aylardaki değişimi (saf hesap `hesap/isSonu.ts`). Kayıtlar bir kez okunur;
// geçmiş noktalar aynı kayıtların o güne kadar bilinenleriyle hesaplanır.

const aktif = <T extends { iptal: unknown }>(l: T[]) => l.filter((k) => k.iptal === null);

export interface IsSonuRaporu {
  gecmis: TahminDegisimi[];
  /** Son nokta (bugün). */
  bugun: TahminDegisimi;
}

export async function isSonuRaporuGetir(depo: Depo, firmaId: string, projeId: string, kdvDahil: boolean, bugun: Tarih, ay = 6): Promise<IsSonuRaporu> {
  const k = { projeId, firmaId };
  const [kalemler, giderler, ilerlemeKayitlari, sozlesmeler, hakedisler, satislar, bolumler, alacaklar, kk] = await Promise.all([
    depo.listele('kalem', k),
    depo.listele('gider', k),
    depo.listele('kalemIlerlemesi', k),
    depo.listele('ustaSozlesmesi', k),
    depo.listele('hakedis', k),
    depo.listele('satis', k),
    depo.listele('bagimsizBolum', k),
    depo.listele('alacak', k),
    katKarsiligiOzeti(depo, firmaId, projeId, bugun),
  ]);
  const satirlar = (await Promise.all(giderler.map((g) => depo.listele('giderSatiri', { giderId: g.id, firmaId })))).flat();

  // Arsa sahibine kalan ödeme (nakit plan + teslime kadar kira − ödenen) "Arsa ve kat karşılığı giderleri" ana kalemine.
  const kkTaahhudu = new Map<string, Kurus>();
  const kkKalemi = aktif(kalemler).find((x) => x.sistemKodu === SISTEM_KALEMI.katKarsiligi && x.ustKalemId === null);
  if (kk && kkKalemi) {
    const kalan = kk.yukumlulukler.reduce((t, y) => t + Math.max(0, y.nakitToplam + y.kiraTahmini - y.odenen), 0);
    if (kalan > 0) kkTaahhudu.set(kkKalemi.id, kalan);
  }

  const ham: IsSonuHamVerisi = {
    kalemler,
    giderler: giderler.filter((g) => g.tur === 'alis' || g.tur === 'iade'),
    satirlar,
    ilerlemeKayitlari: aktif(ilerlemeKayitlari),
    sozlesmeler: aktif(sozlesmeler),
    hakedisler: aktif(hakedisler),
    satislar: aktif(satislar),
    bolumler: aktif(bolumler),
    ilaveImalat: aktif(alacaklar).filter((a) => a.kaynakTur === 'ilaveImalat'),
    katKarsiligiTaahhudu: kkTaahhudu,
    kdvDahil,
  };
  const gecmis = tahminGecmisi(ham, bugun, ay);
  return { gecmis, bugun: gecmis.at(-1)! };
}
