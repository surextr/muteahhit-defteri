import type { Kurus, Tarih } from '../veri/tipler';
import { tlYaz } from './para';

// WhatsApp için hazır mesaj metinleri (saf). Bakiye işareti cari ekstresiyle aynı: artı = borcumuz, eksi = alacağımız.

const tarihYaz = (t: Tarih) => `${t.slice(8, 10)}.${t.slice(5, 7)}.${t.slice(0, 4)}`;

export function ekstreMesaji(g: {
  cariAdi: string;
  firmaAdi: string;
  bugun: Tarih;
  bakiye: Kurus;
  /** En yeni önce. */
  sonHareketler: { tarih: Tarih; ad: string; tutar: Kurus }[];
}): string {
  const durum =
    g.bakiye > 0 ? `firmamızın size borcu ${tlYaz(g.bakiye)}` : g.bakiye < 0 ? `bize borcunuz ${tlYaz(-g.bakiye)}` : 'aramızda borç/alacak bulunmamaktadır';
  const satirlar = g.sonHareketler.slice(0, 5).map((h) => `• ${tarihYaz(h.tarih)} ${h.ad}: ${tlYaz(Math.abs(h.tutar))}`);
  return [
    `Sayın ${g.cariAdi},`,
    `${tarihYaz(g.bugun)} itibarıyla cari hesabınızda ${durum}.`,
    ...(satirlar.length ? ['', 'Son hareketler:', ...satirlar] : []),
    '',
    g.firmaAdi,
  ].join('\n');
}

export function taksitHatirlatmasi(g: {
  musteriAdi: string;
  firmaAdi: string;
  bolum: string;
  bugun: Tarih;
  /** Ödenmemiş plan satırları (vade sırasıyla). */
  acik: { vade: Tarih; ad: string; kalan: Kurus }[];
}): string {
  const geciken = g.acik.filter((x) => x.vade < g.bugun);
  const sonraki = g.acik.find((x) => x.vade >= g.bugun);
  const satir = (x: (typeof g.acik)[number]) => `• ${x.ad} (${tarihYaz(x.vade)}): ${tlYaz(x.kalan)}`;
  return [
    `Sayın ${g.musteriAdi},`,
    ...(geciken.length
      ? [`${g.bolum} bağımsız bölümünüz için vadesi geçmiş ödeme${geciken.length > 1 ? 'ler' : ''}:`, ...geciken.map(satir), `Toplam ${tlYaz(geciken.reduce((t, x) => t + x.kalan, 0))}.`]
      : [`${g.bolum} bağımsız bölümünüz için hatırlatma:`]),
    ...(sonraki ? [`Sıradaki ödeme: ${sonraki.ad}, ${tarihYaz(sonraki.vade)} vadeli ${tlYaz(sonraki.kalan)}.`] : []),
    'Ödemenizi yaptıysanız bu mesajı dikkate almayınız.',
    '',
    g.firmaAdi,
  ].join('\n');
}
