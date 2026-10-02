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

/**
 * Şema 2 → 3: iade faturası.
 * - gider: `tur` = 'alis', `iadeEdilenGiderId` = null
 * - eslestirme: `kaynakTur` = 'odeme'
 */
export function giderSurum3(g: Kayit): Kayit {
  return { ...g, tur: (g.tur as string | undefined) ?? 'alis', iadeEdilenGiderId: (g.iadeEdilenGiderId as string | null | undefined) ?? null };
}

export function eslestirmeSurum3(e: Kayit): Kayit {
  return { ...e, kaynakTur: (e.kaynakTur as string | undefined) ?? 'odeme' };
}

/**
 * Şema 3 → 4: çek/senet şube, keşideci ve (verilende) bağlı banka hesabı.
 * - cekSenet: `sube`, `kesideci`, `hesapId` = null
 */
export function cekSenetSurum4(c: Kayit): Kayit {
  return {
    ...c,
    sube: (c.sube as string | null | undefined) ?? null,
    kesideci: (c.kesideci as string | null | undefined) ?? null,
    hesapId: (c.hesapId as string | null | undefined) ?? null,
  };
}

/** Yedek dosyasındaki tablolar için: şema n → n+1. */
export const TABLO_DONUSTURUCULERI: Record<number, (tablolar: Record<string, unknown[]>) => Record<string, unknown[]>> = {
  1: (t) => ({
    ...t,
    ...(t.gider ? { gider: (t.gider as Kayit[]).map(giderSurum2) } : {}),
    ...(t.giderSatiri ? { giderSatiri: (t.giderSatiri as Kayit[]).map(giderSatiriSurum2) } : {}),
  }),
  2: (t) => ({
    ...t,
    ...(t.gider ? { gider: (t.gider as Kayit[]).map(giderSurum3) } : {}),
    ...(t.eslestirme ? { eslestirme: (t.eslestirme as Kayit[]).map(eslestirmeSurum3) } : {}),
  }),
  3: (t) => ({
    ...t,
    ...(t.cekSenet ? { cekSenet: (t.cekSenet as Kayit[]).map(cekSenetSurum4) } : {}),
  }),
};
