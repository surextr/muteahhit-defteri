// Oda tipi: oda ve salon sayısı ayrı saklanır ("3+1" → oda 3, salon 1). Dubleks oda tipi değil, ayrı işarettir.
// Firmanın listesi: hazır tipler + firmanın eklediği tipler − gizlenenler; kullanım sıklığına göre sıralanır.

import type { Dubleks, OdaTipiAyari } from '../veri/tipler';

export type { Dubleks, OdaTipiAyari };

export const HAZIR_ODA_TIPLERI = ['1+0', '1+1', '2+1', '3+1', '4+1', '5+1'] as const;

export const DUBLEKS_ADI: Record<Dubleks, string> = { bahce: 'Bahçe dubleksi', cati: 'Çatı dubleksi' };

export interface OdaTipi {
  oda: number;
  salon: number;
}

export const BOS_ODA_TIPI_AYARI: OdaTipiAyari = { eklenen: [], gizli: [] };

export const odaTipiAnahtari = (oda: number, salon: number) => `${oda}+${salon}`;

/** "3+1" → { oda: 3, salon: 1 }; geçersizse null. Oda 1–20, salon 0–9. */
export function odaTipiOku(metin: string): OdaTipi | null {
  const m = /^\s*(\d{1,2})\s*\+\s*(\d)\s*$/.exec(metin);
  if (!m) return null;
  const oda = Number(m[1]);
  const salon = Number(m[2]);
  return oda >= 1 && oda <= 20 ? { oda, salon } : null;
}

/** Bölümün oda tipi anahtarı; oda sayısı yoksa null. */
export const bolumOdaTipi = (b: { odaSayisi: number | null; salonSayisi: number | null }) =>
  b.odaSayisi === null ? null : odaTipiAnahtari(b.odaSayisi, b.salonSayisi ?? 0);

/** Düğme etiketi: "1+0 (stüdyo)", "3+1". */
export const odaTipiEtiketi = (anahtar: string) => (anahtar === '1+0' ? '1+0 (stüdyo)' : anahtar);

/**
 * Seçilebilir tipler: hazır + eklenen, gizliler hariç; en çok kullanılan başta, eşitse hazır liste sırası.
 * `secili` gizli olsa da listede kalır (kayıttaki değer kaybolmasın).
 */
export function odaTipiSecenekleri(ayar: OdaTipiAyari, kullanim: ReadonlyMap<string, number>, secili: string | null = null): string[] {
  const tum = [...new Set([...HAZIR_ODA_TIPLERI, ...ayar.eklenen])];
  const sira = new Map(tum.map((t, i) => [t, i]));
  return tum
    .filter((t) => !ayar.gizli.includes(t) || t === secili)
    .concat(secili && !sira.has(secili) ? [secili] : [])
    .sort((a, b) => (kullanim.get(b) ?? 0) - (kullanim.get(a) ?? 0) || (sira.get(a) ?? 99) - (sira.get(b) ?? 99));
}

/**
 * Eski serbest yazıyı çözer: "3+1", "3 + 1", "stüdyo", "4+1 dubleks", "bahçe dubleksi 3+1".
 * Çözülemeyen kısım `kalan` olarak döner (geçişte "diğer özellikler"e eklenir, kaybolmaz).
 */
export function odaTipiMetniCoz(metin: string | null): {
  odaSayisi: number | null;
  salonSayisi: number | null;
  dubleks: Dubleks | null;
  kalan: string | null;
} {
  const bos = { odaSayisi: null, salonSayisi: null, dubleks: null, kalan: null };
  if (!metin?.trim()) return bos;
  const kucuk = metin.toLocaleLowerCase('tr-TR');
  let kalan = kucuk;
  let dubleks: Dubleks | null = null;
  const d = /(bahçe|bahce|çatı|cati)?\s*dubleks(i)?/.exec(kalan);
  if (d) {
    dubleks = d[1] && /bah/.test(d[1]) ? 'bahce' : 'cati';
    kalan = kalan.replace(d[0], ' ');
  }
  let oda: OdaTipi | null = null;
  const m = /(\d{1,2})\s*\+\s*(\d)/.exec(kalan);
  if (m) {
    oda = odaTipiOku(`${m[1]}+${m[2]}`);
    if (oda) kalan = kalan.replace(m[0], ' ');
  } else if (/st[uü]dyo/.test(kalan)) {
    oda = { oda: 1, salon: 0 };
    kalan = kalan.replace(/st[uü]dyo/, ' ');
  }
  kalan = kalan.replace(/[\s,;·\-()]+/g, ' ').trim();
  return {
    odaSayisi: oda?.oda ?? null,
    salonSayisi: oda?.salon ?? null,
    dubleks,
    // Çözülemeyen yazı olduğu gibi (büyük/küçük harfiyle) korunur.
    kalan: kalan ? (oda || dubleks ? kalan : metin.trim()) : null,
  };
}
