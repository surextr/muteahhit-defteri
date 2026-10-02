// Giriş alanlarının biçimi (Portföy Defteri ile aynı). Veritabanını ve ekranı bilmez; testlidir.

/**
 * Yazılırken tutar: nokta binlik, virgül kuruş (en çok 2 hane). "1250000,5" → "1.250.000,5".
 * Rakam ve virgül dışındakiler atılır; `eksiOlabilir` ise baştaki "-" korunur.
 */
export function tutarBicim(metin: string, eksiOlabilir = false): string {
  const eksi = eksiOlabilir && metin.trim().startsWith('-');
  const v = metin.replace(/[^\d,]/g, '');
  const k = v.indexOf(',');
  let tam = k >= 0 ? v.slice(0, k) : v;
  const kurus = k >= 0 ? v.slice(k + 1).replace(/,/g, '').slice(0, 2) : null;
  tam = tam.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  if (kurus !== null && tam === '') tam = '0';
  return (eksi ? '-' : '') + (kurus !== null ? `${tam},${kurus}` : tam);
}

/** Alandan çıkınca: yarım kuruş tamamlanır ("12,5" → "12,50"), sondaki virgül atılır. */
export function tutarBitir(metin: string, eksiOlabilir = false): string {
  let v = tutarBicim(metin, eksiOlabilir);
  if (/,\d$/.test(v)) v += '0';
  if (/,$/.test(v)) v = v.slice(0, -1);
  return v === '-' ? '' : v;
}

/**
 * Telefon: "05321112233", "+90 532 111 22 33", "5321112233" → "0 532 111 22 33".
 * Tanınmayan biçim (sabit hat dahili, yurt dışı) olduğu gibi bırakılır.
 */
export function telBicim(metin: string): string {
  let d = metin.replace(/\D/g, '');
  if (!d) return metin.trim();
  if (d.startsWith('90') && d.length === 12) d = `0${d.slice(2)}`;
  else if (d.length === 10 && !d.startsWith('0')) d = `0${d}`;
  if (d.length === 11 && d.startsWith('0')) return `${d[0]} ${d.slice(1, 4)} ${d.slice(4, 7)} ${d.slice(7, 9)} ${d.slice(9)}`;
  return metin.trim();
}

/**
 * IBAN (TR): "TR" kendiliğinden eklenir, iki kez yazılmaz; 24 rakamdan fazlası alınmaz (TR dahil 26 karakter);
 * dörderli gruplanır: "TR33 0006 1005 1978 6457 8413 26".
 */
export function ibanBicim(metin: string): string {
  let v = metin.toUpperCase().replace(/[^0-9A-Z]/g, '');
  while (v.startsWith('TR')) v = v.slice(2);
  const rakam = v.replace(/\D/g, '').slice(0, 24);
  if (!rakam) return /^T/.test(metin.trim().toUpperCase()) ? 'TR' : '';
  return `TR${rakam}`.replace(/(.{4})(?=.)/g, '$1 ');
}
