import type { Yetki } from '../hesap/yetki';

// Klavye kısayolları (bilgisayar). Harf kısayolları yazı alanı dışında çalışır; Ctrl+Enter / Ctrl+S kaydeder,
// Esc vazgeçer. Kaydet / Vazgeç düğmesi ekranda aranır, bulunamazsa ya da birden çok ise hiçbir şey yapılmaz.

export interface Kisayol {
  tus: string;
  /** Ekrandaki yazılışı. */
  ad: string;
  aciklama: string;
  yol: string;
  yetki?: Yetki;
}

export const KISAYOLLAR: Kisayol[] = [
  { tus: 'g', ad: 'G', aciklama: 'Yeni gider / fatura', yol: 'giderler/yeni', yetki: 'gider' },
  { tus: 'ö', ad: 'Ö', aciklama: 'Ödeme yap', yol: 'odemeler/yeni', yetki: 'odeme' },
  { tus: 't', ad: 'T', aciklama: 'Tahsilat al', yol: 'odemeler/tahsilat', yetki: 'odeme' },
  { tus: 'b', ad: 'B', aciklama: 'Belge yükle', yol: 'havuz' },
  { tus: 'k', ad: 'K', aciklama: 'Yeni kayıt menüsü', yol: 'kayit' },
  { tus: 'h', ad: 'H', aciklama: 'Bugün (ana ekran)', yol: 'bugun' },
];

/** Basılan tuşun kısayolu (büyük/küçük harf, Türkçe klavyede Ö; İngilizce klavyede O da Ödeme). */
export function kisayolBul(tus: string): Kisayol | undefined {
  const k = tus.toLocaleLowerCase('tr');
  return KISAYOLLAR.find((s) => s.tus === k || (s.tus === 'ö' && k === 'o'));
}

export const yaziAlaniMi = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

const gorunur = (el: HTMLElement) => el.offsetParent !== null || getComputedStyle(el).position === 'fixed';

function dugmeler(kok: ParentNode, metin: RegExp): HTMLButtonElement[] {
  return [...kok.querySelectorAll<HTMLButtonElement>('button')].filter((d) => !d.disabled && gorunur(d) && metin.test(d.textContent ?? ''));
}

/**
 * Kısayolun basacağı düğme: önce odaktaki alanı içeren en yakın kart / çubuk, sonra sabit kaydet çubuğu, sonra
 * sayfadaki tek eşleşen düğme. Birden çok aday kalırsa null (yanlış kaydı kaydetmektense hiçbir şey yapma).
 */
export function hedefDugme(tur: 'kaydet' | 'vazgec'): HTMLButtonElement | null {
  const sayfa = document.querySelector('main.sayfa');
  if (!sayfa) return null;
  const metin = tur === 'kaydet' ? /kaydet/i : /^\s*(vazgeç|kapat)\s*$/i;
  const ana = (l: HTMLButtonElement[]) => (tur === 'kaydet' ? l.filter((d) => !d.classList.contains('ikincil')) : l);

  // Açık onay sorusu varsa Esc onu kapatır; Ctrl+Enter onayı tahmin etmez.
  const soru = [...sayfa.querySelectorAll<HTMLElement>('[role=alertdialog]')].find(gorunur);
  if (soru) {
    if (tur === 'kaydet') return null;
    const l = dugmeler(soru, /vazgeç|hayır|kapat/i);
    return l.length === 1 ? l[0]! : null;
  }

  const odak = document.activeElement instanceof HTMLElement && sayfa.contains(document.activeElement) ? document.activeElement : null;
  for (let el = odak?.closest<HTMLElement>('.kart, .kaydet-cubugu, .bina-yan'); el; el = el.parentElement?.closest<HTMLElement>('.kart, .kaydet-cubugu, .bina-yan') ?? null) {
    const l = ana(dugmeler(el, metin));
    if (l.length === 1) return l[0]!;
    if (l.length > 1) return null;
  }
  const cubuk = [...sayfa.querySelectorAll<HTMLElement>('.kaydet-cubugu')].find(gorunur);
  if (cubuk) {
    const l = ana(dugmeler(cubuk, metin));
    if (l.length === 1) return l[0]!;
  }
  const l = ana(dugmeler(sayfa, metin));
  return l.length === 1 ? l[0]! : null;
}
