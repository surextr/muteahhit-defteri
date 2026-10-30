/** Mağaza uygulamasında mı (Capacitor; sayfa cihazdan açılır)? Tarayıcıda false. */
export const telefonUygulamasi = (): boolean =>
  typeof window !== 'undefined' && !!(window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
