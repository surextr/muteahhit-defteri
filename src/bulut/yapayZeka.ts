import { maskele } from '../hesap/maskele';
import { IsKuraliHatasi } from '../servisler/kayitServisi';
import { istek } from './api';

// Giriş hesabı (e-posta + şifre, kayıtta e-posta onayı; bulut eşitleme de aynı hesabı kullanır) ve yapay zekâ ile
// sözleşme düzenleme (günlük hak sayacı, Claude çağrısı; Anthropic anahtarı sunucudadır). Sunucu: sunucu/api.

/** Giriş yapılmışsa e-posta adresi. */
export async function yzOturumu(): Promise<string | null> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return null;
  const { eposta } = await istek<{ eposta: unknown }>('oturum');
  return typeof eposta === 'string' ? eposta : null;
}

export const EN_KISA_SIFRE = 8;

/**
 * Hesap açar; e-postaya onay bağlantısı gider, oturum açılmaz. Dönüş her zaman 'onay_bekliyor'
 * (tip, ekranın iki durumu da karşılaması için korunur).
 */
export async function yzKayitOl(eposta: string, sifre: string): Promise<'onay_bekliyor' | 'giris_yapildi'> {
  if (sifre.length < EN_KISA_SIFRE) throw new IsKuraliHatasi(`Şifre en az ${EN_KISA_SIFRE} karakter olmalı.`);
  await istek('kayit', { eposta: eposta.trim(), sifre });
  return 'onay_bekliyor';
}

export async function yzGirisYap(eposta: string, sifre: string): Promise<void> {
  await istek('giris', { eposta: eposta.trim(), sifre });
}

/**
 * E-postadaki onay bağlantısı sunucuda işlenir, uygulamaya "#yz-onay=onaylandi" ya da "#yz-onay=hata" ile döner.
 * Uygulama açılırken bir kez çağrılır: adres Ayarlar'a çevrilir, sonuç Ayarlar'daki kartta gösterilsin diye
 * oturum deposuna yazılır.
 */
export function onayDonusunuIsle(): void {
  const eslesme = /^#yz-onay=(onaylandi|hata)$/.exec(window.location.hash);
  if (!eslesme) return;
  try {
    sessionStorage.setItem('yz-onay', eslesme[1]!);
  } catch {
    // Oturum deposu kapalıysa uyarı gösterilmez; giriş yine çalışır.
  }
  history.replaceState(null, '', `${window.location.pathname}#/ayarlar`);
}

/** onayDonusunuIsle'nin bıraktığı sonuç (bir kez okunur). */
export function onayDonusuOku(): 'onaylandi' | 'hata' | null {
  try {
    const s = sessionStorage.getItem('yz-onay');
    sessionStorage.removeItem('yz-onay');
    return s === 'onaylandi' || s === 'hata' ? s : null;
  } catch {
    return null;
  }
}

export async function yzCikis(): Promise<void> {
  await istek('cikis', {});
}

export interface DuzenlemeSonucu {
  duzenlenmis: string;
  sorular: string[];
  kalanHak: number;
}

/**
 * Özel şartları düzenletir. Gönderilen: usta tipinin adı ve maskelenmiş metin (telefon, TC/VKN, IBAN, e-posta yok).
 * İnternet yoksa ya da giriş yapılmamışsa hata verir; ekran şablonla devam eder.
 */
export async function ozelSartlariDuzenle(ustaTipi: string, metin: string): Promise<DuzenlemeSonucu> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) throw new IsKuraliHatasi('İnternet yok; şablonla devam edin.');
  const veri = await istek<unknown>('duzenle', { ustaTipi, metin: maskele(metin).metin });
  return duzenlemeYanitiniDogrula(veri);
}

/**
 * Sunucunun yanıtı beklenen biçimde mi: düzenlenmiş metin, sorular (metin dizisi), kalan hak (sayı).
 * Değilse ekran çökmesin diye anlaşılır hata verilir.
 */
export function duzenlemeYanitiniDogrula(veri: unknown): DuzenlemeSonucu {
  const v = (typeof veri === 'string' ? jsonOku(veri) : veri) as Partial<Record<keyof DuzenlemeSonucu, unknown>> | null;
  if (
    !v ||
    typeof v !== 'object' ||
    typeof v.duzenlenmis !== 'string' ||
    !v.duzenlenmis.trim() ||
    !Array.isArray(v.sorular) ||
    !v.sorular.every((s) => typeof s === 'string') ||
    typeof v.kalanHak !== 'number' ||
    !Number.isFinite(v.kalanHak)
  ) {
    throw new IsKuraliHatasi('Yapay zekâdan beklenmeyen yanıt geldi; şablonla devam edin ya da yeniden deneyin.');
  }
  return { duzenlenmis: v.duzenlenmis, sorular: v.sorular as string[], kalanHak: v.kalanHak };
}

function jsonOku(metin: string): unknown {
  try {
    return JSON.parse(metin);
  } catch {
    return null;
  }
}
