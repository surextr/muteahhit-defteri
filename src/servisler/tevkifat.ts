import { tevkifatDonemleri, type TevkifatDonemOzeti } from '../hesap/tevkifat';
import type { Depo } from '../veri/depo';

// Beyan edilecek tevkifat: alışlarda tevkif ettiğimiz KDV, ay ay.

export interface TevkifatDonemi extends TevkifatDonemOzeti {
  /** Gider kimliği → faturayı kesen cari adı. */
  saticiAdlari: Record<string, string>;
}

/** En yeni ay önce. */
export async function tevkifatBeyanlari(depo: Depo, firmaId: string): Promise<TevkifatDonemi[]> {
  const k = { firmaId };
  const [giderler, satirlar, eslestirmeler, cariler] = await Promise.all([
    depo.listele('gider', k),
    depo.listele('giderSatiri', k),
    depo.listele('eslestirme', k),
    depo.listele('cari', k),
  ]);
  const cariAdi = new Map(cariler.map((c) => [c.id, c.ad]));
  return tevkifatDonemleri(giderler, satirlar, eslestirmeler).map((d) => ({
    ...d,
    saticiAdlari: Object.fromEntries(
      d.faturalar.flatMap(({ gider }) => (gider.cariId ? [[gider.id, cariAdi.get(gider.cariId) ?? '?']] : [])),
    ),
  }));
}
