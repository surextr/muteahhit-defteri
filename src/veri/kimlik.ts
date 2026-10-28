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

/**
 * Anahtardan her cihazda aynı çıkan kimlik (UUID biçiminde). Hazır kayıtlar (usta tipleri, sistem kalemleri, vergi
 * dairesi kartı) iki cihazda internetsizken ayrı ayrı oluşturulsa da eşitlemede tek kayıt olur.
 */
export function sabitId(...parcalar: string[]): string {
  const metin = parcalar.join('|');
  // Dört farklı tohumla 32 bitlik FNV-1a: 128 bit.
  const h = [0x811c9dc5, 0x01000193, 0x6c62272e, 0x9e3779b9].map((tohum) => {
    let x = tohum >>> 0;
    for (let i = 0; i < metin.length; i++) {
      x ^= metin.charCodeAt(i);
      x = Math.imul(x, 0x01000193) >>> 0;
    }
    return x.toString(16).padStart(8, '0');
  });
  const s = h.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-8${s.slice(13, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

/** Sabit kimlik daha önce kullanıldıysa (örn. kayıt iptal edilip yeniden gerekti) yeni kimlik. */
export async function bosSabitId(dolu: (id: string) => Promise<unknown>, ...parcalar: string[]): Promise<string> {
  const id = sabitId(...parcalar);
  return (await dolu(id)) ? yeniId() : id;
}
