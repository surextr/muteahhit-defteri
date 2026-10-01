/**
 * UUID v7: ilk 48 bit milisaniye cinsinden zaman, kalanı rastgele.
 * Cihazda internetsiz üretilir, cihazlar arasında çakışmaz ve zamana göre sıralanır.
 */
export function yeniId(simdi: number = Date.now()): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  for (let i = 0; i < 6; i++) {
    b[i] = Math.floor(simdi / 2 ** (8 * (5 - i))) % 256;
  }
  b[6] = (b[6]! & 0x0f) | 0x70; // sürüm 7
  b[8] = (b[8]! & 0x3f) | 0x80; // RFC 4122 varyantı
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
