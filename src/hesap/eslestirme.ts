import type { Kurus } from '../veri/tipler';

// Ödemenin açık borçlara dağıtımı. Veritabanını bilmez.

export interface AcikBorc {
  id: string;
  /** Vade yoksa gider tarihi; en eski önce kapanır. */
  sira: string;
  kalan: Kurus;
}

/**
 * Tutar, açık borçlara en eski vadeden başlayarak dağıtılır (FIFO).
 * Artan kısım avans olarak açık kalır.
 */
export function otomatikDagit(tutar: Kurus, borclar: AcikBorc[]): { dagitim: Map<string, Kurus>; avans: Kurus } {
  const dagitim = new Map<string, Kurus>();
  let kalan = Math.max(tutar, 0);
  for (const b of [...borclar].sort((x, y) => x.sira.localeCompare(y.sira))) {
    if (kalan <= 0) break;
    const pay = Math.min(kalan, b.kalan);
    if (pay > 0) {
      dagitim.set(b.id, pay);
      kalan -= pay;
    }
  }
  return { dagitim, avans: kalan };
}
