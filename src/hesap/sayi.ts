/**
 * Kullanıcının yazdığı ondalık sayıyı okur (Türkçe: nokta binlik, virgül ondalık).
 * "120,5" → 120.5, "1.250" → 1250. Boş ya da geçersizse null.
 */
export function sayiOku(metin: string): number | null {
  const temiz = metin.replace(/\s/g, '');
  if (!/^-?(\d{1,3}(\.\d{3})+|\d+)(,\d+)?$/.test(temiz)) return null;
  return Number(temiz.replace(/\./g, '').replace(',', '.'));
}

/** Tam sayı; ondalıklı ya da geçersizse null. */
export function tamSayiOku(metin: string): number | null {
  const sayi = sayiOku(metin);
  return sayi !== null && Number.isInteger(sayi) ? sayi : null;
}

/** 1850.5 → "1.850,5". sayiOku ile geri okunabilir; form alanında da kullanılır. */
export function sayiYaz(sayi: number | null): string {
  return sayi === null ? '' : sayi.toLocaleString('tr-TR', { maximumFractionDigits: 2 });
}
