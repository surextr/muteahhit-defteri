import { useEffect, useState } from 'react';
import { hazirUstaTipleriniEkle, ustaTipleriListele } from '../servisler/ustaTipi';
import type { UstaTipi } from '../veri/tipler';
import { useUygulama } from './baglam';

export interface Branslar {
  /** Gizliler dahil bütün tipler, ada göre (seçim listesi gizlileri ayırır). */
  tipler: UstaTipi[];
  /** Kimlik → tip adı; listelerde branş yazmak için. */
  adlar: ReadonlyMap<string, string>;
}

const BOS: Branslar = { tipler: [], adlar: new Map() };

/**
 * Usta tipleri (branşlar). Hazır tipler daha eklenmemişse önce eklenir; okunana kadar boş liste döner,
 * ekranlar o arada branşsız görünür.
 */
export function useBranslar(): Branslar {
  const { depo, servis, oturum } = useUygulama();
  const [branslar, setBranslar] = useState<Branslar>(BOS);
  useEffect(() => {
    let iptal = false;
    void (async () => {
      await hazirUstaTipleriniEkle(depo, servis).catch(() => 0);
      const tipler = await ustaTipleriListele(depo, oturum.firmaId);
      if (!iptal) setBranslar({ tipler, adlar: new Map(tipler.map((t) => [t.id, t.ad])) });
    })();
    return () => {
      iptal = true;
    };
  }, [depo, servis, oturum.firmaId]);
  return branslar;
}
