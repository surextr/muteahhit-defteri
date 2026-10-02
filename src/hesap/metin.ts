// Türkçe arama: büyük/küçük harf (İ/i, I/ı) ve Türkçe harfsiz yazım ("sahin" → "Şahin") eşleşir.

const HARF: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' };

/**
 * Karşılaştırma anahtarı: Türkçe kurala göre küçük harf (I → ı, İ → i), sonra Türkçe harfler
 * Latin karşılığına (ç→c, ğ→g, ı→i, ö→o, ş→s, ü→u), şapkalar atılır, boşluklar tekleşir.
 * "IŞIK", "Işık", "ışık", "isik" hepsi "isik" olur.
 */
export function aramaAnahtari(metin: string): string {
  return metin
    .toLocaleLowerCase('tr-TR')
    .replace(/[çğıöşüâîû]/g, (h) => HARF[h]!)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Aranan kelimelerin her biri kaynakta geçiyor mu (sıra önemsiz)? Boş arama her şeye uyar.
 * "ince seramik" → "İnce inşaat › Seramik ve fayans" bulunur.
 */
export function aramaUyar(kaynak: string, arama: string): boolean {
  const k = aramaAnahtari(kaynak);
  return aramaAnahtari(arama)
    .split(' ')
    .filter(Boolean)
    .every((kelime) => k.includes(kelime));
}

/** Telefon araması: rakamlar karşılaştırılır ("0532 111" → "0 532 111 22 33" bulunur). */
export function rakamlar(metin: string): string {
  return metin.replace(/\D/g, '');
}
