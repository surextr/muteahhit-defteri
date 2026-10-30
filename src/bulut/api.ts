import { IsKuraliHatasi } from '../servisler/kayitServisi';

// Kendi sunucumuzdaki PHP API (sunucu/api): uygulamayla aynı adreste /api/. Oturum sunucunun koyduğu HttpOnly çerezde.

import { telefonUygulamasi } from '../cihaz/uygulama';

export { telefonUygulamasi };
/** Telefon uygulamasında (Capacitor) sayfa cihazdan açılır; API canlı adreste. Tarayıcıda aynı adres. */
const API = telefonUygulamasi() ? 'https://muteahhit.surex.tr/api/' : 'api/';

/** Sunucunun döndürdüğü hata; durum koduyla (401: giriş gerekli, 403: yetki/üyelik). */
export class SunucuHatasi extends IsKuraliHatasi {
  constructor(
    mesaj: string,
    readonly durum: number,
  ) {
    super(mesaj);
    this.name = 'SunucuHatasi';
  }
}

/** İnternet yok ya da sunucuya ulaşılamadı. */
export class BaglantiHatasi extends IsKuraliHatasi {
  constructor() {
    super('Sunucuya ulaşılamadı; internet bağlantınızı kontrol edin.');
    this.name = 'BaglantiHatasi';
  }
}

export async function istek<T>(islem: string, govde?: unknown, sorgu: Record<string, string | number> = {}): Promise<T> {
  const ek = Object.entries(sorgu)
    .map(([k, v]) => `&${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('');
  let yanit: Response;
  try {
    yanit = await fetch(`${API}?islem=${islem}${ek}`, {
      method: govde === undefined ? 'GET' : 'POST',
      credentials: telefonUygulamasi() ? 'include' : 'same-origin',
      cache: 'no-store',
      headers: govde === undefined ? undefined : { 'Content-Type': 'application/json', 'X-Istek': '1' },
      body: govde === undefined ? undefined : JSON.stringify(govde),
    });
  } catch {
    throw new BaglantiHatasi();
  }
  const veri = (await yanit.json().catch(() => null)) as (T & { hata?: unknown }) | null;
  if (!yanit.ok) {
    throw new SunucuHatasi(typeof veri?.hata === 'string' ? veri.hata : `Sunucu hatası (${yanit.status}).`, yanit.status);
  }
  if (veri === null) throw new IsKuraliHatasi('Sunucudan beklenmeyen yanıt geldi.');
  return veri;
}

export const cevrimici = (): boolean => typeof navigator === 'undefined' || navigator.onLine;
