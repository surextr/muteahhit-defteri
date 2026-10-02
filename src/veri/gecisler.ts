// Şema sürümleri arasındaki kayıt dönüşümleri. Hem cihazdaki veritabanı güncellenirken
// (indexeddb/sema.ts) hem de eski sürümlü yedek geri yüklenirken (servisler/yedek.ts)
// aynı fonksiyonlar kullanılır; iki yol hiçbir zaman farklı sonuç vermez.
// Kayıtlar düz nesnedir: eski sürümün tipleri artık yoktur.

type Kayit = Record<string, unknown>;

/**
 * Şema 1 → 2:
 * - gider: `doviz` alanı yerine `paraBirimi` (varsayılan 'TRY') ve `kur`; `tevkifatToplam` = 0
 * - giderSatiri: `tevkifat` = null, `tevkifatTutari` = 0
 */
export function giderSurum2(g: Kayit): Kayit {
  const { doviz, ...geri } = g as Kayit & { doviz?: { paraBirimi: string; kur: number } | null };
  return {
    ...geri,
    tevkifatToplam: (g.tevkifatToplam as number | undefined) ?? 0,
    paraBirimi: (g.paraBirimi as string | undefined) ?? doviz?.paraBirimi ?? 'TRY',
    kur: (g.kur as number | null | undefined) ?? doviz?.kur ?? null,
  };
}

export function giderSatiriSurum2(s: Kayit): Kayit {
  return {
    ...s,
    tevkifat: (s.tevkifat as unknown) ?? null,
    tevkifatTutari: (s.tevkifatTutari as number | undefined) ?? 0,
  };
}

/** Yedek dosyasındaki tablolar için: şema n → n+1. */
export const TABLO_DONUSTURUCULERI: Record<number, (tablolar: Record<string, unknown[]>) => Record<string, unknown[]>> = {
  1: (t) => ({
    ...t,
    ...(t.gider ? { gider: (t.gider as Kayit[]).map(giderSurum2) } : {}),
    ...(t.giderSatiri ? { giderSatiri: (t.giderSatiri as Kayit[]).map(giderSatiriSurum2) } : {}),
  }),
};
