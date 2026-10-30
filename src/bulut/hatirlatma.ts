import type { VadeKalemi } from '../hesap/bugun';
import { istek } from './api';

// Vade hatırlatmaları: sunucudaki tercih, telefon bildirimi aboneliği ve cihazın hesapladığı açık kalemlerin yüklenmesi.

export interface HatirlatmaAyari {
  eposta: boolean;
  bildirim: boolean;
  /** Kaç gün önceden (0: yalnız bugün ve geçmiş). */
  gunOnce: number;
  /** Hesabın kayıtlı bildirim aboneliği (cihaz) sayısı. */
  abonelik: number;
  /** VAPID açık anahtarı (base64url). */
  vapid: string;
}

export const hatirlatmaAyariGetir = () => istek<HatirlatmaAyari>('hatirlatma_ayar');
export const hatirlatmaAyariKaydet = (a: Pick<HatirlatmaAyari, 'eposta' | 'bildirim' | 'gunOnce'>) => istek<HatirlatmaAyari>('hatirlatma_ayar', a);
export const hatirlatmaDene = () => istek<{ eposta: boolean | null; bildirim: number | null; kalem: number }>('hatirlatma_dene', {});

/** Sunucuya giden kalem: kişinin görebildiği, kalanı olan vadeler. */
export const kalemleriHazirla = (kalemler: VadeKalemi[]) =>
  kalemler.map((k) => ({ tur: k.tur, vade: k.vade, tutar: k.tutar, baslik: k.baslik, ayrinti: k.ayrinti, yol: k.yol }));

export const hatirlatmaListesiGonder = (firmaId: string, firmaAdi: string, kalemler: ReturnType<typeof kalemleriHazirla>) =>
  istek<{ tamam: boolean; sayi: number }>('hatirlatma_liste', { firmaId, firmaAdi, kalemler });

export type BildirimDurumu = 'destekleniyor' | 'ana_ekran_gerekli' | 'desteklenmiyor';

/** Bu tarayıcıda anlık bildirim alınabilir mi? iPhone'da yalnız ana ekrana eklenmiş uygulamada. */
export function bildirimDestegi(): BildirimDurumu {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  const anaEkran = matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
  const var_ = 'serviceWorker' in navigator && typeof PushManager !== 'undefined' && typeof Notification !== 'undefined';
  if (ios && !anaEkran) return 'ana_ekran_gerekli';
  return var_ ? 'destekleniyor' : 'desteklenmiyor';
}

function anahtarBaytlari(b64u: string): Uint8Array {
  const s = atob(b64u.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64u.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

/** Bildirim izni ister ve bu cihazı sunucuya abone eder. İzin verilmezse hata. */
export async function bildirimeAboneOl(vapid: string): Promise<void> {
  const izin = await Notification.requestPermission();
  if (izin !== 'granted') throw new Error('Bildirim izni verilmedi. Telefonun ayarlarından bu uygulamaya bildirim izni verin.');
  const kayit = await navigator.serviceWorker.ready;
  let abonelik = await kayit.pushManager.getSubscription();
  if (abonelik) {
    // Sunucunun anahtarı değiştiyse (yeni kurulum) eski abonelik geçersizdir.
    const eski = abonelik.options.applicationServerKey;
    const ayni = eski && new Uint8Array(eski).join() === anahtarBaytlari(vapid).join();
    if (!ayni) {
      await abonelik.unsubscribe();
      abonelik = null;
    }
  }
  abonelik ??= await kayit.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: anahtarBaytlari(vapid) as BufferSource });
  await istek('push_abone', abonelik.toJSON());
}

/** Bu cihazın aboneliği var mı? */
export async function bildirimAboneligiVar(): Promise<boolean> {
  if (bildirimDestegi() !== 'destekleniyor') return false;
  const kayit = await navigator.serviceWorker.getRegistration();
  return !!(await kayit?.pushManager.getSubscription());
}

export async function bildirimAboneligiBirak(): Promise<void> {
  const kayit = await navigator.serviceWorker.getRegistration();
  const abonelik = await kayit?.pushManager.getSubscription();
  if (!abonelik) return;
  await istek('push_birak', { endpoint: abonelik.endpoint }).catch(() => undefined);
  await abonelik.unsubscribe();
}
