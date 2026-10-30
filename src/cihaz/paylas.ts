// WhatsApp ile paylaşım: hazır mesaj (wa.me bağlantısı) ve belgeyi PDF yapıp telefonun paylaş menüsüyle gönderme.
// PDF cihazda üretilir (html2canvas + jsPDF, gerektiğinde yüklenir); hiçbir şey sunucuya gitmez.

/** "0532 123 45 67" → "905321234567"; numara tanınmazsa null (WhatsApp kişi seçtirir). */
export function whatsappNumarasi(telefon: string | null | undefined): string | null {
  const r = (telefon ?? '').replace(/\D/g, '');
  if (/^90\d{10}$/.test(r)) return r;
  if (/^0\d{10}$/.test(r)) return `9${r}`;
  if (/^5\d{9}$/.test(r)) return `90${r}`;
  return r.length >= 11 && r.length <= 15 ? r : null;
}

export function whatsappBaglantisi(telefon: string | null | undefined, metin: string): string {
  const no = whatsappNumarasi(telefon);
  return `https://wa.me/${no ?? ''}?text=${encodeURIComponent(metin)}`;
}

/** WhatsApp'ı (telefonda uygulama, bilgisayarda WhatsApp Web) mesaj yazılı açar. */
export function whatsappAc(telefon: string | null | undefined, metin: string): void {
  window.open(whatsappBaglantisi(telefon, metin), '_blank', 'noopener');
}

/**
 * Sayfadaki belgeyi (A4 genişliğinde çizilir) çok sayfalı PDF yapar. Sayfa kesimleri görüntü üzerindendir; yazı
 * seçilemez ama Türkçe karakter ve logo birebir çıkar.
 */
export async function belgedenPdf(eleman: HTMLElement): Promise<Blob> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
  const genislik = 794; // A4 96 dpi
  const eski = eleman.style.cssText;
  eleman.style.width = `${genislik}px`;
  eleman.style.maxWidth = 'none';
  try {
    const tuval = await html2canvas(eleman, { scale: 2, backgroundColor: '#ffffff', windowWidth: genislik, useCORS: true, logging: false });
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
    const sayfaG = 210;
    const sayfaY = 297;
    const kenar = 10;
    const icG = sayfaG - 2 * kenar;
    const icY = sayfaY - 2 * kenar;
    const pikselMm = tuval.width / icG;
    const dilimPiksel = Math.floor(icY * pikselMm);
    for (let y = 0, sayfa = 0; y < tuval.height; y += dilimPiksel, sayfa++) {
      const yukseklik = Math.min(dilimPiksel, tuval.height - y);
      const dilim = document.createElement('canvas');
      dilim.width = tuval.width;
      dilim.height = yukseklik;
      dilim.getContext('2d')!.drawImage(tuval, 0, y, tuval.width, yukseklik, 0, 0, tuval.width, yukseklik);
      if (sayfa > 0) pdf.addPage();
      pdf.addImage(dilim.toDataURL('image/jpeg', 0.9), 'JPEG', kenar, kenar, icG, yukseklik / pikselMm);
    }
    return pdf.output('blob');
  } finally {
    eleman.style.cssText = eski;
  }
}

/**
 * Dosyayı telefonun paylaş menüsüyle gönderir (WhatsApp, e-posta…). Paylaşım desteklenmiyorsa (çoğu bilgisayar) dosya
 * indirilir; dönüş 'indirildi' ise kullanıcıya dosyayı WhatsApp'a kendisinin eklemesi söylenir.
 */
export async function dosyaPaylas(blob: Blob, dosyaAdi: string, metin: string): Promise<'paylasildi' | 'indirildi' | 'vazgecildi'> {
  const dosya = new File([blob], dosyaAdi, { type: blob.type || 'application/pdf' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [dosya] })) {
    try {
      await nav.share({ files: [dosya], text: metin, title: dosyaAdi });
      return 'paylasildi';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'vazgecildi';
    }
  }
  const url = URL.createObjectURL(dosya);
  const a = document.createElement('a');
  a.href = url;
  a.download = dosyaAdi;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'indirildi';
}

/** Dosya adında kullanılamayan karakterleri atar. */
export const dosyaAdi = (ad: string) => `${ad.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'belge'}.pdf`;
