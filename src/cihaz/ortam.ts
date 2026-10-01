export type Platform = 'ios' | 'android' | 'masaustu';
export type Tarayici = 'chrome' | 'edge' | 'samsung' | 'firefox' | 'safari' | 'diger';

export interface OrtamBilgisi {
  platform: Platform;
  tarayici: Tarayici;
  /** Uygulama ana ekrandan / yüklü uygulama olarak mı açık (tarayıcı sekmesinde değil)? */
  anaEkranUygulamasi: boolean;
}

/** Kullanıcıya doğru yönlendirmeyi gösterebilmek için tarayıcı ve platformu tanır. */
export function ortamiTani(userAgent: string, dokunmaNoktasi: number, anaEkranUygulamasi: boolean): OrtamBilgisi {
  // iPadOS masaüstü Safari kimliğiyle gelir; dokunmatik ekrandan ayırt edilir.
  const ios = /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && dokunmaNoktasi > 1);
  const platform: Platform = ios ? 'ios' : /Android/.test(userAgent) ? 'android' : 'masaustu';

  let tarayici: Tarayici = 'diger';
  if (/SamsungBrowser/.test(userAgent)) tarayici = 'samsung';
  else if (/Edg(e|A|iOS)?\//.test(userAgent)) tarayici = 'edge';
  else if (/Firefox|FxiOS/.test(userAgent)) tarayici = 'firefox';
  else if (/Chrome|CriOS/.test(userAgent)) tarayici = 'chrome';
  else if (/Safari/.test(userAgent)) tarayici = 'safari';

  return { platform, tarayici, anaEkranUygulamasi };
}
