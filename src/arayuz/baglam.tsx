import { createContext, useContext } from 'react';
import type { KayitServisi, Oturum } from '../servisler/kayitServisi';
import type { Depo } from '../veri/depo';
import type { Firma } from '../veri/tipler';
import type { YedekArsivi } from '../veri/yedekArsivi';

/** Kurulumu yapılmış, açık uygulamanın bütün ekranlara verdiği ortak bilgiler. */
export interface Uygulama {
  depo: Depo;
  arsiv: YedekArsivi;
  oturum: Oturum;
  servis: KayitServisi;
  firma: Firma;
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
