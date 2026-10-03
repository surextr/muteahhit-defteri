// Yapay zekâya gönderilmeden önce metindeki kişisel bilgiler yer tutucuyla değiştirilir.
// Aynı kurallar Edge Function'da da uygulanır (supabase/functions/sozlesme-duzenle).

const KURALLAR: { tur: string; desen: RegExp }[] = [
  { tur: 'IBAN', desen: /\bTR\s?\d{2}(?:\s?\d{4}){5}\s?\d{2}\b/gi },
  { tur: 'E-POSTA', desen: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g },
  { tur: 'TELEFON', desen: /(?:\+?90[\s-]?)?(?:\(0?5\d{2}\)|0?5\d{2})[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b/g },
  { tur: 'TC', desen: /\b\d{11}\b/g },
  { tur: 'VKN', desen: /\b\d{10}\b/g },
];

/** Maskelenmiş metin ve neyin maskelendiği (kullanıcıya gösterilir). */
export function maskele(metin: string): { metin: string; maskelenen: { tur: string; deger: string }[] } {
  const maskelenen: { tur: string; deger: string }[] = [];
  let sonuc = metin;
  for (const { tur, desen } of KURALLAR) {
    sonuc = sonuc.replace(desen, (deger) => {
      maskelenen.push({ tur, deger });
      return `[${tur}]`;
    });
  }
  return { metin: sonuc, maskelenen };
}
