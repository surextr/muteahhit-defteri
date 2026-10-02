// Kat karşılığında arsa sahiplerinin beklenen payı ve tahsis edilenler.
// Beklenen = toplam × arsa sahipleri payı × kişinin hissesi; toplam pay yöntemine göre
// brüt m², net m² ya da bölüm sayısıdır. m²'si girilmemiş bölüm toplama girmez, ayrıca sayılır.

import type { PayYontemi } from '../veri/tipler';

export interface PayBolumu {
  id: string;
  brutM2: number | null;
  netM2: number | null;
}

export interface PayToplami {
  adet: number;
  brutM2: number;
  netM2: number;
}

export interface SahipPayi extends PayToplami {
  cariId: string;
  hisse: number;
  /** Seçilen yönteme göre: m² ya da bölüm sayısı. */
  beklenen: number;
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

const bos = (): PayToplami => ({ adet: 0, brutM2: 0, netM2: 0 });

function ekle(t: PayToplami, b: PayBolumu) {
  t.adet++;
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
  for (const b of bolumler) {
    const d = bolumDegeri(b, yontem);
    if (d === null) eksikAlan++;
    else toplam += d;
  }

  const satirlar = new Map(sahipler.map((s) => [s.cariId, { ...s, ...bos(), beklenen: (toplam * arsaSahibiOrani * s.hisse) / 10000 }]));
  const muteahhit = bos();
  for (const b of bolumler) {
    const sahip = satirlar.get(tahsis.get(b.id) ?? '');
    ekle(sahip ?? muteahhit, b);
  }
  return { sahipler: [...satirlar.values()], muteahhit, toplam, eksikAlan };
}
