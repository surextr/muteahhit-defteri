// Bağımsız bölümün kısa gösterimleri: blok harfli numara, cephe kısaltması, kroki kutucuğu özeti.

/** Sekiz yön; cephe birden çoksa virgülle yazılır ("Güney, Doğu"). */
export const YONLER = ['Kuzey', 'Kuzeydoğu', 'Doğu', 'Güneydoğu', 'Güney', 'Güneybatı', 'Batı', 'Kuzeybatı'] as const;

const YON_KISA: Record<(typeof YONLER)[number], string> = {
  Kuzey: 'K',
  Kuzeydoğu: 'KD',
  Doğu: 'D',
  Güneydoğu: 'GD',
  Güney: 'G',
  Güneybatı: 'GB',
  Batı: 'B',
  Kuzeybatı: 'KB',
};

/** Kroki dışında bölüm numarası blok harfiyle yazılır: "A-20". Blok bilinmiyorsa yalnız numara. */
export const bolumNo = (blokAdi: string | null | undefined, no: string): string => (blokAdi ? `${blokAdi}-${no}` : no);

/** "Kuzeybatı" → "KB", "Güney, Doğu" → "G/D". Tanınmayan yazım olduğu gibi kalır. */
export function cepheKisa(cephe: string | null): string {
  if (!cephe?.trim()) return '';
  const kucuk = (y: string) => y.trim().toLocaleLowerCase('tr-TR');
  return cephe
    .split(',')
    .map((parca) => {
      const yon = YONLER.find((y) => kucuk(y) === kucuk(parca));
      return yon ? YON_KISA[yon] : parca.trim();
    })
    .filter(Boolean)
    .join('/');
}

/**
 * Kroki kutucuğundaki küçük yazı: "3+1 · 136 m² · KB". Boş olanlar yazılmaz.
 * Dar kutucukta satır yalnızca "·" işaretinden sonra kırılsın diye bölünmez boşluk kullanılır.
 */
export function kutucukOzeti(b: { tip: string; odaTipi: string | null; brutM2: number | null; cephe: string | null }): string {
  return [
    b.odaTipi ?? (b.tip === 'dukkan' ? 'Dükkan' : null),
    b.brutM2 !== null ? `${Math.round(b.brutM2).toLocaleString('tr-TR')} m²` : null,
    cepheKisa(b.cephe) || null,
  ]
    .filter(Boolean)
    .join(' · ');
}
