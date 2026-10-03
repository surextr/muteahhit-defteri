// Şema sürümleri arasındaki kayıt dönüşümleri. Hem cihazdaki veritabanı güncellenirken
// (indexeddb/sema.ts) hem de eski sürümlü yedek geri yüklenirken (servisler/yedek.ts)
// aynı fonksiyonlar kullanılır; iki yol hiçbir zaman farklı sonuç vermez.
// Kayıtlar düz nesnedir: eski sürümün tipleri artık yoktur.

import { HAZIR_ODA_TIPLERI, odaTipiAnahtari, odaTipiMetniCoz } from '../hesap/odaTipi';

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

/**
 * Şema 4 → 5: proje adresi ve arsa alanı, firma bilgileri ve logo.
 * - proje: `il`, `ilce`, `mahalle` = null, `alanlar.arsa` = null
 * - firma: `bilgiler` boş alanlarla, `logo` = null
 */
export function projeSurum5(p: Kayit): Kayit {
  const alanlar = (p.alanlar as Kayit | undefined) ?? {};
  return {
    ...p,
    il: (p.il as string | null | undefined) ?? null,
    ilce: (p.ilce as string | null | undefined) ?? null,
    mahalle: (p.mahalle as string | null | undefined) ?? null,
    alanlar: { arsa: null, ...alanlar },
  };
}

export const BOS_FIRMA_BILGILERI = { yetkili: '', telefon: '', eposta: '', web: '', adres: '', vergiDairesi: '', vergiNo: '' };

export function firmaSurum5(f: Kayit): Kayit {
  return {
    ...f,
    bilgiler: { ...BOS_FIRMA_BILGILERI, ...((f.bilgiler as Kayit | undefined) ?? {}) },
    logo: (f.logo as string | null | undefined) ?? null,
  };
}

/**
 * Şema 5 → 6: parseller, bitiş tarihleri, blok özellikleri, dikey hat, arsa sahipleri.
 * - proje: tek `ada`/`parsel` ve `alanlar.arsa` → `parseller` (boşsa boş liste); `planlananBitis`, `gerceklesenBitis` = null
 * - blok: asansör 0, kapalı otopark / sığınak / jeneratör yok
 * - bagimsizBolum: `hat` = katın içindeki numara sırası (1, 2, 3…)
 * - katKarsiligiSozlesme: `arsaSahipleri` = [], `payYontemi` = 'brut'
 */
export function projeSurum6(p: Kayit): Kayit {
  const { ada, parsel, ...geri } = p as Kayit & { ada?: string; parsel?: string };
  const { arsa, ...alanlar } = ((p.alanlar as Kayit | undefined) ?? {}) as Kayit & { arsa?: number | null };
  const eskiVar = !!(ada?.trim() || parsel?.trim() || arsa != null);
  return {
    ...geri,
    alanlar,
    parseller: (p.parseller as unknown[] | undefined) ?? (eskiVar ? [{ ada: ada ?? '', parsel: parsel ?? '', alanM2: arsa ?? null }] : []),
    planlananBitis: (p.planlananBitis as string | null | undefined) ?? null,
    gerceklesenBitis: (p.gerceklesenBitis as string | null | undefined) ?? null,
  };
}

export function blokSurum6(b: Kayit): Kayit {
  return {
    ...b,
    asansorSayisi: (b.asansorSayisi as number | undefined) ?? 0,
    kapaliOtopark: (b.kapaliOtopark as boolean | undefined) ?? false,
    siginak: (b.siginak as boolean | undefined) ?? false,
    jenerator: (b.jenerator as boolean | undefined) ?? false,
  };
}

/** Bütün bölümler birlikte: hat, aynı kattaki bölümlerin numara sırasıdır. */
export function bolumlerSurum6(bolumler: Kayit[]): Kayit[] {
  const katlar = new Map<string, Kayit[]>();
  for (const b of bolumler) katlar.set(b.katId as string, [...(katlar.get(b.katId as string) ?? []), b]);
  const hatlar = new Map<Kayit, number>();
  for (const liste of katlar.values()) {
    [...liste]
      .sort((a, b) => String(a.no).localeCompare(String(b.no), 'tr', { numeric: true }))
      .forEach((b, i) => hatlar.set(b, i + 1));
  }
  return bolumler.map((b) => ({ ...b, hat: (b.hat as number | undefined) ?? hatlar.get(b)! }));
}

export function katKarsiligiSurum6(k: Kayit): Kayit {
  return { ...k, arsaSahipleri: (k.arsaSahipleri as unknown[] | undefined) ?? [], payYontemi: (k.payYontemi as string | undefined) ?? 'brut' };
}

/**
 * Şema 6 → 7: oda tipi sayılara, dubleks ayrı işarete.
 * - bagimsizBolum: serbest yazı `odaTipi` → `odaSayisi`, `salonSayisi`, `dubleks`. Çözülemeyen yazı kaybolmaz,
 *   "diğer özellikler"e eklenir. Çatı dubleksi katındaki bölüm, yazıda başkası yoksa çatı dubleksidir.
 */
