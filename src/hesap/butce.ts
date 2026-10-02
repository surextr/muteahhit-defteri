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

// ─── Kalem ağacı: ana kalem → alt kalemler ─────────────────────────

/**
 * Kalemler iki seviyelidir. Bütçe yalnızca alt kalemi olmayan kalemde girilir;
 * ana kalemin bütçesi ve gerçekleşeni alt kalemlerinin toplamıdır. Böylece
 * aynı maliyet hem ana hem alt kalemde sayılmaz.
 */
export interface ButceDugumu {
  kalem: Kalem;
  altlar: ButceDugumu[];
  /** Kendi bütçesi (yaprak) ya da alt kalemlerin toplamı. Hiçbirinde bütçe yoksa null. */
  butce: Kurus | null;
  /** Kendisine ve alt kalemlerine yazılan gerçekleşen. */
  gerceklesen: Kurus;
  /** butce − gerceklesen; eksi değer aşımdır. Bütçe yoksa null. */
  kalan: Kurus | null;
  /** gerceklesen / butce, yüzde; bütçe yok ya da sıfırsa null. */
  oran: number | null;
}

export interface ButceOzeti {
  dugumler: ButceDugumu[];
  butce: Kurus;
  gerceklesen: Kurus;
  /** Kalemi seçilmemiş gider satırları. */
  kalemsiz: Kurus;
  /** Bütçesi olmadığı halde gerçekleşeni olan kalemler (uyarı için). */
  butcesizHarcama: Kurus;
}

const dugum = (kalem: Kalem, altlar: ButceDugumu[], kendiGerceklesen: Kurus): ButceDugumu => {
  const butceler = altlar.length > 0 ? altlar.map((a) => a.butce) : [kalem.butceTutari];
  const butce = butceler.some((b) => b !== null) ? butceler.reduce<number>((t, b) => t + (b ?? 0), 0) : null;
  const gerceklesen = kendiGerceklesen + altlar.reduce((t, a) => t + a.gerceklesen, 0);
  return {
    kalem,
    altlar,
    butce,
    gerceklesen,
    kalan: butce === null ? null : butce - gerceklesen,
    oran: butce ? (gerceklesen * 100) / butce : null,
  };
};

export function butceAgaci(kalemler: Kalem[], gerceklesen: Map<string | null, Kurus>): ButceOzeti {
  const aktifler = kalemler.filter((k) => k.iptal === null).sort((a, b) => a.sira - b.sira);
  const anaIdler = new Set(aktifler.filter((k) => k.ustKalemId === null).map((k) => k.id));
  const dugumler = aktifler
    .filter((k) => k.ustKalemId === null)
    .map((ana) => {
      const altlar = aktifler
        .filter((k) => k.ustKalemId === ana.id)
        .map((alt) => dugum(alt, [], gerceklesen.get(alt.id) ?? 0));
      return dugum(ana, altlar, gerceklesen.get(ana.id) ?? 0);
    });

  // İptal edilmiş ya da üstü iptal edilmiş kaleme yazılmış tutar kaybolmasın: kalemsiz sayılır.
  const bilinen = new Set([...anaIdler, ...aktifler.filter((k) => k.ustKalemId && anaIdler.has(k.ustKalemId)).map((k) => k.id)]);
  let kalemsiz = 0;
  for (const [id, tutar] of gerceklesen) if (id === null || !bilinen.has(id)) kalemsiz += tutar;

  const yapraklar = dugumler.flatMap((d) => (d.altlar.length > 0 ? d.altlar : [d]));
  return {
    dugumler,
    butce: dugumler.reduce((t, d) => t + (d.butce ?? 0), 0),
    gerceklesen: dugumler.reduce((t, d) => t + d.gerceklesen, 0) + kalemsiz,
    kalemsiz,
    butcesizHarcama: yapraklar.filter((y) => y.butce === null).reduce((t, y) => t + y.gerceklesen, 0),
  };
}
