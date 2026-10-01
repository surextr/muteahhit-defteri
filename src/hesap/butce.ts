import type { Gider, GiderSatiri, Kalem, Kurus } from '../veri/tipler';

/**
 * Kalem bazında gerçekleşen maliyet. Anahtar kalemId (kalemsiz satırlar: null).
 * kdvDahil: firma ayarı (FirmaAyarlari.kdvMaliyeteDahil).
 * Onaylı hakedişler 2. aşamada eklenecek.
 */
export function kalemGerceklesen(
  satirlar: GiderSatiri[],
  giderler: Gider[],
  kdvDahil: boolean,
): Map<string | null, Kurus> {
  const aktifGiderler = new Set(giderler.filter((g) => g.iptal === null).map((g) => g.id));
  const sonuc = new Map<string | null, Kurus>();
  for (const s of satirlar) {
    if (s.iptal !== null || !aktifGiderler.has(s.giderId)) continue;
    const tutar = kdvDahil ? s.toplam : s.kdvHaricTutar;
    sonuc.set(s.kalemId, (sonuc.get(s.kalemId) ?? 0) + tutar);
  }
  return sonuc;
}

export interface ButceSatiri {
  kalem: Kalem;
  butce: Kurus | null;
  gerceklesen: Kurus;
  /** butce − gerceklesen; eksi değer bütçe aşımıdır. Bütçe yoksa null. */
  kalan: Kurus | null;
}

export function butceKarsilastir(kalemler: Kalem[], gerceklesen: Map<string | null, Kurus>): ButceSatiri[] {
  return kalemler
    .filter((k) => k.iptal === null)
    .sort((a, b) => a.sira - b.sira)
    .map((kalem) => {
      const g = gerceklesen.get(kalem.id) ?? 0;
      return {
        kalem,
        butce: kalem.butceTutari,
        gerceklesen: g,
        kalan: kalem.butceTutari === null ? null : kalem.butceTutari - g,
      };
    });
}
