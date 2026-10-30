import { telefonUygulamasi } from './uygulama';
import type { Cihaz } from './cihaz';
import { TarayiciCihaz } from './tarayici';
import { YerelCihaz } from './yerel';

/** Mağaza uygulamasında (Capacitor) dosya kaydetme/paylaşma yerel eklentilerle; tarayıcıda web API'leriyle. */
export const cihaz: Cihaz = telefonUygulamasi() ? new YerelCihaz() : new TarayiciCihaz();
