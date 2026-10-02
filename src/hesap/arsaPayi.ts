// Kat karşılığında arsa sahiplerinin beklenen payı ve tahsis edilenler.
// Beklenen = toplam × arsa sahipleri payı × kişinin hissesi; toplam pay yöntemine göre
// brüt m², net m² ya da bölüm sayısıdır. m²'si girilmemiş bölüm toplama girmez, ayrıca sayılır.
// Bölüm sayısı yönteminde konut (daire) ve dükkan ayrı sayılır, beklenen pay her tür için ayrı hesaplanır;
// ofis ve diğer bölümler dükkanla birlikte (işyeri) sayılır.

import type { BagimsizBolum, PayYontemi } from '../veri/tipler';

export interface PayBolumu {
  id: string;
  tip: BagimsizBolum['tip'];
  brutM2: number | null;
  netM2: number | null;
}

export interface PayToplami {
  daire: number;
  /** Dükkan, ofis ve diğer bölümler. */
  dukkan: number;
  brutM2: number;
  netM2: number;
}

export interface SahipPayi extends PayToplami {
  cariId: string;
  hisse: number;
  /** m² yönteminde beklenen m²; bölüm sayısı yönteminde beklenen toplam bölüm. */
  beklenen: number;
  /** Bölüm sayısı yönteminde türe göre beklenen. */
  beklenenDaire: number;
  beklenenDukkan: number;
}

export interface ArsaPaylari {
  sahipler: SahipPayi[];
  /** Hiçbir arsa sahibine tahsis edilmemiş bölümler. */
  muteahhit: PayToplami;
  /** Bütün bölümlerin yönteme göre toplamı. */
  toplam: number;
  /** Yöntem m² iken m²'si girilmemiş bölüm sayısı (beklenen eksik hesaplanır). */
  eksikAlan: number;
}

const bos = (): PayToplami => ({ daire: 0, dukkan: 0, brutM2: 0, netM2: 0 });
export const konutMu = (b: Pick<PayBolumu, 'tip'>) => b.tip === 'daire';

function ekle(t: PayToplami, b: PayBolumu) {
  if (konutMu(b)) t.daire++;
  else t.dukkan++;
  t.brutM2 += b.brutM2 ?? 0;
  t.netM2 += b.netM2 ?? 0;
}

/** Yönteme göre bölümün payı: m² ya da 1 (adet); m²'si yoksa null. */
export function bolumDegeri(b: PayBolumu, yontem: PayYontemi): number | null {
  if (yontem === 'adet') return 1;
  return yontem === 'brut' ? b.brutM2 : b.netM2;
}

export function arsaPaylari(
  bolumler: PayBolumu[],
  /** bolumId → arsa sahibinin cariId'si */
  tahsis: ReadonlyMap<string, string>,
  arsaSahibiOrani: number,
  sahipler: { cariId: string; hisse: number }[],
  yontem: PayYontemi,
): ArsaPaylari {
  let toplam = 0;
  let eksikAlan = 0;
  const tum = bos();
  for (const b of bolumler) {
    ekle(tum, b);
    const d = bolumDegeri(b, yontem);
    if (d === null) eksikAlan++;
    else toplam += d;
  }

  const pay = (t: number, hisse: number) => (t * arsaSahibiOrani * hisse) / 10000;
  const satirlar = new Map(
    sahipler.map((s) => [
      s.cariId,
      { ...s, ...bos(), beklenen: pay(toplam, s.hisse), beklenenDaire: pay(tum.daire, s.hisse), beklenenDukkan: pay(tum.dukkan, s.hisse) },
    ]),
  );
  const muteahhit = bos();
  for (const b of bolumler) {
    const sahip = satirlar.get(tahsis.get(b.id) ?? '');
    ekle(sahip ?? muteahhit, b);
  }
  return { sahipler: [...satirlar.values()], muteahhit, toplam, eksikAlan };
}
