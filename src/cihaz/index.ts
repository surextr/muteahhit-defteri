import type { Cihaz } from './cihaz';
import { TarayiciCihaz } from './tarayici';

/** Mağaza uygulamasında burası Capacitor uygulamasını döndürecek. */
export const cihaz: Cihaz = new TarayiciCihaz();
