// Türkiye il / ilçe / mahalle listesi (Portföy Defteri ile aynı veri: 81 il, 973 ilçe, ~73 bin mahalle).
// Veri yaklaşık 1,5 MB olduğundan ayrı dosyadır ve ilk kullanıldığında yüklenir; uygulama açılışını yavaşlatmaz.
// İnternetsiz çalışma için service worker onu da önbelleğe alır.

/** il → ilçe → "mahalle1|mahalle2|…" */
export type TurkiyeAdres = Record<string, Record<string, string>>;

export const VARSAYILAN_IL = 'Antalya';

let yukleniyor: Promise<TurkiyeAdres> | null = null;

export function adresVerisi(): Promise<TurkiyeAdres> {
  yukleniyor ??= import('../veri/sabit/turkiyeAdres.json').then((m) => m.default as TurkiyeAdres);
  return yukleniyor;
}

const trSira = (a: string, b: string) => a.localeCompare(b, 'tr');

export const iller = (v: TurkiyeAdres): string[] => Object.keys(v).sort(trSira);

export const ilceler = (v: TurkiyeAdres, il: string | null): string[] => (il && v[il] ? Object.keys(v[il]).sort(trSira) : []);

export const mahalleler = (v: TurkiyeAdres, il: string | null, ilce: string | null): string[] =>
  il && ilce && v[il]?.[ilce] ? v[il][ilce].split('|').sort(trSira) : [];

/** "Konyaaltı / Antalya" gibi kısa yer adı; boşsa null. */
export function yerAdi(p: { il: string | null; ilce: string | null }): string | null {
  return [p.ilce, p.il].filter(Boolean).join(' / ') || null;
}

/** Tam adres: "Atatürk Cad. 5, Liman Mah., Konyaaltı / Antalya". */
export function tamAdres(p: { il: string | null; ilce: string | null; mahalle: string | null; adres: string }): string {
  return [p.adres.trim(), p.mahalle, yerAdi(p)].filter(Boolean).join(', ');
}
