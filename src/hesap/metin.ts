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

/** Tamamı büyük yazılan şirket türü kısaltmaları olduğu gibi kalır (noktalı/noktasız): "AŞ", "A.Ş." → "AŞ". */
const BUYUK_KALAN_KISALTMALAR = new Set(['as']);

/**
 * Cari adı biçimi: her kelimenin ilk harfi büyük, gerisi küçük (Türkçe İ/I kuralıyla, `tr-TR` yerel ayarı).
 * Tire ile ayrılan parçalar da kelime sayılır ("ahmet-ali USTA" → "Ahmet-Ali Usta"). "AŞ" gibi şirket
 * kısaltmaları büyük kalır (küçültülse anlamı değişir: "aş" = yemek).
 * "ALİ veli" → "Ali Veli", "beton AŞ" → "Beton AŞ", "şahin yapı ltd. şti." → "Şahin Yapı Ltd. Şti.".
 */
export function adBicimle(ad: string): string {
  const parcaBicimle = (parca: string) => {
    if (parca.length === 0) return parca;
    if (BUYUK_KALAN_KISALTMALAR.has(aramaAnahtari(parca.replace(/\./g, '')))) return parca.toLocaleUpperCase('tr-TR');
    const kucuk = parca.toLocaleLowerCase('tr-TR');
    return kucuk[0]!.toLocaleUpperCase('tr-TR') + kucuk.slice(1);
  };
  return ad
    .split(' ')
    .map((kelime) => kelime.split('-').map(parcaBicimle).join('-'))
    .join(' ');
}
