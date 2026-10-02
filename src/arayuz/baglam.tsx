import { createContext, useContext } from 'react';
import type { KayitServisi, Oturum } from '../servisler/kayitServisi';
import type { Depo } from '../veri/depo';
import type { Firma, Rol } from '../veri/tipler';
import type { YedekArsivi } from '../veri/yedekArsivi';

export interface AktifKullanici {
  ad: string;
  /** Üyeliği kaldırılmışsa null. */
  rol: Rol | null;
}

/** Kurulumu yapılmış, açık uygulamanın bütün ekranlara verdiği ortak bilgiler. */
export interface Uygulama {
  depo: Depo;
  arsiv: YedekArsivi;
  oturum: Oturum;
  servis: KayitServisi;
  firma: Firma;
  /** Bu cihazı kullanan kişi; işlem geçmişine bu adla yazılır. */
  kullanici: AktifKullanici;
  /** Oturum ve firma bilgisini yeniden okur (örn. yedekten geri yüklemeden sonra). */
  yenile: () => Promise<void>;
}

const Baglam = createContext<Uygulama | null>(null);

export const UygulamaSaglayici = Baglam.Provider;

export function useUygulama(): Uygulama {
  const uygulama = useContext(Baglam);
  if (!uygulama) throw new Error('useUygulama, UygulamaSaglayici içinde kullanılmalı.');
  return uygulama;
}