export function bolumlerSurum7(bolumler: Kayit[], katlar: Kayit[]): Kayit[] {
  const catiKatlari = new Set(katlar.filter((k) => k.tip === 'cati_dubleksi').map((k) => k.id));
  return bolumler.map((b) => {
    if ('odaSayisi' in b) return b;
    const { odaTipi, ...geri } = b as Kayit & { odaTipi?: string | null };
    const c = odaTipiMetniCoz(odaTipi ?? null);
    const ozellikler = (b.ozellikler as string[] | undefined) ?? [];
    return {
      ...geri,
      odaSayisi: c.odaSayisi,
      salonSayisi: c.salonSayisi,
      dubleks: c.dubleks ?? (catiKatlari.has(b.katId) ? 'cati' : null),
      ozellikler: c.kalan && !ozellikler.includes(c.kalan) ? [...ozellikler, c.kalan] : ozellikler,
    };
  });
}

/** Şema 6 → 7: firma ayarlarına oda tipi listesi; kayıtlarda geçen ama hazır listede olmayan tipler eklenmiş sayılır. */
export function firmaSurum7(f: Kayit, bolumler: Kayit[]): Kayit {
  const ayarlar = (f.ayarlar as Kayit | undefined) ?? {};
  if (ayarlar.odaTipleri) return f;
  const hazir = new Set<string>(HAZIR_ODA_TIPLERI);
  const eklenen = [
    ...new Set(
      bolumler
        .filter((b) => b.firmaId === f.id && b.iptal === null && typeof b.odaSayisi === 'number')
        .map((b) => odaTipiAnahtari(b.odaSayisi as number, (b.salonSayisi as number | null) ?? 0))
        .filter((t) => !hazir.has(t)),
    ),
  ];
  return { ...f, ayarlar: { ...ayarlar, odaTipleri: { eklenen, gizli: [] } } };
}

/**
 * Şema 7 → 8: kat karşılığı ayrıntıları.
 * - katKarsiligiSozlesme: eski serbest yazılar (gecikme cezası, kira yardımı) `not`a; `sozlesmeTarihi`,
 *   `teslimSuresiAy`, `gecikmeCezasi` boş; her arsa sahibine kira alanları (boş)
 * - giderSatiri: `ilaveImalatId` = null
 */
export function katKarsiligiSurum8(k: Kayit): Kayit {
  if ('not' in k) return k;
  const { gecikmeCezasi, kiraYardimi, ...geri } = k as Kayit & { gecikmeCezasi?: unknown; kiraYardimi?: unknown };
  const yazi = (etiket: string, d: unknown) => (typeof d === 'string' && d.trim() ? `${etiket}: ${d.trim()}` : null);
  return {
    ...geri,
    sozlesmeTarihi: null,
    teslimSuresiAy: null,
    gecikmeCezasi: null,
    not: [yazi('Gecikme cezası', gecikmeCezasi), yazi('Kira yardımı', kiraYardimi)].filter(Boolean).join('\n'),
    arsaSahipleri: ((k.arsaSahipleri as Kayit[] | undefined) ?? []).map((a) => ({ kiraAylik: null, kiraBaslangic: null, teslimAlindi: null, ...a })),
  };
}

export function giderSatiriSurum8(s: Kayit): Kayit {
  return { ...s, ilaveImalatId: (s.ilaveImalatId as string | null | undefined) ?? null };
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
  4: (t) => ({
    ...t,
    ...(t.proje ? { proje: (t.proje as Kayit[]).map(projeSurum5) } : {}),
    ...(t.firma ? { firma: (t.firma as Kayit[]).map(firmaSurum5) } : {}),
  }),
  5: (t) => ({
    ...t,
    ...(t.proje ? { proje: (t.proje as Kayit[]).map(projeSurum6) } : {}),
    ...(t.blok ? { blok: (t.blok as Kayit[]).map(blokSurum6) } : {}),
    ...(t.bagimsizBolum ? { bagimsizBolum: bolumlerSurum6(t.bagimsizBolum as Kayit[]) } : {}),
    ...(t.katKarsiligiSozlesme ? { katKarsiligiSozlesme: (t.katKarsiligiSozlesme as Kayit[]).map(katKarsiligiSurum6) } : {}),
  }),
  6: (t) => {
    const bolumler = bolumlerSurum7((t.bagimsizBolum as Kayit[] | undefined) ?? [], (t.kat as Kayit[] | undefined) ?? []);
    return {
      ...t,
      ...(t.bagimsizBolum ? { bagimsizBolum: bolumler } : {}),
      ...(t.firma ? { firma: (t.firma as Kayit[]).map((f) => firmaSurum7(f, bolumler)) } : {}),
    };
  },
  7: (t) => ({
    ...t,
    ...(t.katKarsiligiSozlesme ? { katKarsiligiSozlesme: (t.katKarsiligiSozlesme as Kayit[]).map(katKarsiligiSurum8) } : {}),
    ...(t.giderSatiri ? { giderSatiri: (t.giderSatiri as Kayit[]).map(giderSatiriSurum8) } : {}),
  }),
};
