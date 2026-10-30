import type { AliciVerisi } from '../servisler/aliciBaglantisi';
import { istek, telefonUygulamasi } from './api';

// Alıcı bağlantısı: satış özetini sunucuya yükler; alıcı /alici.html?t=… sayfasından girişsiz görür.

/** Alıcıya gönderilen adres: telefon uygulamasında da sitenin kendi adresi. */
export const aliciBaglantisiAdresi = (token: string) =>
  `${telefonUygulamasi() ? 'https://muteahhit.surex.tr/' : `${location.origin}${location.pathname.replace(/[^/]*$/, '')}`}alici.html?t=${token}`;

export const aliciDurumu = (satisId: string, firmaId: string | null) =>
  istek<{ token: string | null; guncelleme: string | null }>('alici_durum', undefined, { satis: satisId, ...(firmaId ? { firma: firmaId } : {}) });

export const aliciYayinla = (satisId: string, veri: AliciVerisi, firmaId: string | null) => istek<{ token: string }>('alici_yayinla', { satisId, veri, firmaId });

export const aliciKaldir = (satisId: string, firmaId: string | null) => istek<{ tamam: boolean }>('alici_kaldir', { satisId, firmaId });
